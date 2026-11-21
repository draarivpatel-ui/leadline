// Small pure-function units: FFT helpers, decimation, filter internals, source caching, contiguity.
import { describe, expect, it } from 'vitest';
import { decimateMinMax } from '../src/core/dsp/decimate';
import { fft, isPowerOfTwo, nextPowerOfTwo } from '../src/core/dsp/fft';
import { butter, defaultPadlen, designChain, iirnotch, responseAt, settleSamples, sosfilt, sosfiltZi } from '../src/core/dsp/iir';
import { hann, spectrogram } from '../src/core/dsp/spectrogram';
import { cachedSource } from '../src/core/edf/cached';
import { contiguityTolerance } from '../src/core/edf/recording';
import { bytesSource } from '../src/core/edf/source';

describe('FFT helpers', () => {
  it('power-of-two checks and rounding up', () => {
    for (const [n, p2, next] of [[1, true, 1], [2, true, 2], [3, false, 4], [1024, true, 1024], [1000, false, 1024], [0, false, 1], [-4, false, 1]] as const) {
      expect(isPowerOfTwo(n), `isPowerOfTwo(${n})`).toBe(p2);
      expect(nextPowerOfTwo(n), `nextPowerOfTwo(${n})`).toBe(next);
    }
  });

  it('matches a naive DFT', () => {
    const n = 16;
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) + i / n);
    const im = new Float64Array(n);
    const reCopy = Float64Array.from(re);
    fft(re, im);
    for (let k = 0; k < n; k++) {
      let er = 0;
      let ei = 0;
      for (let j = 0; j < n; j++) {
        const a = (-2 * Math.PI * k * j) / n;
        er += reCopy[j] * Math.cos(a);
        ei += reCopy[j] * Math.sin(a);
      }
      expect(re[k]).toBeCloseTo(er, 9);
      expect(im[k]).toBeCloseTo(ei, 9);
    }
  });

  it('rejects a non-power-of-two length', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(RangeError);
    expect(() => fft(new Float64Array(8), new Float64Array(4))).toThrow(RangeError);
  });
});

describe('min/max decimation', () => {
  const x = Float64Array.from({ length: 100 }, (_, i) => i);

  it('returns raw samples when they fit the columns', () => {
    const d = decimateMinMax(x, 0, 100, 0, 1, 100);
    expect(d.mode).toBe('raw');
    expect(d.data.length).toBe(100);
    expect(d.dt).toBe(0.01);
  });

  it('keeps the min and the max of each column', () => {
    const d = decimateMinMax(x, 0, 100, 0, 1, 10);
    expect(d.mode).toBe('minmax');
    expect(d.data.length).toBe(20);
    for (let c = 0; c < 10; c++) {
      expect(d.data[2 * c]).toBeCloseTo(10 * c, 6);
      expect(d.data[2 * c + 1]).toBeGreaterThanOrEqual(d.data[2 * c]);
    }
  });

  it('a column with only NaN stays NaN; NaN never wins a min or max', () => {
    const g = Float64Array.from({ length: 100 }, (_, i) => (i < 20 || i > 39 ? i : Number.NaN));
    const d = decimateMinMax(g, 0, 100, 0, 1, 10);
    expect(Number.isNaN(d.data[4])).toBe(true); // column 2 spans samples 20-30, all NaN
    expect(Number.isNaN(d.data[5])).toBe(true);
    expect(d.data[0]).toBe(0);
    expect(d.data[7]).toBe(40); // column 3 max is the first sample after the gap
  });

  it('empty windows and empty data give empty results', () => {
    expect(decimateMinMax(x, 0, 100, 50, 10, 10).data.length).toBe(0);
    expect(decimateMinMax([], 0, 100, 0, 1, 10).data.length).toBe(0);
  });
});

describe('Hann window and spectrogram guards', () => {
  it('the window is periodic with unit peak', () => {
    const w = hann(8);
    expect(w[0]).toBe(0);
    expect(w[4]).toBeCloseTo(1, 12);
    expect(w.length).toBe(8);
    // Periodic (SciPy fftbins): w[i] = w[N - i] would need the N-1 form; the periodic form has w[1] = w[7].
    expect(w[1]).toBeCloseTo(w[7], 12);
  });

  it('validates its shape arguments', () => {
    const x = new Float64Array(32);
    expect(() => spectrogram(x, { fs: 100, nperseg: 1, noverlap: 0 })).toThrow(RangeError);
    expect(() => spectrogram(x, { fs: 100, nperseg: 8, noverlap: 8 })).toThrow(RangeError);
    expect(() => spectrogram(x, { fs: 100, nperseg: 8, noverlap: -1 })).toThrow(RangeError);
    expect(() => spectrogram(x, { fs: 100, nperseg: 10, noverlap: 0, nfft: 8 })).toThrow(RangeError);
    expect(() => spectrogram(x, { fs: 100, nperseg: 10, noverlap: 0, nfft: 12 })).toThrow(RangeError);
  });

  it('a pure tone peaks at its frequency', () => {
    const fs = 256;
    const x = Float64Array.from({ length: 1024 }, (_, i) => Math.sin((2 * Math.PI * 10 * i) / fs));
    const r = spectrogram(x, { fs, nperseg: 256, noverlap: 128 });
    let best = 0;
    for (let k = 1; k < r.nfreq; k++) if (r.psd[k] > r.psd[best]) best = k;
    expect(r.freqs[best]).toBeCloseTo(10, 6);
  });
});

describe('filter internals', () => {
  it('designChain skips what a sample rate cannot carry, in order', () => {
    const f = { highpass: 1, lowpass: 40, notch: 60, order: 2, notchQ: 30 };
    const slow = designChain(f, 100);
    expect(slow.stages.length).toBe(2); // high-pass + low-pass; notch 60 > Nyquist 50
    expect(slow.skipped).toEqual(['notch 60 Hz']);
    const all = designChain(f, 500);
    expect(all.stages.length).toBe(3);
    expect(all.skipped).toEqual([]);
  });

  it('butter and iirnotch reject impossible cutoffs', () => {
    expect(() => butter(0, 10, 'lowpass', 100)).toThrow(RangeError);
    expect(() => butter(2, 50, 'lowpass', 100)).toThrow(RangeError);
    expect(() => butter(2, -1, 'highpass', 100)).toThrow(RangeError);
    expect(() => iirnotch(60, 30, 100)).toThrow(RangeError);
    expect(() => iirnotch(50, 0, 200)).toThrow(RangeError);
  });

  it('a notch removes its centre and passes DC', () => {
    const sos = iirnotch(60, 30, 500);
    expect(responseAt(sos, 0)).toBeCloseTo(1, 9);
    expect(responseAt(sos, (2 * Math.PI * 60) / 500)).toBeLessThan(1e-6);
  });

  it('sosfiltZi is the steady state: a constant stays constant', () => {
    const sos = butter(2, 30, 'lowpass', 500);
    const zi = sosfiltZi(sos);
    const x = new Float64Array(64).fill(2);
    const z = zi.map((v) => v * 2);
    sosfilt(sos, x, z);
    for (const v of x) expect(v).toBeCloseTo(2, 6);
  });

  it('pad length and settle length are finite and positive', () => {
    const sos = butter(2, 5, 'highpass', 200);
    expect(defaultPadlen(sos)).toBeGreaterThan(0);
    expect(settleSamples(sos)).toBeGreaterThan(0);
    expect(Number.isFinite(settleSamples(iirnotch(50, 30, 500)))).toBe(true);
  });
});

describe('byte source cache', () => {
  it('serves repeated small reads from one underlying block read', async () => {
    const base = bytesSource(new Uint8Array(1 << 20).map((_, i) => i & 0xff));
    let reads = 0;
    const counting = { size: base.size, read: (o: number, l: number) => (reads++, base.read(o, l)) };
    const cached = cachedSource(counting, 1 << 16, 4);
    await cached.read(10, 20);
    await cached.read(20, 30); // same 64 KiB block
    expect(reads).toBe(1);
    await cached.read(3 * (1 << 16) + 5, 10); // another block
    expect(reads).toBe(2);
  });

  it('reads past the end come back empty and clamped', async () => {
    const s = bytesSource(new Uint8Array(8).map((_, i) => i));
    expect((await s.read(6, 10)).length).toBe(2);
    expect((await s.read(9, 5)).length).toBe(0);
    const c = cachedSource(s, 4, 2);
    expect(Array.from(await c.read(6, 10))).toEqual([6, 7]);
  });

  it('large reads bypass the cache', async () => {
    const base = bytesSource(new Uint8Array(1 << 18));
    let reads = 0;
    const counting = { size: base.size, read: (o: number, l: number) => (reads++, base.read(o, l)) };
    const cached = cachedSource(counting, 1 << 16, 4);
    await cached.read(0, 3 * (1 << 16)); // 3 blocks > maxBlocks/2
    expect(reads).toBe(1); // straight through, not per block
  });
});

describe('contiguityTolerance', () => {
  const header = (rates: number[]) => ({ signals: rates.map((sampleRate) => ({ isAnnotation: false, sampleRate })) }) as never;

  it('is half a sample of the fastest signal, with a floor', () => {
    expect(contiguityTolerance(header([256, 100]))).toBeCloseTo(0.5 / 256, 9);
    expect(contiguityTolerance(header([1]))).toBeCloseTo(0.5, 9);
    expect(contiguityTolerance(header([]))).toBe(1e-7);
    expect(contiguityTolerance(header([1e9]))).toBe(1e-7);
  });
});
