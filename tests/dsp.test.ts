import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decimateMinMax } from '../src/core/dsp/decimate';
import { fft } from '../src/core/dsp/fft';
import { applyChain, butter, designChain, iirnotch, settleSamples, sosfiltfilt } from '../src/core/dsp/iir';
import { spectrogram } from '../src/core/dsp/spectrogram';
import { EdfRecording } from '../src/core/edf/recording';
import { DATA, fileSource, hasFilterGolden } from './helpers';

function f64(rel: string): Float64Array {
  const b = readFileSync(join(DATA, rel));
  return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

function maxRelErr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < b.length; i++) peak = Math.max(peak, Math.abs(b[i]));
  let err = 0;
  for (let i = 0; i < b.length; i++) err = Math.max(err, Math.abs(a[i] - b[i]));
  return err / (peak || 1);
}

const inputs = new Map<string, Float64Array>();
async function input(key: string): Promise<Float64Array> {
  if (!inputs.has(key)) {
    const [file, rest] = key.split('#');
    const [ch, secs] = rest.split('@');
    const rec = await EdfRecording.open(await fileSource(file));
    const s = rec.signals[Number(ch)];
    const records = secs ? Math.round(Number(secs) / rec.header.recordDuration) : rec.header.recordCount;
    inputs.set(key, await rec.readPhysical(s.index, 0, records));
  }
  return inputs.get(key)!;
}

const G = hasFilterGolden ? JSON.parse(readFileSync(join(DATA, 'golden-dsp.json'), 'utf8')) : { cases: [] };

describe.skipIf(!hasFilterGolden)('filters match SciPy', () => {
  for (const c of G.cases.filter((c: any) => c.kind === 'butter')) {
    it(`${c.key}: butter(${c.order}, ${c.cutoff}, ${c.btype}, fs=${c.fs}) + sosfiltfilt`, async () => {
      const sos = butter(c.order, c.cutoff, c.btype, c.fs);
      // Same transfer function: compare the frequency response of our sections with SciPy's.
      const theirs = Float64Array.from(c.sos.flat());
      for (const w of [0.001, 0.01, 0.1, 0.5, 1, 2, 3]) {
        expect(Math.abs(resp(sos, w) - resp(theirs, w))).toBeLessThan(1e-10);
      }
      const y = sosfiltfilt(sos, await input(c.input));
      expect(maxRelErr(y, f64(c.output))).toBeLessThan(1e-9);
    });
  }
  for (const c of G.cases.filter((c: any) => c.kind === 'notch')) {
    it(`${c.key}: iirnotch(${c.f0}, ${c.Q}, fs=${c.fs}) + filtfilt`, async () => {
      const sos = iirnotch(c.f0, c.Q, c.fs);
      const ref = [...c.b, ...c.a];
      for (let k = 0; k < 6; k++) expect(sos[k]).toBeCloseTo(ref[k], 14);
      expect(maxRelErr(sosfiltfilt(sos, await input(c.input)), f64(c.output))).toBeLessThan(1e-9);
    });
  }
  for (const c of G.cases.filter((c: any) => c.kind === 'chain')) {
    it(`${c.key}: high-pass, low-pass and notch in sequence`, async () => {
      const { stages } = designChain({ highpass: c.highpass, lowpass: c.lowpass, notch: c.notch, order: c.order, notchQ: c.Q }, c.fs);
      expect(maxRelErr(applyChain(stages, await input(c.input)), f64(c.output))).toBeLessThan(1e-9);
    });
    it(`${c.key}: windowed filtering with a settle margin matches filtering the whole signal`, async () => {
      const x = await input(c.input);
      const ref = f64(c.output);
      const { stages } = designChain({ highpass: c.highpass, lowpass: c.lowpass, notch: c.notch, order: c.order, notchQ: c.Q }, c.fs);
      const margin = Math.max(...stages.map((s) => settleSamples(s)));
      let peak = 0;
      for (const v of ref) peak = Math.max(peak, Math.abs(v));
      for (const start of [0, 3000, 9000, x.length - 4800]) {
        const a = Math.max(0, start - margin);
        const b = Math.min(x.length, start + 4800 + margin);
        const y = applyChain(stages, x.subarray(a, b));
        let err = 0;
        for (let i = start; i < start + 4800; i++) err = Math.max(err, Math.abs(y[i - a] - ref[i]));
        expect(err / peak).toBeLessThan(1e-4);
      }
    });
  }
});

describe.skipIf(!hasFilterGolden)('spectrogram matches scipy.signal.spectrogram', () => {
  for (const c of G.cases.filter((c: any) => c.kind === 'spectrogram')) {
    it(`${c.key}: nperseg ${c.nperseg}, noverlap ${c.noverlap}, nfft ${c.nfft}`, async () => {
      const res = spectrogram(await input(c.input), { fs: c.fs, nperseg: c.nperseg, noverlap: c.noverlap, nfft: c.nfft });
      expect(res.nfreq).toBe(c.nfreq);
      expect(Array.from(res.times)).toEqual(c.times.map((t: number) => expect.closeTo(t, 9)));
      const ref = f64(c.output);
      expect(res.psd.length).toBe(ref.length);
      expect(maxRelErr(res.psd, ref)).toBeLessThan(1e-9);
    });
  }
});

describe('dsp units', () => {
  it('FFT of an impulse and of a cosine', () => {
    const re = new Float64Array(8);
    const im = new Float64Array(8);
    re[0] = 1;
    fft(re, im);
    expect(Array.from(re)).toEqual(new Array(8).fill(1));
    const n = 64;
    const r2 = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n));
    const i2 = new Float64Array(n);
    fft(r2, i2);
    expect(r2[5]).toBeCloseTo(32, 10);
    expect(r2[59]).toBeCloseTo(32, 10);
    expect(Math.abs(r2[6])).toBeLessThan(1e-10);
  });
  it('notch removes its centre frequency and keeps others', () => {
    const fs = 256;
    const x = Float64Array.from({ length: fs * 20 }, (_, i) => Math.sin((2 * Math.PI * 50 * i) / fs) + Math.sin((2 * Math.PI * 10 * i) / fs));
    const y = sosfiltfilt(iirnotch(50, 30, fs), x);
    let err = 0;
    for (let i = fs * 5; i < fs * 15; i++) err = Math.max(err, Math.abs(y[i] - Math.sin((2 * Math.PI * 10 * i) / fs)));
    expect(err).toBeLessThan(0.01);
  });
  it('a cutoff at or above Nyquist is skipped, not applied', () => {
    const { stages, skipped } = designChain({ highpass: 0.5, lowpass: 70, notch: 60, order: 2, notchQ: 30 }, 100);
    expect(stages.length).toBe(1);
    expect(skipped).toEqual(['low-pass 70 Hz', 'notch 60 Hz']);
  });
  it('min/max decimation keeps a one-sample spike and leaves gaps empty', () => {
    const fs = 1000;
    const x = new Float32Array(10_000);
    x[5123] = 7;
    for (let i = 8000; i < 9000; i++) x[i] = Number.NaN;
    const d = decimateMinMax(x, 0, fs, 0, 10, 100);
    expect(d.mode).toBe('minmax');
    expect(Math.max(...Array.from(d.data).filter((v) => !Number.isNaN(v)))).toBe(7);
    expect(Number.isNaN(d.data[2 * 85])).toBe(true);
    const raw = decimateMinMax(x, 0, fs, 0, 0.1, 100);
    expect(raw.mode).toBe('raw');
    expect(raw.data.length).toBe(101);
  });
});

function resp(sos: Float64Array, w: number): number {
  let re = 1;
  let im = 0;
  for (let s = 0; s < sos.length; s += 6) {
    const z1r = Math.cos(w);
    const z1i = -Math.sin(w);
    const z2r = Math.cos(2 * w);
    const z2i = -Math.sin(2 * w);
    const nr = sos[s] + sos[s + 1] * z1r + sos[s + 2] * z2r;
    const ni = sos[s + 1] * z1i + sos[s + 2] * z2i;
    const dr = sos[s + 3] + sos[s + 4] * z1r + sos[s + 5] * z2r;
    const di = sos[s + 4] * z1i + sos[s + 5] * z2i;
    const d = dr * dr + di * di;
    const qr = (nr * dr + ni * di) / d;
    const qi = (ni * dr - nr * di) / d;
    const t = re * qr - im * qi;
    im = re * qi + im * qr;
    re = t;
  }
  return Math.hypot(re, im);
}
