// Minimal in-memory EDF/EDF+/BDF writer for parser and engine edge-case tests.
// Fields are space-padded ASCII per the spec; samples are little-endian int16 (EDF) or int24 (BDF).
import type { ByteSource } from '../src/core/edf/source';
import { bytesSource } from '../src/core/edf/source';

export const field = (s: string, w: number) => s.padEnd(w, ' ').slice(0, w);

export interface SynthSignal {
  label: string;
  transducer?: string;
  unit?: string;
  /** Written verbatim when a string is given (for malformed-field probes). */
  pmin?: number | string;
  pmax?: number | string;
  dmin?: number | string;
  dmax?: number | string;
  prefilter?: string;
  reserved?: string;
  spr: number;
  /** One entry per data record: digital sample values, or raw bytes (annotation signals). */
  records?: (number[] | Uint8Array)[];
}

export interface SynthOpts {
  /** 'EDF' (version "0") or 'BDF' (0xFF "BIOSEMI"). */
  format?: 'EDF' | 'BDF';
  patient?: string;
  recording?: string;
  date?: string;
  time?: string;
  /** The 44-byte reserved field; 'EDF+C', 'EDF+D', 'BDF+C', 'BDF+D' or ''. */
  reserved?: string;
  recordCount?: number;
  /** Written verbatim into the 8-byte field when a string is given. */
  recordDuration?: number | string;
  signals: SynthSignal[];
  /** Records actually written; defaults to recordCount. */
  records?: number;
  /** Extra bytes appended after the last record. */
  tail?: number;
}

export function synthBytes(o: SynthOpts): Uint8Array {
  const ns = o.signals.length;
  const bdf = o.format === 'BDF';
  const bps = bdf ? 3 : 2;
  const recordCount = o.recordCount ?? o.records ?? 0;
  const duration = typeof o.recordDuration === 'string' ? o.recordDuration : String(o.recordDuration ?? 1);
  const head =
    (bdf ? field('', 8) : field('0', 8)) +
    field(o.patient ?? 'X X X X', 80) +
    field(o.recording ?? (o.reserved ? 'Startdate 01-JAN-2020 X X X' : 'X X'), 80) +
    field(o.date ?? '01.01.20', 8) +
    field(o.time ?? '00.00.00', 8) +
    field(String(256 * (ns + 1)), 8) +
    field(o.reserved ?? '', 44) +
    field(String(recordCount), 8) +
    field(duration, 8) +
    field(String(ns), 4);
  const sig = (get: (s: SynthSignal) => string, w: number) => o.signals.map((s) => field(get(s), w)).join('');
  const sigs =
    sig((s) => s.label, 16) +
    sig((s) => s.transducer ?? '', 80) +
    sig((s) => s.unit ?? '', 8) +
    sig((s) => String(s.pmin ?? -100), 8) +
    sig((s) => String(s.pmax ?? 100), 8) +
    sig((s) => String(s.dmin ?? (bdf ? -8388608 : -32768)), 8) +
    sig((s) => String(s.dmax ?? (bdf ? 8388607 : 32767)), 8) +
    sig((s) => s.prefilter ?? '', 80) +
    sig((s) => String(s.spr), 8) +
    sig((s) => s.reserved ?? '', 32);
  const headerText = head + sigs;
  const header = new Uint8Array(256 * (ns + 1));
  header.set(new TextEncoder().encode(headerText));
  if (bdf) {
    header[0] = 0xff;
    header.set(new TextEncoder().encode('BIOSEMI'), 1);
  }
  const recordBytes = o.signals.reduce((n, s) => n + s.spr * bps, 0);
  const records = o.records ?? recordCount;
  const out = new Uint8Array(Math.max(header.length, header.length + records * recordBytes + (o.tail ?? 0)));
  out.set(header);
  const view = new DataView(out.buffer);
  for (let r = 0; r < records; r++) {
    let at = header.length + r * recordBytes;
    for (const s of o.signals) {
      const rec = s.records?.[r];
      if (rec instanceof Uint8Array) {
        out.set(rec.subarray(0, s.spr * bps), at);
      } else {
        for (let k = 0; k < s.spr; k++) {
          const v = rec?.[k] ?? 0;
          if (bdf) {
            const u = v & 0xffffff;
            out[at + 3 * k] = u & 0xff;
            out[at + 3 * k + 1] = (u >> 8) & 0xff;
            out[at + 3 * k + 2] = (u >> 16) & 0xff;
          } else {
            view.setInt16(at + 2 * k, v, true);
          }
        }
      }
      at += s.spr * bps;
    }
  }
  return out;
}

export function synthSource(o: SynthOpts): ByteSource {
  return bytesSource(synthBytes(o));
}

/** One ordinary signal ('EEG Cz', uV, +/-100) at `spr` samples per record. */
export function eegSignal(spr: number, records?: (number[] | Uint8Array)[]): SynthSignal {
  return { label: 'EEG Cz', unit: 'uV', spr, records };
}

/** An EDF+ annotation signal whose records are TAL byte strings. */
export function annotationSignal(tals: string[], bdf = false): SynthSignal {
  const bytes = tals.map((t) => {
    const b = new Uint8Array(60);
    b.set(new TextEncoder().encode(t));
    return b;
  });
  return { label: bdf ? 'BDF Annotations' : 'EDF Annotations', spr: 30, records: bytes };
}
