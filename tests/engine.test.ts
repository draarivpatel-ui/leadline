import { openAsBlob, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/core/engine';
import { electrodeOf } from '../src/core/montage';
import { stageOf } from '../src/core/hypnogram';
import { DATA, golden, hasData, hasFilterGolden } from './helpers';

const open = async (name: string) => Engine.open(await openAsBlob(join(DATA, name)), name);
const f64 = (rel: string) => {
  const b = readFileSync(join(DATA, rel));
  return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('labels', () => {
  it('reads electrode names from common label styles', () => {
    expect(electrodeOf('EEG Fp1-REF')).toBe('FP1');
    expect(electrodeOf('Fc5.')).toBe('FC5');
    expect(electrodeOf('T7..')).toBe('T3');
    expect(electrodeOf('C3-A2')).toBe('C3');
    expect(electrodeOf('EEG Fpz-Cz')).toBeNull();
    expect(electrodeOf('ECG')).toBeNull();
  });
  it('maps the standard sleep stage texts', () => {
    expect(stageOf('Sleep stage W')).toBe('W');
    expect(stageOf('Sleep stage 4')).toBe('N4');
    expect(stageOf('Sleep stage N3')).toBe('N3');
    expect(stageOf('Sleep stage ?')).toBe('?');
    expect(stageOf('Movement time')).toBe('MT');
    expect(stageOf('Lights off')).toBeNull();
  });
});

describe.skipIf(!hasData)('engine on real recordings', () => {
  it('motor imagery file: info, montages and annotations', async () => {
    const e = await open('S001R03.edf');
    const info = e.info();
    expect(info.variant).toBe('EDF+C');
    expect(info.signals.length).toBe(64);
    expect(info.duration).toBe(125);
    const m = Object.fromEntries(info.montages.map((x) => [x.id, x.count]));
    expect(m).toEqual({ referential: 64, bipolar: 18, average: 64 });
    expect(e.annotations().length).toBe(30);
    const ref = golden()['S001R03.edf'].annotations.filter(([o, d]: number[]) => o < 20 && o + d >= 10).map((a: any[]) => a[2]);
    expect(ref.length).toBeGreaterThan(1);
    expect(e.annotations({ start: 10, end: 20 }).map((a) => a.text)).toEqual(ref);
  });

  it('bipolar derivations are the difference of the two electrodes', async () => {
    const e = await open('S001R03.edf');
    e.setSettings({ montage: 'bipolar' });
    const ch = e.channels();
    expect(ch[0].label).toBe('Fp1-F7');
    const w = await e.readWindow({ start: 10, duration: 2, width: 4000, derivations: [0] });
    expect(w.channels[0].mode).toBe('raw');
    e.setSettings({ montage: 'referential' });
    const ref = e.channels();
    const ip = ref.findIndex((d) => d.plus === ch[0].plus);
    const im = ref.findIndex((d) => d.plus === ch[0].minus);
    const r = await e.readWindow({ start: 10, duration: 2, width: 4000, derivations: [ip, im] });
    const a = r.channels[0].data;
    const b = r.channels[1].data;
    w.channels[0].data.forEach((v, k) => expect(v).toBeCloseTo(a[k] - b[k], 3));
  });

  it('average reference derivations sum to zero', async () => {
    const e = await open('S001R03.edf');
    e.setSettings({ montage: 'average' });
    const w = await e.readWindow({ start: 50, duration: 1, width: 1000 });
    for (let k = 0; k < w.channels[0].data.length; k++) {
      let sum = 0;
      for (const c of w.channels) sum += c.data[k];
      expect(Math.abs(sum)).toBeLessThan(1e-3);
    }
  });

  it.skipIf(!hasFilterGolden)('a filtered window matches SciPy filtering of the whole signal', async () => {
    const e = await open('S001R03.edf');
    e.setSettings({ filters: { highpass: 0.5, lowpass: 35, notch: 60, order: 2, notchQ: 30 } });
    const ref = f64('dsp/chain_160.f64');
    let peak = 0;
    for (const v of ref) peak = Math.max(peak, Math.abs(v));
    for (const start of [0, 40, 95]) {
      const w = await e.readWindow({ start, duration: 30, width: 8192, derivations: [0] });
      const c = w.channels[0];
      expect(c.mode).toBe('raw');
      const k0 = Math.round(c.t0 * 160);
      let err = 0;
      for (let k = 0; k < c.data.length; k++) err = Math.max(err, Math.abs(c.data[k] - ref[k0 + k]));
      expect(err / peak).toBeLessThan(1e-4);
    }
  });

  it('sleep recording with its separate hypnogram file', async () => {
    const e = await open('SC4001E0-PSG.edf');
    expect(e.info().duration).toBe(79500);
    const added = await e.addAnnotationFile(await openAsBlob(join(DATA, 'SC4001EC-Hypnogram.edf')), 'SC4001EC-Hypnogram.edf');
    expect(added).toEqual({ added: 154, offset: 0 });
    const h = e.hypnogram();
    expect(h.scheme).toBe('rk');
    const expected: Record<string, number> = {};
    const map: Record<string, string> = { W: 'W', '1': 'N1', '2': 'N2', '3': 'N3', '4': 'N4', R: 'R', '?': '?' };
    for (const [, d, t] of golden()['SC4001EC-Hypnogram.edf'].annotations) {
      const k = map[(t as string).replace('Sleep stage ', '')];
      expected[k] = (expected[k] ?? 0) + (d as number);
    }
    expect(h.totals).toEqual(expected);
  });

  it.skipIf(!hasFilterGolden)('engine spectrogram, read in chunks, matches SciPy on one hour', async () => {
    const e = await open('SC4001E0-PSG.edf');
    const g = JSON.parse(readFileSync(join(DATA, 'golden-dsp.json'), 'utf8')).cases.find((c: any) => c.key === 'spec256');
    const tile = await e.spectrogram({ derivation: 0, start: 0, duration: 3600, segment: 2.56, overlap: 0.5 });
    expect(tile.ntime).toBe(g.times.length);
    expect(tile.nfreq).toBe(g.nfreq);
    const ref = f64(g.output);
    let err = 0;
    for (let k = 0; k < ref.length; k++) err = Math.max(err, Math.abs(tile.db[k] - 10 * Math.log10(ref[k])));
    expect(err).toBeLessThan(1e-3); // dB; float32 storage
    tile.times.forEach((t, k) => expect(t).toBeCloseTo(g.times[k], 6));
  });

  it('whole-night spectrogram overview averages down to the requested columns', async () => {
    const e = await open('SC4001E0-PSG.edf');
    const tile = await e.spectrogram({ derivation: 0, start: 0, duration: 79500, segment: 30, overlap: 0, fmax: 30, columns: 800 });
    expect(tile.ntime).toBe(800);
    expect(tile.freqs[tile.nfreq - 1]).toBeLessThanOrEqual(30);
    expect(tile.db.some((v) => Number.isNaN(v))).toBe(false);
  });

  it('discontinuous file: gaps stay empty and filters never cross them', async () => {
    const e = await open('synthetic/synthetic_edf_D.edf');
    e.setSettings({ filters: { highpass: 1, lowpass: 0, notch: 0, order: 2, notchQ: 30 } });
    const w = await e.readWindow({ start: 0, duration: 21.125, width: 8192, derivations: [0] });
    const c = w.channels[0];
    expect(c.mode).toBe('raw');
    const at = (t: number) => c.data[Math.round((t - c.t0) * 256)];
    expect(Number.isNaN(at(0.5))).toBe(false);
    expect(Number.isNaN(at(3))).toBe(true);
    expect(Number.isNaN(at(7.5))).toBe(false);
    expect(Number.isNaN(at(15))).toBe(true);
    expect(Number.isNaN(at(20.5))).toBe(false);
  });

  it('rejects bad settings', async () => {
    const e = await open('SC4001E0-PSG.edf');
    expect(() => e.setSettings({ montage: 'bipolar' })).toThrow(/not available/);
    expect(() => e.setSettings({ filters: { highpass: 40, lowpass: 30, notch: 0, order: 2, notchQ: 30 } })).toThrow(/below/);
    expect(() => e.setSettings({ filters: { highpass: -1 } as any })).toThrow(/at least 0/);
  });

  it('performance: a 30 s window of 64 channels at 1600 px with all filters', async () => {
    const e = await open('S001R03.edf');
    e.setSettings({ filters: { highpass: 0.5, lowpass: 35, notch: 60, order: 2, notchQ: 30 } });
    await e.readWindow({ start: 0, duration: 30, width: 1600 });
    const times: number[] = [];
    for (let s = 0; s <= 90; s += 5) {
      const w = await e.readWindow({ start: s, duration: 30, width: 1600 });
      expect(w.channels.length).toBe(64);
      times.push(w.elapsedMs);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    console.log(`readWindow 64 ch x 30 s x 1600 px, filtered: median ${median.toFixed(1)} ms, worst ${times[times.length - 1].toFixed(1)} ms`);
    expect(median).toBeLessThan(100);
  });

  it('performance: 5 minute windows of the sleep recording (7 channels, 100 Hz and 1 Hz)', async () => {
    const e = await open('SC4001E0-PSG.edf');
    e.setSettings({ filters: { highpass: 0.3, lowpass: 35, notch: 50, order: 2, notchQ: 30 } });
    const times: number[] = [];
    for (let s = 30000; s <= 33000; s += 300) {
      const w = await e.readWindow({ start: s, duration: 300, width: 1600 });
      expect(w.channels.map((c) => c.mode)).toEqual(['minmax', 'minmax', 'minmax', 'raw', 'raw', 'raw', 'raw']);
      times.push(w.elapsedMs);
    }
    times.sort((a, b) => a - b);
    console.log(`readWindow 7 ch x 300 s x 1600 px, filtered: median ${times[5].toFixed(1)} ms, worst ${times[times.length - 1].toFixed(1)} ms`);
    expect(times[5]).toBeLessThan(150);
    await expect(e.readWindow({ start: 0, duration: 601, width: 100 })).rejects.toThrow(/at most 600/);
  });
});
