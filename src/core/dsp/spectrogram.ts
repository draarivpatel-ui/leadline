/**
 * Short-time power spectral density, matching scipy.signal.spectrogram(x, fs, window='hann', nperseg,
 * noverlap, nfft, detrend='constant', scaling='density', mode='psd'): periodic Hann window, segment mean removed,
 * one-sided density in units^2/Hz.
 */
import { fft, isPowerOfTwo, nextPowerOfTwo } from './fft';

export interface SpectrogramOptions {
  fs: number;
  nperseg: number;
  noverlap: number;
  /** FFT length, a power of two >= nperseg. Defaults to the next power of two. */
  nfft?: number;
}

export interface SpectrogramResult {
  /** Segment centres, seconds from the start of x. */
  times: Float64Array;
  freqs: Float64Array;
  /** Row-major [time][freq] power spectral density. NaN for segments that contain NaN (recording gaps). */
  psd: Float64Array;
  nfreq: number;
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

export function spectrogram(x: ArrayLike<number>, o: SpectrogramOptions): SpectrogramResult {
  const { fs, nperseg, noverlap } = o;
  if (!(nperseg >= 2) || noverlap < 0 || noverlap >= nperseg) throw new RangeError('Need nperseg >= 2 and 0 <= noverlap < nperseg.');
  const nfft = o.nfft ?? nextPowerOfTwo(nperseg);
  if (!isPowerOfTwo(nfft) || nfft < nperseg) throw new RangeError('nfft must be a power of two and at least nperseg.');
  const step = nperseg - noverlap;
  const count = x.length < nperseg ? 0 : Math.floor((x.length - noverlap) / step);
  const nfreq = nfft / 2 + 1;
  const w = hann(nperseg);
  let wss = 0;
  for (let i = 0; i < nperseg; i++) wss += w[i] * w[i];
  const scale = 1 / (fs * wss);
  const psd = new Float64Array(count * nfreq);
  const times = new Float64Array(count);
  const freqs = new Float64Array(nfreq);
  for (let k = 0; k < nfreq; k++) freqs[k] = (k * fs) / nfft;
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let s = 0; s < count; s++) {
    const off = s * step;
    times[s] = (off + nperseg / 2) / fs;
    let mean = 0;
    let bad = false;
    for (let i = 0; i < nperseg; i++) {
      const v = x[off + i];
      if (Number.isNaN(v)) bad = true;
      mean += v;
    }
    if (bad) {
      psd.fill(Number.NaN, s * nfreq, (s + 1) * nfreq);
      continue;
    }
    mean /= nperseg;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < nperseg; i++) re[i] = (x[off + i] - mean) * w[i];
    fft(re, im);
    for (let k = 0; k < nfreq; k++) {
      let p = (re[k] * re[k] + im[k] * im[k]) * scale;
      if (k !== 0 && !(k === nfft / 2)) p *= 2;
      psd[s * nfreq + k] = p;
    }
  }
  return { times, freqs, psd, nfreq };
}
