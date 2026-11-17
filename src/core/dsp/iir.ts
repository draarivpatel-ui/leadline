/**
 * IIR filter design and zero-phase filtering, written to reproduce SciPy (see SPEC.md "Filters"):
 *   butter(N, Wn, btype, fs=fs, output='sos')    Butterworth via bilinear transform with prewarping
 *   iirnotch(w0, Q, fs)                           second-order notch
 *   sosfiltfilt(sos, x)  /  filtfilt(b, a, x)     forward-backward with odd extension and steady-state zi
 * The algorithms are the published textbook ones (and SciPy's documented behaviour); no SciPy code is copied.
 */

/** Second-order sections, 6 numbers each: b0 b1 b2 a0 a1 a2 (a0 = 1). */
export type Sos = Float64Array;

interface Complex {
  re: number;
  im: number;
}

/** Butterworth low-pass or high-pass, as second-order sections. Cutoff in Hz. */
export function butter(order: number, cutoff: number, type: 'lowpass' | 'highpass', fs: number): Sos {
  if (!Number.isInteger(order) || order < 1) throw new RangeError('The filter order must be a positive whole number.');
  const wn = (2 * cutoff) / fs;
  if (!(wn > 0 && wn < 1)) throw new RangeError(`A ${cutoff} Hz cutoff needs a sample rate above ${2 * cutoff} Hz (this one is ${fs} Hz).`);
  // Analog prototype poles on the unit circle (left half plane), then prewarp to the digital cutoff (fs = 2).
  const warped = 4 * Math.tan((Math.PI * wn) / 2);
  const poles: Complex[] = [];
  for (let m = -order + 1; m < order; m += 2) {
    const theta = (Math.PI * m) / (2 * order);
    // p = -exp(j * theta)
    poles.push({ re: -Math.cos(theta), im: -Math.sin(theta) });
  }
  const analog = poles.map((p) => (type === 'lowpass' ? { re: p.re * warped, im: p.im * warped } : cdiv({ re: warped, im: 0 }, p)));
  // Bilinear transform with fs2 = 4: z = (4 + s) / (4 - s).
  const digital = analog.map((s) => cdiv({ re: 4 + s.re, im: s.im }, { re: 4 - s.re, im: -s.im }));
  const zero = type === 'lowpass' ? -1 : 1;
  // Overall gain chosen so the passband (DC for low-pass, Nyquist for high-pass) has unit gain.
  const sections: number[][] = [];
  const sorted = [...digital].sort((a, b) => a.im - b.im);
  const used = new Array(sorted.length).fill(false);
  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    const p = sorted[i];
    if (Math.abs(p.im) < 1e-14) {
      used[i] = true;
      sections.push([1, -zero, 0, 1, -p.re, 0]);
      continue;
    }
    // Find its conjugate.
    let j = -1;
    for (let k = i + 1; k < sorted.length; k++) {
      if (!used[k] && Math.abs(sorted[k].re - p.re) < 1e-12 && Math.abs(sorted[k].im + p.im) < 1e-12) {
        j = k;
        break;
      }
    }
    if (j < 0) throw new Error('Butterworth design failed: an unpaired complex pole.');
    used[i] = used[j] = true;
    sections.push([1, -2 * zero, 1, 1, -2 * p.re, p.re * p.re + p.im * p.im]);
  }
  // Order sections like SciPy's zpk2sos (poles closest to the unit circle last); the cascade is the same
  // transfer function either way, this only keeps the arithmetic close to SciPy's.
  sections.sort((a, b) => sectionRadius(a) - sectionRadius(b));
  const sos = new Float64Array(sections.length * 6);
  sections.forEach((s, i) => sos.set(s, i * 6));
  // Normalise the passband gain at z = 1 (low-pass) or z = -1 (high-pass).
  const g = Math.abs(responseAt(sos, type === 'lowpass' ? 0 : Math.PI));
  for (let k = 0; k < 3; k++) sos[k] /= g;
  return sos;
}

/** SciPy iirnotch: removes a narrow band around f0 Hz with quality factor Q. */
export function iirnotch(f0: number, q: number, fs: number): Sos {
  const w0n = (2 * f0) / fs;
  if (!(w0n > 0 && w0n < 1)) throw new RangeError(`A ${f0} Hz notch needs a sample rate above ${2 * f0} Hz (this one is ${fs} Hz).`);
  if (!(q > 0)) throw new RangeError('The notch quality factor must be above 0.');
  const bw = (w0n / q) * Math.PI;
  const w0 = w0n * Math.PI;
  const beta = Math.tan(bw / 2); // sqrt(1 - gb^2) / gb with gb = 1/sqrt(2) is exactly 1
  const gain = 1 / (1 + beta);
  const c = Math.cos(w0);
  return Float64Array.of(gain, -2 * gain * c, gain, 1, -2 * gain * c, 2 * gain - 1);
}

function sectionRadius(s: number[]): number {
  return Math.sqrt(Math.abs(s[5])) || Math.abs(s[4]);
}

function cdiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

/** Complex frequency response of the cascade at angular frequency w (radians per sample). */
export function responseAt(sos: Sos, w: number): number {
  let re = 1;
  let im = 0;
  const z1 = { re: Math.cos(-w), im: Math.sin(-w) };
  const z2 = { re: Math.cos(-2 * w), im: Math.sin(-2 * w) };
  for (let s = 0; s < sos.length; s += 6) {
    const nr = sos[s] + sos[s + 1] * z1.re + sos[s + 2] * z2.re;
    const ni = sos[s + 1] * z1.im + sos[s + 2] * z2.im;
    const dr = sos[s + 3] + sos[s + 4] * z1.re + sos[s + 5] * z2.re;
    const di = sos[s + 4] * z1.im + sos[s + 5] * z2.im;
    const q = cdiv({ re: nr, im: ni }, { re: dr, im: di });
    const r2 = re * q.re - im * q.im;
    im = re * q.im + im * q.re;
    re = r2;
  }
  return Math.hypot(re, im);
}

/** Steady-state initial conditions for a unit step, per section (SciPy sosfilt_zi). */
export function sosfiltZi(sos: Sos): Float64Array {
  const n = sos.length / 6;
  const zi = new Float64Array(n * 2);
  let scale = 1;
  for (let s = 0; s < n; s++) {
    const [b0, b1, b2, , a1, a2] = sos.subarray(s * 6, s * 6 + 6);
    // Solve (I - A^T) z = B for the transposed direct form II state (SciPy lfilter_zi).
    const B0 = b1 - a1 * b0;
    const B1 = b2 - a2 * b0;
    const det = 1 + a1 + a2;
    zi[s * 2] = ((B0 + B1) / det) * scale;
    zi[s * 2 + 1] = (((1 + a1) * B1 - a2 * B0) / det) * scale;
    scale *= (b0 + b1 + b2) / (1 + a1 + a2);
  }
  return zi;
}

/** In-place cascade filter, transposed direct form II. `zi` is consumed and updated. */
export function sosfilt(sos: Sos, x: Float64Array, zi?: Float64Array): void {
  const n = sos.length / 6;
  const state = zi ?? new Float64Array(n * 2);
  for (let s = 0; s < n; s++) {
    const b0 = sos[s * 6];
    const b1 = sos[s * 6 + 1];
    const b2 = sos[s * 6 + 2];
    const a1 = sos[s * 6 + 4];
    const a2 = sos[s * 6 + 5];
    let z0 = state[s * 2];
    let z1 = state[s * 2 + 1];
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const y = b0 * xi + z0;
      z0 = b1 * xi - a1 * y + z1;
      z1 = b2 * xi - a2 * y;
      x[i] = y;
    }
    state[s * 2] = z0;
    state[s * 2 + 1] = z1;
  }
}

/** SciPy's default pad length for sosfiltfilt (also equals filtfilt's for a single biquad). */
export function defaultPadlen(sos: Sos): number {
  const n = sos.length / 6;
  let zb = 0;
  let za = 0;
  for (let s = 0; s < n; s++) {
    if (sos[s * 6 + 2] === 0) zb++;
    if (sos[s * 6 + 5] === 0) za++;
  }
  return 3 * (2 * n + 1 - Math.min(zb, za));
}

/**
 * Zero-phase filtering like SciPy sosfiltfilt(sos, x, padtype='odd'). When the input is shorter than the
 * default pad length, the pad shrinks to length - 1 (SciPy raises an error instead).
 */
export function sosfiltfilt(sos: Sos, x: ArrayLike<number>, padlen = defaultPadlen(sos)): Float64Array {
  const n = x.length;
  if (n === 0) return new Float64Array(0);
  if (n === 1) {
    // A single sample has no shape to filter; return the steady-state response (DC gain times the value).
    const g = dcGain(sos);
    return Float64Array.of(x[0] * g * g);
  }
  const pad = Math.min(padlen, n - 1);
  const ext = new Float64Array(n + 2 * pad);
  const x0 = x[0];
  const xn = x[n - 1];
  for (let i = 0; i < pad; i++) ext[i] = 2 * x0 - x[pad - i];
  for (let i = 0; i < n; i++) ext[pad + i] = x[i];
  for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * xn - x[n - 2 - i];
  const zi = sosfiltZi(sos);
  const z = zi.map((v) => v * ext[0]);
  sosfilt(sos, ext, z);
  ext.reverse();
  const z2 = zi.map((v) => v * ext[0]);
  sosfilt(sos, ext, z2);
  ext.reverse();
  return ext.slice(pad, pad + n);
}

function dcGain(sos: Sos): number {
  let g = 1;
  for (let s = 0; s < sos.length; s += 6) g *= (sos[s] + sos[s + 1] + sos[s + 2]) / (sos[s + 3] + sos[s + 4] + sos[s + 5]);
  return g;
}

/**
 * Number of samples after which the impulse response of every section has decayed below `tol` of its peak,
 * from the pole radii. Used to size the margin read around a window so windowed zero-phase filtering matches
 * filtering the whole recording.
 */
export function settleSamples(sos: Sos, tol = 1e-6): number {
  let worst = 0;
  for (let s = 0; s < sos.length; s += 6) {
    const a1 = sos[s + 4];
    const a2 = sos[s + 5];
    // Pole radius: sqrt(a2) for complex pairs, else the largest real root magnitude.
    const disc = a1 * a1 - 4 * a2;
    const r = disc < 0 ? Math.sqrt(a2) : Math.max(Math.abs((-a1 + Math.sqrt(disc)) / 2), Math.abs((-a1 - Math.sqrt(disc)) / 2));
    if (r >= 1) return Number.POSITIVE_INFINITY;
    if (r > 0) worst = Math.max(worst, Math.log(tol) / Math.log(r));
  }
  return Math.ceil(worst);
}

export interface FilterSettings {
  /** High-pass cutoff in Hz, or 0 for off. */
  highpass: number;
  /** Low-pass cutoff in Hz, or 0 for off. */
  lowpass: number;
  /** Notch centre in Hz (50 or 60), or 0 for off. */
  notch: number;
  /** Butterworth order of each pass before the zero-phase doubling. */
  order: number;
  notchQ: number;
}

export const DEFAULT_FILTERS: FilterSettings = { highpass: 0, lowpass: 0, notch: 0, order: 2, notchQ: 30 };

/** The filter stages for one sample rate, in the order they are applied. Stages a rate cannot carry are skipped. */
export function designChain(f: FilterSettings, fs: number): { stages: Sos[]; skipped: string[] } {
  const stages: Sos[] = [];
  const skipped: string[] = [];
  if (f.highpass > 0) {
    if ((2 * f.highpass) / fs < 1) stages.push(butter(f.order, f.highpass, 'highpass', fs));
    else skipped.push(`high-pass ${f.highpass} Hz`);
  }
  if (f.lowpass > 0) {
    if ((2 * f.lowpass) / fs < 1) stages.push(butter(f.order, f.lowpass, 'lowpass', fs));
    else skipped.push(`low-pass ${f.lowpass} Hz`);
  }
  if (f.notch > 0) {
    if ((2 * f.notch) / fs < 1) stages.push(iirnotch(f.notch, f.notchQ, fs));
    else skipped.push(`notch ${f.notch} Hz`);
  }
  return { stages, skipped };
}

/** Applies each stage with sosfiltfilt in turn. */
export function applyChain(stages: Sos[], x: ArrayLike<number>): Float64Array {
  let y: Float64Array = Float64Array.from(x as ArrayLike<number>);
  for (const s of stages) y = sosfiltfilt(s, y);
  return y;
}
