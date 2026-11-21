// Sample-level reads: BDF 24-bit sign extension, physical conversion, windowed time reads and gaps.
import { describe, expect, it } from 'vitest';
import { EdfRecording } from '../src/core/edf/recording';
import { annotationSignal, eegSignal, synthSource } from './synth';

describe('BDF sample decoding', () => {
  it('sign-extends 24-bit two-complement values', async () => {
    const rec = await EdfRecording.open(
      synthSource({
        format: 'BDF',
        signals: [{ label: 'Cz', unit: 'uV', spr: 4, pmin: -100, pmax: 100, dmin: -8388608, dmax: 8388607, records: [[8388607, -8388608, -1, 0]] }],
        recordCount: 1,
        records: 1,
      }),
    );
    const d = await rec.readDigital(0, 0, 1);
    expect(Array.from(d)).toEqual([8388607, -8388608, -1, 0]);
  });
});

describe('digital and physical reads', () => {
  const open = () =>
    EdfRecording.open(synthSource({ signals: [eegSignal(4, [[10, -20, 30, -40], [50, 60, 70, 80]])], recordCount: 2, records: 2 }));

  it('readDigital returns raw int32 sample values', async () => {
    const rec = await open();
    expect(Array.from(await rec.readDigital(0, 0, 2))).toEqual([10, -20, 30, -40, 50, 60, 70, 80]);
    expect(Array.from(await rec.readDigital(0, 1, 1))).toEqual([50, 60, 70, 80]);
  });

  it('readPhysical applies bitValue and offset', async () => {
    const rec = await open();
    const p = await rec.readPhysical(0, 0, 1);
    const bitValue = 200 / 65535;
    [10, -20, 30, -40].forEach((d, i) => expect(p[i]).toBeCloseTo(bitValue * (0.5 + d), 9));
  });
});

describe('readTime', () => {
  it('empty or reversed intervals return empty reads', async () => {
    const rec = await EdfRecording.open(synthSource({ signals: [eegSignal(4, [[1, 2, 3, 4]])], recordCount: 1, records: 1 }));
    for (const [a, b] of [[1, 1], [2, 1], [0.6, 0.2]] as const) {
      const [r] = await rec.readTime([0], a, b);
      expect(r.data.length, `[${a}, ${b})`).toBe(0);
    }
  });

  it('intervals outside the file come back as NaN-filled grid reads', async () => {
    const rec = await EdfRecording.open(synthSource({ signals: [eegSignal(4, [[1, 2, 3, 4]])], recordCount: 1, records: 1 }));
    const [pre] = await rec.readTime([0], -1, -0.5); // entirely before t = 0
    expect(pre.data.length).toBe(2);
    expect(pre.data.every(Number.isNaN)).toBe(true);
    const [post] = await rec.readTime([0], 5, 6); // entirely after the last record
    expect(post.data.length).toBe(4);
    expect(post.data.every(Number.isNaN)).toBe(true);
  });

  it('a discontinuous file fills the gap with NaN', async () => {
    // Two records, the second starting at t = 3 (a 2 s hole between them).
    const rec = await EdfRecording.open(
      synthSource({
        reserved: 'EDF+D',
        signals: [eegSignal(4, [[1, 2, 3, 4], [5, 6, 7, 8]]), annotationSignal(['+0\x14\x14\x00', '+3\x14\x14\x00'])],
        recordCount: 2,
        records: 2,
      }),
    );
    expect(rec.segments.length).toBe(2);
    const [r] = await rec.readTime([0], 0, 4);
    // Grid: 8 samples of signal at 4 Hz across [0, 4): [0,1) data, [1,3) NaN, [3,4) data.
    expect(r.data.length).toBe(16);
    const bitValue = 200 / 65535;
    for (let k = 0; k < 4; k++) expect(r.data[k]).toBeCloseTo(bitValue * (0.5 + (k + 1)), 5);
    for (let k = 4; k < 12; k++) expect(Number.isNaN(r.data[k]), `sample ${k}`).toBe(true);
    for (let k = 12; k < 16; k++) expect(r.data[k]).toBeCloseTo(bitValue * (0.5 + (k - 12 + 5)), 5);
  });

  it('aligned reads keep the sample grid of the recording, not of the request', async () => {
    const rec = await EdfRecording.open(
      synthSource({
        reserved: 'EDF+C',
        signals: [eegSignal(4, [[0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2]]), annotationSignal(['+0\x14\x14\x00', '+1\x14\x14\x00', '+2\x14\x14\x00'])],
        recordCount: 3,
        records: 3,
      }),
    );
    const [r] = await rec.readTime([0], 0.6, 2.4);
    // Samples land on the record grid (0.25 s steps from t = 0), so t0 snaps to 0.5 or 0.75, not 0.6.
    expect((r.t0 * 4) % 1).toBeCloseTo(0, 9);
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.data.length).toBeLessThanOrEqual(Math.ceil((2.4 - r.t0) * 4));
  });
});
