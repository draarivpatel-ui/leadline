/**
 * A parsed recording: header, record start times, annotations, and windowed reads of digital or physical
 * samples. Data records are read with one byte-range read per window, never the whole file.
 */
import { EdfError } from './errors';
import { parseHeader, type EdfHeader, type ParseOptions, type SignalHeader } from './header';
import type { ByteSource } from './source';
import { parseTals, type Annotation } from './tal';

export interface Segment {
  /** First record of a run of contiguous records. */
  firstRecord: number;
  /** One past the last record of the run. */
  endRecord: number;
  /** Seconds after the header start. */
  start: number;
  end: number;
}

export interface OpenOptions extends ParseOptions {
  /** Bytes read per step while scanning annotations. */
  scanChunkBytes?: number;
  onProgress?: (fraction: number) => void;
}

export interface TimeRead {
  /** Time of the first sample, seconds after the header start. */
  t0: number;
  sampleRate: number;
  /** Physical values on a uniform grid; NaN where the recording has no data (EDF+D gaps). */
  data: Float32Array;
}

/**
 * Tolerance for treating record boundaries as contiguous: half a sample of the fastest signal, at least 1e-7 s.
 * The 8-character duration field cannot hold every duration exactly (1/30 s is written "0.033333"), so an exact
 * TAL onset can miss the rounded record end by far more than 1e-7 s while still being the next sample. Records
 * are placed on the sample grid by rounding anyway, so a smaller mismatch never moves a sample.
 */
export function contiguityTolerance(header: Pick<EdfHeader, 'signals'>): number {
  const fastest = Math.max(0, ...header.signals.filter((s) => !s.isAnnotation).map((s) => s.sampleRate));
  return fastest > 0 ? Math.max(1e-7, 0.5 / fastest) : 1e-7;
}

export class EdfRecording {
  readonly header: EdfHeader;
  readonly source: ByteSource;
  /** Start time of every data record, seconds after the header start. */
  readonly recordOnsets: Float64Array;
  readonly annotations: Annotation[];
  readonly segments: Segment[];
  readonly warnings: string[];

  private constructor(source: ByteSource, header: EdfHeader, onsets: Float64Array, annotations: Annotation[], warnings: string[]) {
    this.source = source;
    this.header = header;
    this.recordOnsets = onsets;
    this.annotations = annotations;
    this.warnings = warnings;
    this.segments = buildSegments(onsets, header.recordDuration, contiguityTolerance(header));
  }

  static async open(source: ByteSource, options: OpenOptions = {}): Promise<EdfRecording> {
    const header = await parseHeader(source, options);
    const warnings = [...header.warnings];
    const n = header.recordCount;
    const onsets = new Float64Array(n);
    const annotations: Annotation[] = [];
    const annSignals = header.signals.filter((s) => s.isAnnotation);

    if (annSignals.length === 0) {
      for (let r = 0; r < n; r++) onsets[r] = r * header.recordDuration;
    } else {
      const perChunk = Math.max(1, Math.floor((options.scanChunkBytes ?? 8 << 20) / header.recordBytes));
      let missing = 0;
      const problemSet = new Set<string>();
      for (let r0 = 0; r0 < n; r0 += perChunk) {
        const count = Math.min(perChunk, n - r0);
        const bytes = await source.read(header.headerBytes + r0 * header.recordBytes, count * header.recordBytes);
        for (let k = 0; k < count; k++) {
          const rec = bytes.subarray(k * header.recordBytes, (k + 1) * header.recordBytes);
          let onset: number | null = null;
          annSignals.forEach((s, si) => {
            const res = parseTals(rec.subarray(s.byteOffset, s.byteOffset + s.samplesPerRecord * header.bytesPerSample), si === 0);
            if (si === 0) onset = res.recordOnset;
            for (const a of res.annotations) annotations.push(a);
            for (const p of res.problems) problemSet.add(p);
          });
          if (onset === null) {
            missing++;
            onsets[r0 + k] = r0 + k === 0 ? 0 : onsets[r0 + k - 1] + header.recordDuration;
          } else {
            onsets[r0 + k] = onset;
          }
        }
        options.onProgress?.(Math.min(1, (r0 + count) / n));
      }
      for (const p of problemSet) warnings.push(p);
      if (missing > 0) {
        if (header.discontinuous) {
          throw new EdfError('NO_TIMEKEEPING', `${missing} data records of this ${header.variant} file have no time-keeping annotation, so their start times are unknown.`);
        }
        warnings.push(`${missing} data records have no time-keeping annotation; contiguous timing was assumed for them.`);
      }
      const eps = contiguityTolerance(header);
      if (!header.discontinuous && header.recordDuration > 0) {
        let gaps = 0;
        for (let r = 1; r < n; r++) {
          if (Math.abs(onsets[r] - onsets[r - 1] - header.recordDuration) > eps) gaps++;
        }
        if (gaps > 0) warnings.push(`The file is marked continuous (${header.variant}) but ${gaps} record boundaries are not contiguous; the recorded start times are used.`);
      }
      for (let r = 1; r < n; r++) {
        if (onsets[r] < onsets[r - 1] + header.recordDuration - eps) {
          throw new EdfError('BAD_TAL', `Data record ${r + 1} starts before the previous record ends; records must follow in time.`);
        }
      }
    }
    annotations.sort((a, b) => a.onset - b.onset);
    return new EdfRecording(source, header, onsets, annotations, warnings);
  }

  /** Ordinary (non-annotation) signals. */
  get signals(): SignalHeader[] {
    return this.header.signals.filter((s) => !s.isAnnotation);
  }

  /** Seconds from the header start to the end of the last record. */
  get duration(): number {
    const n = this.header.recordCount;
    return n === 0 ? 0 : this.recordOnsets[n - 1] + this.header.recordDuration;
  }

  /** Reads raw bytes of records [first, first + count). */
  async readRecords(first: number, count: number): Promise<Uint8Array> {
    const h = this.header;
    if (first < 0 || count < 0 || first + count > h.recordCount) throw new RangeError(`Records ${first}..${first + count} are outside 0..${h.recordCount}.`);
    return this.source.read(h.headerBytes + first * h.recordBytes, count * h.recordBytes);
  }

  /** Digital sample values of one signal for records [first, first + count). */
  async readDigital(signal: number, first: number, count: number): Promise<Int32Array> {
    const bytes = await this.readRecords(first, count);
    return decodeDigital(bytes, this.header, this.header.signals[signal], count);
  }

  /** Physical values in float64, computed the way EDFlib (and so pyEDFlib) does: bitValue * (offset + digital). */
  async readPhysical(signal: number, first: number, count: number): Promise<Float64Array> {
    const s = this.header.signals[signal];
    const d = await this.readDigital(signal, first, count);
    const out = new Float64Array(d.length);
    for (let i = 0; i < d.length; i++) out[i] = s.bitValue * (s.offset + d[i]);
    return out;
  }

  /** Index of the last record whose onset is <= t (or 0). */
  recordAt(t: number): number {
    const o = this.recordOnsets;
    let lo = 0;
    let hi = o.length - 1;
    if (hi < 0 || t <= o[0]) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (o[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Physical values of several signals over [t0, t1) seconds, each on its own uniform sample grid. Samples that
   * fall in a recording gap are NaN. One byte-range read covers all requested signals.
   */
  async readTime(signals: number[], t0: number, t1: number): Promise<TimeRead[]> {
    const h = this.header;
    const dur = h.recordDuration;
    const empty = () => signals.map((i) => ({ t0, sampleRate: h.signals[i].sampleRate, data: new Float32Array(0) }));
    if (h.recordCount === 0 || t1 <= t0 || dur <= 0) return empty();
    const first = this.recordAt(t0);
    let last = this.recordAt(t1);
    // A record that starts at or after t1 is not needed, unless it starts within the contiguity tolerance of t1:
    // with a rounded duration field the grid's last sample can fall a hair before that record's onset.
    if (this.recordOnsets[last] >= t1 + contiguityTolerance(h) && last > first) last--;
    const bytes = await this.readRecords(first, last - first + 1);
    return signals.map((i) => {
      const s = h.signals[i];
      const fs = s.sampleRate;
      const spr = s.samplesPerRecord;
      // Grid anchored on the sample times of the first record touched.
      const anchor = this.recordOnsets[first];
      const startIdx = Math.ceil((t0 - anchor) * fs - 1e-9);
      const gridT0 = anchor + startIdx / fs;
      const len = Math.max(0, Math.ceil((t1 - gridT0) * fs - 1e-9));
      const out = new Float32Array(len).fill(Number.NaN);
      for (let r = first; r <= last; r++) {
        const rec = bytes.subarray((r - first) * h.recordBytes, (r - first + 1) * h.recordBytes);
        const k0 = Math.round((this.recordOnsets[r] - gridT0) * fs);
        const view = new DataView(rec.buffer, rec.byteOffset + s.byteOffset, spr * h.bytesPerSample);
        for (let j = 0; j < spr; j++) {
          const k = k0 + j;
          if (k < 0) continue;
          if (k >= len) break;
          out[k] = s.bitValue * (s.offset + sampleAt(view, j, h.bytesPerSample));
        }
      }
      return { t0: gridT0, sampleRate: fs, data: out };
    });
  }
}

function sampleAt(view: DataView, j: number, bps: 2 | 3): number {
  if (bps === 2) return view.getInt16(j * 2, true);
  const o = j * 3;
  const v = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
  return (v << 8) >> 8;
}

export function decodeDigital(bytes: Uint8Array, h: EdfHeader, s: SignalHeader, count: number): Int32Array {
  const spr = s.samplesPerRecord;
  const out = new Int32Array(spr * count);
  for (let r = 0; r < count; r++) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + r * h.recordBytes + s.byteOffset, spr * h.bytesPerSample);
    for (let j = 0; j < spr; j++) out[r * spr + j] = sampleAt(view, j, h.bytesPerSample);
  }
  return out;
}

function buildSegments(onsets: Float64Array, dur: number, eps: number): Segment[] {
  const segments: Segment[] = [];
  const n = onsets.length;
  if (n === 0) return segments;
  let first = 0;
  for (let r = 1; r <= n; r++) {
    if (r === n || Math.abs(onsets[r] - (onsets[r - 1] + dur)) > eps) {
      segments.push({ firstRecord: first, endRecord: r, start: onsets[first], end: onsets[r - 1] + dur });
      first = r;
    }
  }
  return segments;
}
