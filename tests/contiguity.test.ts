// EDF+ record durations that the 8-character field cannot hold exactly (1/30 s), with exact TAL onsets.
import { describe, expect, it } from 'vitest';
import { EdfRecording } from '../src/core/edf/recording';
import { bytesSource } from '../src/core/edf/source';

const field = (s: string, w: number) => s.padEnd(w, ' ').slice(0, w);

/** A minimal EDF+C file: one 3-sample signal and one annotation signal per record, records 1/30 s apart. */
function edfPlus(durationField: string, records: number): Uint8Array {
  const ns = 2;
  const head =
    field('0', 8) + field('X X X X', 80) + field('Startdate 01-JAN-2020 X X X', 80) + field('01.01.20', 8) + field('00.00.00', 8) +
    field(String(256 * (ns + 1)), 8) + field('EDF+C', 44) + field(String(records), 8) + field(durationField, 8) + field(String(ns), 4);
  const sig = (vals: string[], w: number) => vals.map((v) => field(v, w)).join('');
  const sigs =
    sig(['EEG Cz', 'EDF Annotations'], 16) + sig(['', ''], 80) + sig(['uV', ''], 8) + sig(['-100', '-1'], 8) + sig(['100', '1'], 8) +
    sig(['-32768', '-32768'], 8) + sig(['32767', '32767'], 8) + sig(['', ''], 80) + sig(['3', '30'], 8) + sig(['', ''], 32);
  const header = new TextEncoder().encode(head + sigs);
  const recBytes = 3 * 2 + 30 * 2;
  const out = new Uint8Array(header.length + records * recBytes);
  out.set(header);
  for (let r = 0; r < records; r++) {
    const o = header.length + r * recBytes;
    for (let k = 0; k < 3; k++) new DataView(out.buffer).setInt16(o + 2 * k, 100 * r + k, true);
    out.set(new TextEncoder().encode(`+${(r / 30).toFixed(10)}\x14\x14\x00`), o + 6);
  }
  return out;
}

describe('record durations rounded by the 8-character field', () => {
  for (const dur of ['0.033334', '0.033333']) {
    it(`"${dur}" with exact onsets opens as one continuous segment`, async () => {
      const rec = await EdfRecording.open(bytesSource(edfPlus(dur, 90)));
      expect(rec.segments.length).toBe(1);
      expect(rec.warnings.filter((w) => /not contiguous/.test(w))).toEqual([]);
      const [r] = await rec.readTime([0], 0, 2.9);
      expect(r.data.length).toBe(Math.ceil(2.9 * rec.header.signals[0].sampleRate)); // samples in [0, 2.9)
      expect(r.data.some((v) => Number.isNaN(v))).toBe(false);
    });
  }

  it('a real gap of one record is still a gap', async () => {
    const bytes = edfPlus('0.033333', 90);
    // Move record 50 and later one record later: rewrite their onsets in place (same width).
    const recBytes = 66;
    const start = bytes.length - 90 * recBytes;
    for (let r = 50; r < 90; r++) bytes.set(new TextEncoder().encode(`+${((r + 1) / 30).toFixed(10)}\x14\x14\x00`), start + r * recBytes + 6);
    const rec = await EdfRecording.open(bytesSource(bytes));
    expect(rec.warnings.some((w) => /1 record boundaries are not contiguous/.test(w))).toBe(true);
    expect(rec.segments.length).toBe(2);
  });
});
