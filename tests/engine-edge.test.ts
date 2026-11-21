// Engine-level validation and edge behaviour on small in-memory recordings: settings guards,
// window/spectrogram argument checks, annotation files and fail-closed opens.
import { describe, expect, it } from 'vitest';
import { EdfError } from '../src/core/edf/errors';
import { Engine } from '../src/core/engine';
import { annotationSignal, eegSignal, synthSource } from './synth';

const openPlus = (sig = eegSignal(4, [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]])) =>
  Engine.open(synthSource({ reserved: 'EDF+C', signals: [sig, annotationSignal(['+0\x14\x14\x00', '+1\x14\x14x\x14\x00', '+2\x14\x14y\x14\x00'])], recordCount: 3, records: 3 }));
const openPlain = () => Engine.open(synthSource({ signals: [eegSignal(4, [[0, 1, 2, 3], [4, 5, 6, 7]])], recordCount: 2, records: 2 }));

describe('open guards', () => {
  it('refuses a file with neither signals nor annotations', async () => {
    // An annotation-only file with zero records: no ordinary signals and no annotations exist.
    const p = Engine.open(synthSource({ reserved: 'EDF+C', signals: [annotationSignal([])], recordCount: 0, records: 0 }));
    await expect(p).rejects.toMatchObject({ code: 'NO_SIGNALS' });
  });

  it('opens an annotation-only EDF+ file', async () => {
    const e = await Engine.open(synthSource({ reserved: 'EDF+C', signals: [annotationSignal(['+0\x14\x14x\x14\x00'])], recordCount: 1, records: 1 }));
    expect(e.info().signals.length).toBe(0);
    expect(e.info().annotationCount).toBe(1);
  });

  it('truncated files stay refused unless allowTruncated is passed', async () => {
    const src = synthSource({ signals: [eegSignal(4, [[0, 1, 2, 3]])], recordCount: 4, records: 1 });
    await expect(Engine.open(src)).rejects.toMatchObject({ code: 'TRUNCATED' });
    const e = await Engine.open(src, 'cut', { allowTruncated: true });
    expect(e.info().recordCount).toBe(1);
    expect(e.info().warnings.some((w) => /truncated/.test(w))).toBe(true);
  });
});

describe('settings validation', () => {
  it('rejects an unknown montage and an unavailable one', async () => {
    const e = await openPlus();
    expect(() => e.setSettings({ montage: 'linked ears' as never })).toThrow(/Unknown montage/);
    // One signal: no bipolar pairs or average reference exist.
    expect(() => e.setSettings({ montage: 'average' })).toThrow(/not available/);
  });

  it('rejects bad filter numbers and an inverted band', async () => {
    const e = await openPlus();
    const base = { highpass: 0, lowpass: 0, notch: 0, order: 2, notchQ: 30 };
    for (const f of [
      { ...base, highpass: -1 },
      { ...base, lowpass: Number.NaN },
      { ...base, notch: Number.POSITIVE_INFINITY },
      { ...base, order: -2 },
      { ...base, notchQ: -1 },
      { ...base, highpass: 10, lowpass: 10 },
      { ...base, highpass: 40, lowpass: 30 },
    ]) {
      expect(() => e.setSettings({ filters: f }), JSON.stringify(f)).toThrow(RangeError);
    }
  });

  it('a partial settings change keeps the other fields', async () => {
    const e = await openPlus();
    e.setSettings({ filters: { highpass: 0.5, lowpass: 30, notch: 50, order: 2, notchQ: 30 } });
    const s = e.setSettings({ filters: { lowpass: 20 } });
    expect(s.filters.highpass).toBe(0.5);
    expect(s.filters.lowpass).toBe(20);
    expect(s.filters.notch).toBe(50);
  });
});

describe('readWindow validation', () => {
  it('rejects bad durations, widths and derivations', async () => {
    const e = await openPlus();
    for (const req of [
      { start: 0, duration: 0, width: 100 },
      { start: 0, duration: -5, width: 100 },
      { start: 0, duration: 601, width: 100 },
      { start: 0, duration: 1, width: 9000 },
      { start: 0, duration: 1, width: Number.NaN },
      { start: 0, duration: 1, width: Number.POSITIVE_INFINITY },
    ]) {
      await expect(e.readWindow(req), JSON.stringify(req)).rejects.toThrow(RangeError);
    }
    await expect(e.readWindow({ start: 0, duration: 1, width: 100, derivations: [9] })).rejects.toThrow(RangeError);
  });

  it('reads physical values for the window and honours the derivation list', async () => {
    const e = await openPlus();
    const w = await e.readWindow({ start: 0, duration: 3, width: 12, derivations: [0] });
    const c = w.channels[0];
    expect(c.mode).toBe('raw');
    expect(c.sampleRate).toBe(4);
    expect(c.label).toBe('EEG Cz');
    // physical = bitValue * (offset + digital): offset = pmax / bitValue - dmax = 0.5 here,
    // so the digital ramp 0..11 lands half a bit above each integer step.
    const bitValue = 200 / 65535;
    for (let k = 0; k < 12; k++) expect(c.data[k]).toBeCloseTo(bitValue * (0.5 + k), 5);
  });
});

describe('annotations and added files', () => {
  it('ranges include annotations overlapping them', async () => {
    const e = await openPlus();
    const all = e.annotations();
    expect(all.map((a) => a.text)).toEqual(['x', 'y']);
    expect(e.annotations({ start: 0, end: 1.5 }).map((a) => a.text)).toEqual(['x']);
    expect(e.annotations({ start: 1.9, end: 2.5 }).map((a) => a.text)).toEqual(['y']);
    expect(e.annotations({ start: 5, end: 9 })).toEqual([]);
  });

  it('an annotation file aligns by start-time difference and dedupes by name', async () => {
    const e = await openPlus();
    const later = synthSource({
      reserved: 'EDF+C',
      date: '01.01.20',
      time: '00.00.10', // starts 10 s after the recording
      signals: [annotationSignal(['+0\x14\x14staged\x14\x00'])],
      recordCount: 1,
      records: 1,
    });
    const r = await e.addAnnotationFile(later, 'scoring');
    expect(r.added).toBe(1);
    expect(r.offset).toBe(10);
    const a = e.annotations().find((x) => x.text === 'staged');
    expect(a?.onset).toBeCloseTo(10, 9);
    expect(a?.source).toBe('scoring');
    // Same name replaces, never doubles.
    await e.addAnnotationFile(later, 'scoring');
    expect(e.annotations().filter((x) => x.source === 'scoring').length).toBe(1);
    // A different name stacks.
    await e.addAnnotationFile(later, 'other');
    expect(e.info().annotationCount).toBe(4);
  });

  it('a file without annotations cannot be added', async () => {
    const e = await openPlain();
    const p = e.addAnnotationFile(synthSource({ signals: [eegSignal(4, [[0, 0, 0, 0]])], recordCount: 1, records: 1 }), 'empty');
    await expect(p).rejects.toMatchObject({ code: 'BAD_TAL' });
  });
});

describe('spectrogram validation', () => {
  it('rejects a bad derivation and a non-positive fmax', async () => {
    const e = await openPlus();
    await expect(e.spectrogram({ derivation: 9, start: 0, duration: 1 })).rejects.toThrow(RangeError);
    await expect(e.spectrogram({ derivation: 0, start: 0, duration: 1, fmax: 0 })).rejects.toThrow(RangeError);
    await expect(e.spectrogram({ derivation: 0, start: 0, duration: 1, fmax: -5 })).rejects.toThrow(RangeError);
  });
});

describe('EdfError', () => {
  it('carries a stable code and a human message', () => {
    const err = new EdfError('TOO_SHORT', 'small');
    expect(err.code).toBe('TOO_SHORT');
    expect(err.name).toBe('EdfError');
    expect(err.message).toBe('small');
    expect(err).toBeInstanceOf(Error);
  });
});
