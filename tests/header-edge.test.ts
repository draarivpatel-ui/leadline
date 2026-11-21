// Header validation edge cases on in-memory files: every malformed field must fail closed with
// the right EdfError code, and borderline-but-legal files must open with the right warnings.
import { describe, expect, it } from 'vitest';
import { EdfError } from '../src/core/edf/errors';
import { parseHeader } from '../src/core/edf/header';
import { bytesSource } from '../src/core/edf/source';
import { annotationSignal, eegSignal, synthBytes, synthSource, type SynthSignal } from './synth';

const open = (o: Parameters<typeof synthSource>[0], opts?: Parameters<typeof parseHeader>[1]) => parseHeader(synthSource(o), opts);
const code = (p: Promise<unknown>) => p.then(() => null).catch((e: EdfError) => e.code);

describe('fixed header fields', () => {
  it('rejects a file shorter than the fixed header', async () => {
    const p = parseHeader(bytesSource(new Uint8Array(255)));
    await expect(code(p)).resolves.toBe('TOO_SHORT');
  });

  it('rejects a version that is neither "0" nor BDF', async () => {
    const bytes = synthBytes({ signals: [eegSignal(4)], recordCount: 1, records: 1 });
    bytes.fill(0x31, 0, 8); // version "11111111"
    const p = parseHeader(bytesSource(bytes));
    await expect(code(p)).resolves.toBe('BAD_VERSION');
  });

  it('rejects a signal count of zero', async () => {
    // A 0-signal header is 256 bytes total and parses until the count check.
    const bytes = new Uint8Array(256);
    bytes.set(new TextEncoder().encode('0       '));
    bytes.fill(0x20, 8);
    bytes.set(new TextEncoder().encode('01.01.20'), 168);
    bytes.set(new TextEncoder().encode('00.00.00'), 176);
    bytes.set(new TextEncoder().encode('256     '), 184);
    bytes.set(new TextEncoder().encode('4       '), 236);
    bytes.set(new TextEncoder().encode('1       '), 244);
    bytes.set(new TextEncoder().encode('0   '), 252);
    const p = parseHeader(bytesSource(bytes));
    await expect(code(p)).resolves.toBe('NO_SIGNALS');
  });

  it('rejects a header length that does not match the signal count', async () => {
    const bytes = synthBytes({ signals: [eegSignal(4)], recordCount: 1, records: 1 });
    bytes.set(new TextEncoder().encode('768     '), 184); // 2 signals would need 768; only 1 listed
    const p = parseHeader(bytesSource(bytes));
    await expect(code(p)).resolves.toBe('HEADER_SIZE_MISMATCH');
  });

  it('rejects a file that ends inside its signal headers', async () => {
    const bytes = synthBytes({ signals: [eegSignal(4), eegSignal(4)], recordCount: 0, records: 0 });
    const p = parseHeader(bytesSource(bytes.subarray(0, 256 + 100)));
    await expect(code(p)).resolves.toBe('TOO_SHORT');
  });
});

describe('signal field validation', () => {
  const one = (sig: Partial<SynthSignal>) => synthSource({ signals: [{ label: 'EEG Cz', unit: 'uV', spr: 4, ...sig }], recordCount: 1, records: 1 });

  it('rejects a non-numeric physical minimum', async () => {
    const bytes = synthBytes({ signals: [{ label: 'EEG Cz', unit: 'uV', spr: 4 }], recordCount: 1, records: 1 });
    bytes.set(new TextEncoder().encode('abc     '), 256 + 104); // pmin of signal 0
    const p = parseHeader(bytesSource(bytes));
    await expect(code(p)).resolves.toBe('BAD_FIELD');
  });

  it('rejects a non-integer samples-per-record', async () => {
    const bytes = synthBytes({ signals: [{ label: 'EEG Cz', unit: 'uV', spr: 4 }], recordCount: 1, records: 1 });
    bytes.set(new TextEncoder().encode('2.5     '), 256 + 216);
    const p = parseHeader(bytesSource(bytes));
    await expect(code(p)).resolves.toBe('BAD_FIELD');
  });

  it('rejects zero samples per record on an ordinary signal', async () => {
    await expect(code(parseHeader(one({ spr: 0 })))).resolves.toBe('BAD_SIGNAL');
  });

  it('rejects a negative samples-per-record', async () => {
    await expect(code(parseHeader(one({ spr: -2 })))).resolves.toBe('BAD_SIGNAL');
  });

  it('rejects a digital maximum at or below the minimum', async () => {
    await expect(code(parseHeader(one({ dmin: 100, dmax: 100 })))).resolves.toBe('BAD_SIGNAL');
    await expect(code(parseHeader(one({ dmin: 100, dmax: 50 })))).resolves.toBe('BAD_SIGNAL');
  });

  it('rejects equal physical limits', async () => {
    await expect(code(parseHeader(one({ pmin: 5, pmax: 5 })))).resolves.toBe('BAD_SIGNAL');
  });

  it('warns about a digital range wider than the sample width', async () => {
    const h = await parseHeader(one({ dmin: -40000, dmax: 40000 }));
    expect(h.warnings.some((w) => /wider than 16-bit/.test(w))).toBe(true);
  });

  it('computes EDFlib bit value and offset for physical conversion', async () => {
    const h = await parseHeader(one({ pmin: -100, pmax: 300, dmin: -2000, dmax: 2000 }));
    const s = h.signals[0];
    expect(s.bitValue).toBeCloseTo(0.1, 12);
    // physical = bitValue * (offset + digital): digital min maps to physical min.
    expect(s.bitValue * (s.offset + s.digitalMin)).toBeCloseTo(-100, 9);
    expect(s.bitValue * (s.offset + s.digitalMax)).toBeCloseTo(300, 9);
  });
});

describe('record bookkeeping', () => {
  it('reads -1 (still recording) as the complete records on disk, with a warning', async () => {
    const h = await open({ signals: [eegSignal(4, [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]])], recordCount: -1, records: 3 });
    expect(h.recordCount).toBe(3);
    expect(h.recordCountInHeader).toBe(-1);
    expect(h.warnings.some((w) => /still recording/.test(w))).toBe(true);
  });

  it('rejects a record count below -1', async () => {
    await expect(code(open({ signals: [eegSignal(4)], recordCount: -5, records: 0 }))).resolves.toBe('BAD_FIELD');
  });

  it('rejects a truncated file unless asked to accept it', async () => {
    const opts = { signals: [eegSignal(4, [[1, 2, 3, 4]])], recordCount: 3, records: 1 };
    await expect(code(open(opts))).resolves.toBe('TRUNCATED');
    const h = await open(opts, { allowTruncated: true });
    expect(h.recordCount).toBe(1);
    expect(h.warnings.some((w) => /truncated/.test(w))).toBe(true);
  });

  it('warns about bytes after the last record and ignores them', async () => {
    const h = await open({ signals: [eegSignal(4, [[1, 2, 3, 4]])], recordCount: 1, records: 1, tail: 7 });
    expect(h.warnings.some((w) => /7 bytes after its last data record/.test(w))).toBe(true);
    expect(h.recordCount).toBe(1);
  });

  it('rejects a non-positive record duration when ordinary signals exist', async () => {
    await expect(code(open({ signals: [eegSignal(4)], recordDuration: 0, recordCount: 1, records: 1 }))).resolves.toBe('BAD_RECORD_DURATION');
    await expect(code(open({ signals: [eegSignal(4)], recordDuration: -1, recordCount: 1, records: 1 }))).resolves.toBe('BAD_RECORD_DURATION');
  });

  it('accepts an annotation-only file with a zero record duration', async () => {
    const h = await open({ reserved: 'EDF+C', signals: [annotationSignal(['+0\x14\x14\x00'])], recordDuration: 0, recordCount: 1, records: 1 });
    expect(h.recordCount).toBe(1);
    expect(h.signals[0].isAnnotation).toBe(true);
  });
});

describe('start date and time', () => {
  const withTime = (date: string, time: string, recording?: string) =>
    open({ signals: [eegSignal(4)], date, time, recording: recording ?? 'X X', recordCount: 0, records: 0 });

  it('rejects malformed and out-of-range times', async () => {
    await expect(code(withTime('01.01.20', '25.00.00'))).resolves.toBe('BAD_FIELD');
    await expect(code(withTime('01.01.20', '12.60.00'))).resolves.toBe('BAD_FIELD');
    await expect(code(withTime('01.01.20', 'noon'))).resolves.toBe('BAD_FIELD');
  });

  it('rejects malformed and out-of-range dates', async () => {
    await expect(code(withTime('32.01.20', '00.00.00'))).resolves.toBe('BAD_FIELD');
    await expect(code(withTime('01.13.20', '00.00.00'))).resolves.toBe('BAD_FIELD');
    await expect(code(withTime('2020-01-01', '00.00.00'))).resolves.toBe('BAD_FIELD');
  });

  it('applies the EDF+ clipping year: 85-99 is 1985-1999, 00-84 is 2000-2084', async () => {
    expect((await withTime('01.01.84', '00.00.00')).start.year).toBe(2084);
    expect((await withTime('01.01.85', '00.00.00')).start.year).toBe(1985);
    expect((await withTime('01.01.99', '00.00.00')).start.year).toBe(1999);
    expect((await withTime('31.12.00', '23.59.58')).start.year).toBe(2000);
  });

  it('an EDF+ recording field supplies the four-digit year', async () => {
    const h = await open({
      reserved: 'EDF+C',
      recording: 'Startdate 05-MAR-1999 X X X',
      date: '05.03.70', // the 2-byte year would clip to 2070; Startdate wins
      signals: [eegSignal(4), annotationSignal(['+0\x14\x14\x00'])],
      recordCount: 1,
      records: 1,
    });
    expect(h.start.year).toBe(1999);
    expect(h.start.month).toBe(3);
    expect(h.start.day).toBe(5);
  });

  it('warns when an EDF+ recording field does not start with Startdate', async () => {
    const h = await open({
      reserved: 'EDF+C',
      recording: 'Nightly run',
      signals: [eegSignal(4), annotationSignal(['+0\x14\x14\x00'])],
      recordCount: 1,
      records: 1,
    });
    expect(h.warnings.some((w) => /does not start with "Startdate"/.test(w))).toBe(true);
  });

  it('parses EDF+ patient and recording subfields', async () => {
    const h = await open({
      reserved: 'EDF+C',
      patient: 'MCH-0234567 F 02-MAY-1951 Jane Doe notes here',
      recording: 'Startdate 01-JAN-2020 ADMIN-9 T001 SleepLab unit 7',
      signals: [eegSignal(4), annotationSignal(['+0\x14\x14\x00'])],
      recordCount: 1,
      records: 1,
    });
    expect(h.patient).toEqual({ code: 'MCH-0234567', sex: 'F', birthdate: '02-MAY-1951', name: 'Jane', additional: 'Doe notes here' });
    expect(h.recording?.startdate).toBe('01-JAN-2020');
    expect(h.recording?.equipment).toBe('SleepLab');
    expect(h.recording?.additional).toBe('unit 7');
  });
});

describe('variants', () => {
  it('EDF+ requires an annotation signal', async () => {
    await expect(code(open({ reserved: 'EDF+C', signals: [eegSignal(4)], recordCount: 1, records: 1 }))).resolves.toBe('NO_TIMEKEEPING');
    await expect(code(open({ reserved: 'EDF+D', signals: [eegSignal(4)], recordCount: 1, records: 1 }))).resolves.toBe('NO_TIMEKEEPING');
  });

  it('a plain EDF signal named "EDF Annotations" is an ordinary signal', async () => {
    const h = await open({ signals: [{ label: 'EDF Annotations', unit: 'uV', spr: 4 }], recordCount: 0, records: 0 });
    expect(h.isPlus).toBe(false);
    expect(h.signals[0].isAnnotation).toBe(false);
  });

  it('reads BDF headers: 0xFF BIOSEMI, 3-byte samples, BDF+ tags and labels', async () => {
    const h = await open({
      format: 'BDF',
      reserved: 'BDF+D',
      signals: [eegSignal(4), annotationSignal(['+0\x14\x14\x00'], true)],
      recordCount: 1,
      records: 1,
    });
    expect(h.variant).toBe('BDF+D');
    expect(h.bytesPerSample).toBe(3);
    expect(h.discontinuous).toBe(true);
    expect(h.signals[1].isAnnotation).toBe(true);
  });

  it('BDF signal labels use "BDF Annotations", not "EDF Annotations"', async () => {
    await expect(
      code(open({ format: 'BDF', reserved: 'BDF+C', signals: [eegSignal(4), annotationSignal(['+0\x14\x14\x00'])], recordCount: 1, records: 1 })),
    ).resolves.toBe('NO_TIMEKEEPING');
  });

  it('reports contiguous and discontinuous variants', async () => {
    const ann = () => annotationSignal(['+0\x14\x14\x00', '+1\x14\x14\x00']);
    expect((await open({ signals: [eegSignal(4), ann()], recordCount: 2, records: 2 })).variant).toBe('EDF');
    expect((await open({ reserved: 'EDF+C', signals: [eegSignal(4), ann()], recordCount: 2, records: 2 })).variant).toBe('EDF+C');
    expect((await open({ reserved: 'EDF+D', signals: [eegSignal(4), ann()], recordCount: 2, records: 2 })).variant).toBe('EDF+D');
  });

  it('keeps the raw reserved field and detects the +C/+D tag only at the start', async () => {
    const h = await open({ reserved: 'XX EDF+C', signals: [eegSignal(4)], recordCount: 0, records: 0 });
    expect(h.isPlus).toBe(false);
    expect(h.variant).toBe('EDF');
    expect(h.reservedField).toContain('EDF+C');
  });
});
