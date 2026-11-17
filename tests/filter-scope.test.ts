// Which channels the display filters touch. Runs on the bundled samples in public/samples, so it never skips.
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { butter, responseAt } from '../src/core/dsp/iir';
import { EdfRecording } from '../src/core/edf/recording';
import { blobSource } from '../src/core/edf/source';
import { Engine } from '../src/core/engine';
import { channelKind, electrodeOf, ELECTRODES, isEegLike, isSleepRecording, type ChannelKind } from '../src/core/montage';

const SAMPLES = join(import.meta.dirname, '..', 'public', 'samples');
const SLEEP = 'SC4001E0-PSG-sleep-excerpt.edf';
const open = async (name: string) => Engine.open(await openAsBlob(join(SAMPLES, name)), name);
const filters = (highpass: number, lowpass = 0, notch = 0) => ({ highpass, lowpass, notch, order: 2, notchQ: 30 });

describe('channel kinds', () => {
  it('every scalp electrode name is EEG, in bare, "EEG x-REF" and trailing-dot forms', () => {
    for (const e of ELECTRODES) {
      for (const label of [e, `EEG ${e}-REF`, `${e}.`, `${e[0]}${e.slice(1).toLowerCase()}..`]) {
        expect(channelKind(label, 'uV', 256), label).toBe('eeg');
      }
    }
    for (let k = 1; k <= 32; k++) expect(channelKind(`A${k}`, 'uV', 2048)).toBe('eeg'); // BioSemi channel names
    for (const label of ['E1', 'E2', 'E128']) expect(channelKind(label, 'uV', 500)).toBe('eeg'); // EGI nets
    expect(channelKind('EEG Fpz-Cz', 'uV', 100)).toBe('eeg');
    expect(channelKind('Signal 0', 'uV', 100)).toBe('eeg');
  });

  it('EOG, and the channels that are not EEG', () => {
    expect(channelKind('EOG horizontal', 'uV', 100)).toBe('eog');
    expect(channelKind('EOG E1-M2', 'uV', 200)).toBe('eog');
    expect(channelKind('LOC', 'uV', 200)).toBe('eog');
    expect(channelKind('ROC-A1', 'uV', 200)).toBe('eog');
    for (const [label, unit, fs] of [
      ['Resp oro-nasal', '', 1], ['EMG submental', 'uV', 1], ['EMG chin', 'uV', 200], ['Temp rectal', 'DegC', 1],
      ['Event marker', '', 1], ['ECG', 'uV', 200], ['EKG', 'mV', 256], ['SaO2', '%', 1], ['Status', 'Boolean', 2048],
      ['DC03', 'BPM', 25], ['Pleth', 'uV', 128], ['Fp1', 'uV', 16], ['Fp1', '', 256],
    ] as [string, string, number][]) {
      expect(channelKind(label, unit, fs), label).toBe('other');
    }
  });

  it('AASM eye channels on an ear or mastoid reference are EOG; bare E1 and E2 stay EEG (EGI)', () => {
    for (const label of ['E1-M2', 'E2-M2', 'E1-M1', 'e2-a1', 'E1 A2', 'EEG E1-M2']) expect(channelKind(label, 'uV', 256), label).toBe('eog');
    for (const label of ['E1', 'E2', 'E10', 'E128', 'E1-Cz', 'E12-M2']) expect(channelKind(label, 'uV', 500), label).toBe('eeg');
  });

  it('the "EEG " prefix is stripped before the type check', () => {
    expect(channelKind('EEG EKG1-REF', 'uV', 250)).toBe('other');
    expect(channelKind('EEG LOC-REF', 'uV', 250)).toBe('eog');
    expect(channelKind('EEG EOG-L', 'uV', 250)).toBe('eog');
    expect(channelKind('EEG Fp1-REF', 'uV', 250)).toBe('eeg');
    expect(channelKind('EEG Pz-Oz', 'uV', 100)).toBe('eeg');
  });

  it('a recording is sleep only on scored stages or a sleep-study channel set', () => {
    const rows = (labels: string[], unit = 'uV', fs = 256) =>
      labels.map((label) => ({ label, kind: channelKind(label, unit, fs) as ChannelKind }));
    // Routine clinical EEG with eye channels (TUH style, bare EMG and EKG rows included): not sleep.
    const tuh = rows(['EEG FP1-REF', 'EEG C3-REF', 'EEG O1-REF', 'EEG LOC-REF', 'EEG ROC-REF', 'EEG EKG1-REF', 'EMG-REF', 'EEG RESP1-REF', 'EEG RESP2-REF', 'PHOTIC-REF']);
    expect(tuh.filter((c) => c.kind === 'eog').length).toBe(2);
    expect(isSleepRecording(tuh, false)).toBe(false);
    expect(isSleepRecording(rows(['Fp1', 'C3', 'O1', 'EOG', 'ECG']), false)).toBe(false);
    expect(isSleepRecording(rows(['Fp1', 'C3', 'O1', 'LOC', 'ROC']), false)).toBe(false);
    // Polysomnography: Sleep-EDF, and an AASM export with no "EOG" word.
    const sleepEdf = [
      ...rows(['EEG Fpz-Cz', 'EEG Pz-Oz', 'EOG horizontal'], 'uV', 100),
      ...rows(['Resp oro-nasal', 'EMG submental', 'Temp rectal', 'Event marker'], '', 1),
    ];
    expect(isSleepRecording(sleepEdf, false)).toBe(true);
    expect(isSleepRecording(rows(['F4-M1', 'C4-M1', 'O2-M1', 'E1-M2', 'E2-M2', 'Chin1-Chin2']), false)).toBe(true);
    expect(isSleepRecording(rows(['C3-A2', 'C4-A1', 'LOC-A2', 'ROC-A1', 'SpO2']), false)).toBe(true);
    // A sleep-only signal without eye channels is not enough; scored stages always are.
    expect(isSleepRecording(rows(['Fp1', 'C3', 'Resp']), false)).toBe(false);
    expect(isSleepRecording(rows(['Fp1', 'C3']), true)).toBe(true);
  });

  it('voltage units match in any case', () => {
    for (const unit of ['uV', 'uv', 'UV', '\u00b5V', '\u03bcV', 'mV', 'mv', 'V', ' uV ']) {
      expect(isEegLike({ unit, sampleRate: 256 }), unit).toBe(true);
      expect(channelKind('Fp1', unit, 256), unit).toBe('eeg');
    }
    for (const unit of ['', 'DegC', '%', 'BPM']) expect(isEegLike({ unit, sampleRate: 256 }), unit).toBe(false);
  });

  it('the page and the engine share one voltage and rate rule', () => {
    expect(isEegLike({ unit: 'uV', sampleRate: 100 })).toBe(true);
    expect(isEegLike({ unit: 'uV', sampleRate: 1 })).toBe(false);
    expect(isEegLike({ unit: 'DegC', sampleRate: 100 })).toBe(false);
  });

  it('montage labels keep the file spelling of 10-10 names', async () => {
    expect(electrodeOf('T7..')).toBe('T3');
    const e = await open('S001R03.edf');
    e.setSettings({ montage: 'bipolar' });
    const labels = e.channels().map((d) => d.label);
    expect(labels[0]).toBe('Fp1-F7');
    expect(labels).toContain('F7-T7');
    expect(labels).toContain('T7-P7');
    expect(labels).not.toContain('F7-T3');
    e.setSettings({ montage: 'average' });
    expect(e.channels().map((d) => d.label)).toContain('T7-Avg');
  });
});

describe('the EEG filters stay off the non-EEG channels of the sleep sample', () => {
  it('high-pass 0.3 Hz: the 1 Hz channels equal the raw data, the EEG does not', async () => {
    const e = await open(SLEEP);
    const raw = await EdfRecording.open(blobSource(await openAsBlob(join(SAMPLES, SLEEP))));
    e.setSettings({ filters: filters(0.3, 35) });
    const ch = e.channels();
    expect(ch.map((d) => d.kind)).toEqual(['eeg', 'eeg', 'eog', 'other', 'other', 'other', 'other']);
    const duration = e.info().duration;
    for (const start of [0, duration / 2, duration - 600]) {
      const w = await e.readWindow({ start, duration: 600, width: 8192 });
      for (let i = 3; i < 7; i++) {
        const c = w.channels[i];
        expect(c.mode).toBe('raw');
        expect(c.sampleRate).toBe(1);
        expect(c.skippedFilters.join()).toMatch(/not an EEG channel/);
        const [r] = await raw.readTime([ch[i].plus], c.t0, c.t0 + c.data.length / c.sampleRate);
        expect(r.data.length).toBe(c.data.length);
        expect(Array.from(c.data)).toEqual(Array.from(r.data));
      }
      for (const i of [0, 1]) {
        const c = w.channels[i];
        expect(c.skippedFilters).toEqual([]);
        e.setSettings({ filters: filters(0) });
        const u = (await e.readWindow({ start, duration: 600, width: 8192, derivations: [i] })).channels[0];
        e.setSettings({ filters: filters(0.3, 35) });
        let diff = 0;
        for (let k = 0; k < c.data.length; k++) diff = Math.max(diff, Math.abs(c.data[k] - u.data[k]));
        expect(diff).toBeGreaterThan(1);
      }
    }
  });

  it('EOG keeps the low-pass and notch but its high-pass stops at 0.3 Hz', async () => {
    const e = await open(SLEEP);
    const at = async (hp: number) => {
      e.setSettings({ filters: filters(hp, 35) });
      return (await e.readWindow({ start: 12000, duration: 60, width: 8192, derivations: [2] })).channels[0];
    };
    const a = await at(1);
    const b = await at(0.3);
    const c = await at(0.1);
    expect(a.skippedFilters).toEqual(['high-pass 1 Hz (EOG keeps 0.3 Hz)']);
    expect(b.skippedFilters).toEqual([]);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(Array.from(c.data)).not.toEqual(Array.from(b.data));
  });

  it('a filter above a channel Nyquist frequency is reported, not run', async () => {
    const e = await open(SLEEP);
    e.setSettings({ filters: filters(0.3, 70, 60) });
    const w = await e.readWindow({ start: 0, duration: 30, width: 1000, derivations: [0, 3] });
    expect(w.channels[0].skippedFilters).toEqual(['low-pass 70 Hz', 'notch 60 Hz']);
    expect(w.channels[1].skippedFilters).toEqual(['all filters (not an EEG channel)']);
    e.setSettings({ filters: filters(0) });
    const off = await e.readWindow({ start: 0, duration: 30, width: 1000, derivations: [3] });
    expect(off.channels[0].skippedFilters).toEqual([]);
  });
});

describe('sleep defaults', () => {
  it('a 1 Hz zero-phase high-pass draws 0.5 Hz slow waves at about 6% of their size; 0.3 Hz keeps most of them', () => {
    // Zero-phase order-2 Butterworth: |H|^2 = 1 / (1 + (fc/f)^4).
    const gain = (fc: number, f: number) => responseAt(butter(2, fc, 'highpass', 100), (2 * Math.PI * f) / 100) ** 2;
    expect(gain(1, 0.5)).toBeCloseTo(1 / (1 + 16), 3);
    expect(gain(1, 0.5)).toBeLessThan(0.06);
    expect(gain(1, 1)).toBeCloseTo(0.5, 3);
    expect(gain(0.3, 0.5)).toBeGreaterThan(0.88);
    expect(gain(0.3, 1)).toBeGreaterThan(0.99);
  });
});

describe('settings are a snapshot per request', () => {
  it('a setSettings call during a readWindow does not change that reply', async () => {
    const e = await open('S001R03.edf');
    e.setSettings({ filters: filters(0.5, 35, 60) });
    const want = await e.readWindow({ start: 40, duration: 30, width: 1600 });
    const p = e.readWindow({ start: 40, duration: 30, width: 1600 });
    e.setSettings({ filters: filters(5, 15, 0) });
    const got = await p;
    expect(got.channels.length).toBe(want.channels.length);
    got.channels.forEach((c, i) => expect(Array.from(c.data)).toEqual(Array.from(want.channels[i].data)));
  });

  it('a montage change during a readWindow does not change that reply', async () => {
    const e = await open('S001R03.edf');
    e.setSettings({ montage: 'average' });
    const want = await e.readWindow({ start: 10, duration: 10, width: 800 });
    const p = e.readWindow({ start: 10, duration: 10, width: 800 });
    e.setSettings({ montage: 'bipolar' });
    const got = await p;
    expect(got.channels.map((c) => c.label)).toEqual(want.channels.map((c) => c.label));
    got.channels.forEach((c, i) => expect(Array.from(c.data)).toEqual(Array.from(want.channels[i].data)));
  });
});

describe('spectrogram', () => {
  it('fmax keeps exactly the low bins of the full tile', async () => {
    const e = await open(SLEEP);
    const full = await e.spectrogram({ derivation: 0, start: 3000, duration: 1500, segment: 2, overlap: 0.5 });
    const cut = await e.spectrogram({ derivation: 0, start: 3000, duration: 1500, segment: 2, overlap: 0.5, fmax: 35 });
    expect(cut.nfreq).toBe(90); // nfft 256 at 100 Hz: 0.39 Hz bins, 0 to 34.77 Hz
    expect(cut.ntime).toBe(full.ntime);
    for (let k = 0; k < cut.ntime; k++) for (let f = 0; f < cut.nfreq; f++) expect(cut.db[k * cut.nfreq + f]).toBe(full.db[k * full.nfreq + f]);
    const avgFull = await e.spectrogram({ derivation: 0, start: 0, duration: 24600, segment: 4, columns: 300 });
    const avgCut = await e.spectrogram({ derivation: 0, start: 0, duration: 24600, segment: 4, columns: 300, fmax: 35 });
    for (let k = 0; k < avgCut.ntime; k++) for (let f = 0; f < avgCut.nfreq; f++) expect(avgCut.db[k * avgCut.nfreq + f]).toBe(avgFull.db[k * avgFull.nfreq + f]);
  });

  it('a filtered run over several chunks has the frame times of the unfiltered run', async () => {
    const e = await open(SLEEP);
    e.setSettings({ filters: filters(0.3, 35) });
    const req = { derivation: 0, start: 3000, duration: 1500, segment: 2, overlap: 0.5 };
    const plain = await e.spectrogram(req);
    const filt = await e.spectrogram({ ...req, filtered: true });
    expect(plain.ntime).toBe(1499);
    expect(Array.from(filt.times)).toEqual(Array.from(plain.times));
    for (let k = 1; k < filt.ntime; k++) expect(filt.times[k]).toBeGreaterThan(filt.times[k - 1]);
    expect(filt.times[0]).toBeGreaterThanOrEqual(3000);
    expect(filt.times[filt.ntime - 1]).toBeLessThanOrEqual(4500);
    // The low-pass shows: power above 35 Hz drops.
    const hi = (t: typeof plain) => { let s = 0; for (let k = 0; k < t.ntime; k++) s += t.db[k * t.nfreq + 115] /* 44.9 Hz */; return s / t.ntime; };
    expect(hi(filt)).toBeLessThan(hi(plain) - 10);
  });

  it('a montage change while the night is read does not mix montages', async () => {
    const e = await open('S001R03.edf');
    Engine.CHUNK_S = 20; // several chunks in this 125 s file
    e.setSettings({ montage: 'average' });
    const want = await e.spectrogram({ derivation: 5, start: 0, duration: 125, segment: 0.5 });
    const p = e.spectrogram({ derivation: 5, start: 0, duration: 125, segment: 0.5 });
    e.setSettings({ montage: 'bipolar' });
    const got = await p.finally(() => (Engine.CHUNK_S = 600));
    expect(got.label).toBe(want.label);
    expect(got.ntime).toBe(499);
    expect(Array.from(got.db)).toEqual(Array.from(want.db));
  });
});

describe('mixed references', () => {
  const sig = (index: number, label: string) => ({ index, label, unit: 'uV', sampleRate: 200, isAnnotation: false }) as any;
  it('a PSG with C3-A2 and C4-A1 gets no cross-reference bipolar pairs and a named, single-reference average', async () => {
    const { buildMontages } = await import('../src/core/montage');
    const labels = ['F3-A2', 'C3-A2', 'O1-A2', 'P3-A2', 'F4-A1', 'C4-A1', 'O2-A1', 'P4-A1', 'Fz-A2', 'Cz-A1', 'Pz-A1', 'EOG E1-M2'];
    const [ref, bip, avg] = buildMontages(labels.map((l, i) => sig(i, l)));
    expect(ref.derivations.map((d) => d.kind)).toEqual([...Array(11).fill('eeg'), 'eog']);
    expect(bip.derivations.map((d) => d.label)).toEqual(['F3-C3', 'C3-P3', 'P3-O1', 'F4-C4', 'C4-P4', 'P4-O2', 'Cz-Pz']);
    expect(bip.note).toMatch(/Mixed references \(A1, A2\): 1 pair is left out/);
    expect(avg.derivations.length).toBe(6);
    expect(avg.derivations.every((d) => /-A1$/.test(labels[d.plus]))).toBe(true);
    expect(avg.note).toMatch(/Mixed references \(A1, A2\): the average is built from the 6 electrodes on A1; 5 other electrodes are left out/);
  });
  it('one common reference gives no note', async () => {
    const { buildMontages } = await import('../src/core/montage');
    const [, bip, avg] = buildMontages(['Fp1-REF', 'F7-REF', 'T3-REF', 'C3-REF'].map((l, i) => sig(i, l)));
    expect(avg.note).toBeUndefined();
    expect(bip.note).toBe('2 of 18 pairs have both electrodes on one reference.');
  });
});
