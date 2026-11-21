/**
 * The viewer engine: everything the UI asks for, as plain async methods on data that can cross a Worker
 * boundary (numbers, strings and typed arrays). `worker.ts` exposes it inside a Web Worker; it also runs as is
 * in Node for tests.
 */
import { decimateMinMax } from './dsp/decimate';
import { applyChain, DEFAULT_FILTERS, designChain, settleSamples, type FilterSettings, type Sos } from './dsp/iir';
import { spectrogram as stft } from './dsp/spectrogram';
import { cachedSource } from './edf/cached';
import { EdfError } from './edf/errors';
import type { SignalHeader, Variant } from './edf/header';
import { EdfRecording, type Segment } from './edf/recording';
import { blobSource, type ByteSource } from './edf/source';
import type { Annotation } from './edf/tal';
import { buildHypnogram, type Hypnogram } from './hypnogram';
import { buildMontages, EOG_MAX_HIGHPASS, type ChannelKind, type Derivation, type Montage, type MontageId } from './montage';

export const API_VERSION = 1;

export interface SignalInfo {
  index: number;
  label: string;
  unit: string;
  sampleRate: number;
  transducer: string;
  prefiltering: string;
  physicalMin: number;
  physicalMax: number;
}

export interface MontageInfo {
  id: MontageId;
  name: string;
  count: number;
  note?: string;
}

export interface RecordingInfo {
  apiVersion: number;
  fileName: string;
  fileBytes: number;
  variant: Variant;
  /** Local wall-clock start, "YYYY-MM-DDTHH:MM:SS" (EDF stores no time zone). */
  start: string;
  startMs: number;
  /** Seconds from the header start to the end of the last record. */
  duration: number;
  recordDuration: number;
  recordCount: number;
  signals: SignalInfo[];
  segments: Segment[];
  montages: MontageInfo[];
  annotationCount: number;
  warnings: string[];
}

export interface Settings {
  montage: MontageId;
  filters: FilterSettings;
}

/** setSettings accepts a partial filters object; untouched fields keep their values. */
export type SettingsPatch = { montage?: MontageId; filters?: Partial<FilterSettings> };

export interface WindowRequest {
  /** Seconds after the recording start. */
  start: number;
  duration: number;
  /** Pixel columns the window is drawn into. */
  width: number;
  /** Indices into the current montage's derivations; all when omitted. */
  derivations?: number[];
}

export interface ChannelWindow {
  label: string;
  unit: string;
  sampleRate: number;
  group?: string;
  /** Which filters the row gets: 'eeg' all, 'eog' with the high-pass capped at 0.3 Hz, 'other' none. */
  kind: ChannelKind;
  mode: 'minmax' | 'raw';
  /** See Decimated in dsp/decimate.ts. */
  t0: number;
  dt: number;
  columns: number;
  data: Float32Array;
  /**
   * Chosen filters this row was drawn without: a cutoff at or above its Nyquist frequency, every filter on a row
   * that is not EEG ("all filters (not an EEG channel)"), or an EOG high-pass above 0.3 Hz. Empty when the row
   * shows exactly what the filter settings say.
   */
  skippedFilters: string[];
}

export interface WindowResult {
  start: number;
  duration: number;
  channels: ChannelWindow[];
  /** Milliseconds spent reading, deriving, filtering and decimating. */
  elapsedMs: number;
}

export interface SpectrogramRequest {
  derivation: number;
  start: number;
  duration: number;
  /** Segment length in seconds (rounded to samples). Default 2 s. */
  segment?: number;
  /** Fraction of a segment shared with the next, 0 to 0.9. Default 0.5. */
  overlap?: number;
  /** Highest frequency returned, Hz. Default the Nyquist frequency. */
  fmax?: number;
  /** Average neighbouring segments down to at most this many time columns. */
  columns?: number;
  /** Apply the current display filters first. Default false (power of the derived signal). */
  filtered?: boolean;
}

export interface SpectrogramTile {
  label: string;
  sampleRate: number;
  /** Centre time of each column, seconds after the recording start. */
  times: Float64Array;
  freqs: Float64Array;
  /** Row-major [time][freq], 10*log10(PSD in unit^2/Hz). NaN where the recording has a gap. */
  db: Float32Array;
  ntime: number;
  nfreq: number;
  unit: string;
}

export interface AnnotationItem extends Annotation {
  /** 'recording' for the file's own annotations, else the added annotation file's name. */
  source: string;
}

export interface OpenOptions {
  allowTruncated?: boolean;
  onProgress?: (fraction: number) => void;
}

/** The longest settle margin read on each side of a window, seconds. Very low high-pass cutoffs are clipped. */
const MAX_MARGIN_S = 120;
/** Longest window one readWindow call draws, seconds, and the widest, in columns. */
export const MAX_WINDOW_S = 600;
export const MAX_WIDTH = 8192;

export class Engine {
  /** Seconds of signal one spectrogram chunk reads. Tests lower it to cover several chunks in a short file. */
  static CHUNK_S = 600;
  private rec: EdfRecording;
  private name: string;
  private montages: Montage[];
  private settings: Settings;
  private extra: AnnotationItem[] = [];
  private chains = new Map<string, Chain>();

  private constructor(rec: EdfRecording, name: string) {
    this.rec = rec;
    this.name = name;
    this.montages = buildMontages(rec.header.signals);
    this.settings = { montage: 'referential', filters: { ...DEFAULT_FILTERS } };
  }

  static async open(file: Blob | ByteSource, name = file instanceof Blob && 'name' in file ? String((file as File).name) : 'recording', options: OpenOptions = {}): Promise<Engine> {
    const raw = file instanceof Blob ? blobSource(file) : file;
    const rec = await EdfRecording.open(cachedSource(raw), { allowTruncated: options.allowTruncated, onProgress: options.onProgress });
    if (rec.signals.length === 0 && rec.annotations.length === 0) {
      throw new EdfError('NO_SIGNALS', 'The file holds neither signals nor annotations.');
    }
    return new Engine(rec, name);
  }

  info(): RecordingInfo {
    const h = this.rec.header;
    const s = h.start;
    const p2 = (n: number) => String(n).padStart(2, '0');
    return {
      apiVersion: API_VERSION,
      fileName: this.name,
      fileBytes: this.rec.source.size,
      variant: h.variant,
      start: `${s.year}-${p2(s.month)}-${p2(s.day)}T${p2(s.hour)}:${p2(s.minute)}:${p2(s.second)}`,
      startMs: h.startMs,
      duration: this.rec.duration,
      recordDuration: h.recordDuration,
      recordCount: h.recordCount,
      signals: this.rec.signals.map(signalInfo),
      segments: this.rec.segments,
      montages: this.montages.map((m) => ({ id: m.id, name: m.name, count: m.derivations.length, note: m.note })),
      annotationCount: this.rec.annotations.length + this.extra.length,
      warnings: this.rec.warnings,
    };
  }

  getSettings(): Settings {
    return structuredClone(this.settings);
  }

  setSettings(next: SettingsPatch): Settings {
    if (next.montage) {
      const m = this.montages.find((x) => x.id === next.montage);
      if (!m) throw new RangeError(`Unknown montage "${next.montage}".`);
      if (m.derivations.length === 0) throw new RangeError(`${m.name} is not available for this recording. ${m.note ?? ''}`.trim());
      this.settings.montage = next.montage;
    }
    if (next.filters) {
      const f = { ...this.settings.filters, ...next.filters };
      for (const [k, v] of Object.entries(f)) {
        if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0)) throw new RangeError(`Filter setting ${k} must be a number of at least 0.`);
      }
      if (f.highpass > 0 && f.lowpass > 0 && f.highpass >= f.lowpass) throw new RangeError('The high-pass cutoff must be below the low-pass cutoff.');
      if (!Number.isInteger(f.order) || f.order < 1) throw new RangeError('The filter order must be a whole number above 0.');
      this.settings.filters = f;
      this.chains.clear();
    }
    return this.getSettings();
  }

  /** Derivations of the current montage. */
  channels(): Derivation[] {
    return this.montage().derivations.map((d) => ({ ...d }));
  }

  annotations(range?: { start: number; end: number }): AnnotationItem[] {
    const all: AnnotationItem[] = [...this.rec.annotations.map((a) => ({ ...a, source: 'recording' })), ...this.extra].sort((a, b) => a.onset - b.onset);
    if (!range) return all;
    return all.filter((a) => a.onset < range.end && a.onset + (a.duration ?? 0) >= range.start);
  }

  /**
   * Adds the annotations of a separate EDF+ file (for example a hypnogram scored apart from the recording),
   * shifted by the difference between the two files' header start times.
   */
  async addAnnotationFile(file: Blob | ByteSource, name = 'annotations'): Promise<{ added: number; offset: number }> {
    const raw = file instanceof Blob ? blobSource(file) : file;
    const other = await EdfRecording.open(raw);
    if (other.annotations.length === 0) throw new EdfError('BAD_TAL', `${name} contains no annotations.`);
    const offset = (other.header.startMs - this.rec.header.startMs) / 1000;
    this.extra = this.extra.filter((a) => a.source !== name);
    for (const a of other.annotations) this.extra.push({ ...a, onset: a.onset + offset, source: name });
    return { added: other.annotations.length, offset };
  }

  hypnogram(): Hypnogram {
    return buildHypnogram(this.annotations());
  }

  async readWindow(req: WindowRequest): Promise<WindowResult> {
    const t = now();
    const width = Math.max(1, Math.floor(req.width));
    if (!Number.isFinite(width)) throw new RangeError('The window width must be a finite number of columns.');
    if (!Number.isFinite(req.start)) throw new RangeError('The window start must be a finite number of seconds.');
    if (!(req.duration > 0 && req.duration <= MAX_WINDOW_S)) throw new RangeError(`The window duration must be above 0 and at most ${MAX_WINDOW_S} s.`);
    if (req.width > MAX_WIDTH) throw new RangeError(`The window width must be at most ${MAX_WIDTH} columns.`);
    const all = this.montage().derivations;
    const chosen = (req.derivations ?? all.map((_, i) => i)).map((i) => {
      if (!all[i]) throw new RangeError(`There is no derivation ${i} in this montage.`);
      return all[i];
    });
    const derived = await this.derive(this.montage(), chosen, req.start, req.start + req.duration, true);
    const channels: ChannelWindow[] = derived.map(({ d, x, t0, skipped }) => {
      const dec = decimateMinMax(x, t0, d.sampleRate, req.start, req.duration, width);
      return { label: d.label, unit: d.unit, sampleRate: d.sampleRate, group: d.group, kind: d.kind, ...dec, skippedFilters: skipped };
    });
    return { start: req.start, duration: req.duration, channels, elapsedMs: now() - t };
  }

  async spectrogram(req: SpectrogramRequest): Promise<SpectrogramTile> {
    // The montage and filters are read once, so a settings change while the night is being read cannot mix two.
    const m = this.montage();
    const d = m.derivations[req.derivation];
    if (!d) throw new RangeError(`There is no derivation ${req.derivation} in this montage.`);
    const filtered = req.filtered ?? false;
    const chain = filtered ? this.chain(d) : undefined;
    const fs = d.sampleRate;
    const nperseg = Math.max(8, Math.round((req.segment ?? 2) * fs));
    const noverlap = Math.min(nperseg - 1, Math.max(0, Math.round(nperseg * Math.min(0.9, req.overlap ?? 0.5))));
    const step = nperseg - noverlap;
    const fmax = Math.min(req.fmax ?? fs / 2, fs / 2);
    if (!(fmax > 0)) throw new RangeError('The spectrogram fmax must be above 0 Hz.');
    const start = Math.max(0, req.start);
    const end = Math.min(this.rec.duration, req.start + req.duration);
    // Read in chunks so a whole night never needs to be in memory at once, and keep only the bins up to fmax.
    const framesPerChunk = Math.max(1, Math.floor((fs * Engine.CHUNK_S) / step));
    const times: number[] = [];
    let psd: Float64Array[] = [];
    let freqs: Float64Array = new Float64Array(0);
    let nfreq = 0;
    for (let c0 = start; c0 + nperseg / fs <= end + 1e-9; c0 += (framesPerChunk * step) / fs) {
      const c1 = Math.min(end, c0 + ((framesPerChunk - 1) * step + nperseg) / fs);
      const [{ x, t0 }] = await this.derive(m, [d], c0, c1, filtered, chain && [chain]);
      // A filtered read carries settle margins on both sides; the frames come from [c0, c1] only.
      const i0 = Math.min(x.length, Math.max(0, Math.round((c0 - t0) * fs)));
      const i1 = Math.min(x.length, Math.max(i0, Math.round((c1 - t0) * fs)));
      const res = stft(i0 === 0 && i1 === x.length ? x : x.subarray(i0, i1), { fs, nperseg, noverlap });
      if (nfreq === 0) {
        nfreq = res.freqs.findLastIndex((f) => f <= fmax + 1e-9) + 1;
        freqs = res.freqs.slice(0, nfreq);
      }
      for (let k = 0; k < res.times.length; k++) {
        times.push(t0 + i0 / fs + res.times[k]);
        psd.push(res.psd.slice(k * res.nfreq, k * res.nfreq + nfreq));
      }
      if (res.times.length === 0) break;
    }
    // Optional averaging of neighbouring columns (in linear power).
    let outTimes = times;
    if (req.columns && times.length > req.columns) {
      const groups = req.columns;
      const merged: Float64Array[] = [];
      const mt: number[] = [];
      for (let g = 0; g < groups; g++) {
        const a = Math.floor((g * times.length) / groups);
        const b = Math.floor(((g + 1) * times.length) / groups);
        const acc = new Float64Array(nfreq);
        let n = 0;
        for (let k = a; k < b; k++) {
          if (Number.isNaN(psd[k][0])) continue;
          for (let f = 0; f < nfreq; f++) acc[f] += psd[k][f];
          n++;
        }
        if (n === 0) acc.fill(Number.NaN);
        else for (let f = 0; f < nfreq; f++) acc[f] /= n;
        merged.push(acc);
        mt.push((times[a] + times[b - 1]) / 2);
      }
      psd = merged;
      outTimes = mt;
    }
    const db = new Float32Array(outTimes.length * nfreq);
    psd.forEach((row, k) => {
      for (let f = 0; f < nfreq; f++) db[k * nfreq + f] = 10 * Math.log10(Math.max(row[f], 1e-30));
      if (Number.isNaN(row[0])) db.fill(Number.NaN, k * nfreq, (k + 1) * nfreq);
    });
    return { label: d.label, sampleRate: fs, times: Float64Array.from(outTimes), freqs, db, ntime: outTimes.length, nfreq, unit: d.unit };
  }

  /** Physical values of the given derivations over [t0, t1), montage applied and optionally filtered. */
  private async derive(m: Montage, list: Derivation[], t0: number, t1: number, filtered: boolean, given?: Chain[]) {
    // Chains are taken before the first await: setSettings may run while the samples are being read.
    const chains = filtered ? (given ?? list.map((d) => this.chain(d))) : [];
    const margin = Math.max(0, ...chains.map((c) => c.margin));
    const a = Math.max(0, t0 - margin);
    const b = Math.min(this.rec.duration, t1 + margin);
    const need = new Set<number>();
    for (const d of list) {
      need.add(d.plus);
      if (typeof d.minus === 'number') need.add(d.minus);
      if (d.minus === 'average') m.averageOf.forEach((i) => need.add(i));
    }
    const ids = [...need];
    const reads = b > a ? await this.rec.readTime(ids, a, b) : ids.map(() => ({ t0: a, sampleRate: 1, data: new Float32Array(0) }));
    const byId = new Map(ids.map((id, k) => [id, reads[k]]));
    let avg: Float64Array | null = null;
    const average = () => {
      if (avg) return avg;
      const parts = m.averageOf.map((i) => byId.get(i)!.data);
      const n = Math.min(...parts.map((p) => p.length));
      avg = new Float64Array(n);
      for (const p of parts) for (let k = 0; k < n; k++) avg[k] += p[k];
      for (let k = 0; k < n; k++) avg[k] /= parts.length;
      return avg;
    };
    return list.map((d, i) => {
      const plus = byId.get(d.plus)!;
      const x = new Float64Array(plus.data.length);
      const ref = typeof d.minus === 'number' ? byId.get(d.minus)!.data : d.minus === 'average' ? average() : null;
      for (let k = 0; k < x.length; k++) x[k] = ref ? plus.data[k] - (k < ref.length ? ref[k] : Number.NaN) : plus.data[k];
      const c = chains[i];
      const y = c && c.stages.length ? filterRuns(c.stages, x) : x;
      return { d, x: y, t0: plus.t0, skipped: c ? c.skipped : [] };
    });
  }

  /** The filter chain one derivation gets, by its rate and kind (see ChannelKind). */
  private chain(d: Derivation): Chain {
    const key = `${d.sampleRate}|${d.kind}`;
    let c = this.chains.get(key);
    if (!c) {
      const f = this.settings.filters;
      const fs = d.sampleRate;
      if (d.kind === 'other') {
        const any = f.highpass > 0 || f.lowpass > 0 || f.notch > 0;
        c = { stages: [], skipped: any ? ['all filters (not an EEG channel)'] : [], margin: 0 };
      } else {
        const capped = d.kind === 'eog' && f.highpass > EOG_MAX_HIGHPASS;
        const { stages, skipped } = designChain(capped ? { ...f, highpass: EOG_MAX_HIGHPASS } : f, fs);
        if (capped) skipped.unshift(`high-pass ${f.highpass} Hz (EOG keeps ${EOG_MAX_HIGHPASS} Hz)`);
        const samples = Math.max(0, ...stages.map((s) => settleSamples(s, 1e-6)));
        c = { stages, skipped, margin: Math.min(MAX_MARGIN_S, samples / fs) };
      }
      this.chains.set(key, c);
    }
    return c;
  }

  private montage(): Montage {
    return this.montages.find((m) => m.id === this.settings.montage)!;
  }
}

interface Chain {
  stages: Sos[];
  skipped: string[];
  margin: number;
}

/** Filters each NaN-free run separately, so no filter ever runs across a recording gap. */
function filterRuns(stages: Sos[], x: Float64Array): Float64Array {
  const y = new Float64Array(x.length).fill(Number.NaN);
  let i = 0;
  while (i < x.length) {
    while (i < x.length && Number.isNaN(x[i])) i++;
    let j = i;
    while (j < x.length && !Number.isNaN(x[j])) j++;
    if (j > i) y.set(applyChain(stages, x.subarray(i, j)), i);
    i = j;
  }
  return y;
}

function signalInfo(s: SignalHeader): SignalInfo {
  return {
    index: s.index,
    label: s.label,
    unit: s.unit,
    sampleRate: s.sampleRate,
    transducer: s.transducer,
    prefiltering: s.prefiltering,
    physicalMin: s.physicalMin,
    physicalMax: s.physicalMax,
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
