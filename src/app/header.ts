/**
 * EDF, EDF+, BDF and BDF+ header parsing.
 *
 * Written from the primary specs (see SPEC.md): edfplus.info/specs/edf.html, /edfplus.html, the BioSemi
 * file_format page and the teuniz.net BDF+ description. No code was copied from any other reader.
 */
import { EdfError } from './errors';
import type { ByteSource } from './source';

export type Variant = 'EDF' | 'EDF+C' | 'EDF+D' | 'BDF' | 'BDF+C' | 'BDF+D';

export interface SignalHeader {
  /** Position in the file's signal list (annotation signals included). */
  index: number;
  label: string;
  transducer: string;
  unit: string;
  physicalMin: number;
  physicalMax: number;
  digitalMin: number;
  digitalMax: number;
  prefiltering: string;
  samplesPerRecord: number;
  reserved: string;
  isAnnotation: boolean;
  /** samplesPerRecord / recordDuration (0 when the record duration is 0). */
  sampleRate: number;
  /** Physical units per digital step, (pmax - pmin) / (dmax - dmin). */
  bitValue: number;
  /** EDFlib's offset, pmax / bitValue - dmax, so physical = bitValue * (offset + digital). */
  offset: number;
  /** Byte offset of this signal inside one data record. */
  byteOffset: number;
}

export interface StartDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface EdfPlusPatient {
  code: string;
  sex: string;
  birthdate: string;
  name: string;
  additional: string;
}

export interface EdfPlusRecording {
  startdate: string;
  adminCode: string;
  technician: string;
  equipment: string;
  additional: string;
}

export interface EdfHeader {
  variant: Variant;
  /** 2 for EDF, 3 for BDF. */
  bytesPerSample: 2 | 3;
  isPlus: boolean;
  discontinuous: boolean;
  patientRaw: string;
  recordingRaw: string;
  patient?: EdfPlusPatient;
  recording?: EdfPlusRecording;
  start: StartDateTime;
  /** Wall-clock start as milliseconds since 1970 in a zone-less (UTC) frame. Local time of the recording site. */
  startMs: number;
  headerBytes: number;
  reservedField: string;
  /** Number of complete data records that are actually readable. */
  recordCount: number;
  /** Value written in the header (-1 means unknown). */
  recordCountInHeader: number;
  recordDuration: number;
  recordBytes: number;
  signals: SignalHeader[];
  warnings: string[];
}

export interface ParseOptions {
  /** Read only the complete records of a file that is shorter than its header claims, instead of failing. */
  allowTruncated?: boolean;
}

const latin1 = new TextDecoder('latin1');

function text(bytes: Uint8Array, start: number, length: number): string {
  // Header fields are US-ASCII padded with spaces; NUL padding occurs in the wild and is treated the same.
  return latin1.decode(bytes.subarray(start, start + length)).replace(/\0/g, ' ').trim();
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function num(value: string, field: string): number {
  if (!NUMBER.test(value)) {
    throw new EdfError('BAD_FIELD', `The header field "${field}" is not a number: "${value}"`);
  }
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) {
    throw new EdfError('BAD_FIELD', `The header field "${field}" is not finite: "${value}"`);
  }
  return n;
}

function int(value: string, field: string): number {
  const n = num(value, field);
  if (!Number.isInteger(n)) throw new EdfError('BAD_FIELD', `The header field "${field}" is not a whole number: "${value}"`);
  return n;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function parseStart(dateField: string, timeField: string, recording?: EdfPlusRecording): StartDateTime {
  const t = /^(\d{1,2})\D(\d{1,2})\D(\d{1,2})$/.exec(timeField);
  if (!t) throw new EdfError('BAD_FIELD', `The start time is not hh.mm.ss: "${timeField}"`);
  const [hour, minute, second] = [Number(t[1]), Number(t[2]), Number(t[3])];
  if (hour > 23 || minute > 59 || second > 59) throw new EdfError('BAD_FIELD', `The start time is out of range: "${timeField}"`);

  // Years below 100 sit in Date.UTC's 1900 offset window, so shift them one
  // 400-year Gregorian cycle to keep leap-year day counts right.
  const daysIn = (year: number, month: number) => new Date(Date.UTC(year < 100 ? year + 400 : year, month, 0)).getUTCDate();

  // EDF+ item 4: "Startdate dd-MMM-yyyy" in the recording field carries the four-digit year.
  const plus = recording ? /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(recording.startdate) : null;
  if (plus) {
    if (!MONTHS.includes(plus[2])) throw new EdfError('BAD_FIELD', `The EDF+ Startdate month is not a month name: "${plus[2]}"`);
    const year = Number(plus[3]);
    const month = MONTHS.indexOf(plus[2]) + 1;
    const day = Number(plus[1]);
    if (day < 1 || day > daysIn(year, month)) throw new EdfError('BAD_FIELD', `The EDF+ Startdate day is out of range: "${plus[0]}"`);
    return { year, month, day, hour, minute, second };
  }
  const d = /^(\d{1,2})\D(\d{1,2})\D(\d{2})$/.exec(dateField);
  if (!d) throw new EdfError('BAD_FIELD', `The start date is not dd.mm.yy: "${dateField}"`);
  const yy = Number(d[3]);
  // EDF+ item 2: 1985 is the clipping year (85..99 -> 1985..1999, 00..84 -> 2000..2084).
  const year = yy >= 85 ? 1900 + yy : 2000 + yy;
  const month = Number(d[2]);
  const day = Number(d[1]);
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) throw new EdfError('BAD_FIELD', `The start date is out of range: "${dateField}"`);
  return { year, month, day, hour, minute, second };
}

function subfields(raw: string, count: number): string[] {
  const parts = raw.split(' ').filter((p) => p.length > 0);
  const head = parts.slice(0, count - 1);
  while (head.length < count - 1) head.push('');
  return [...head, parts.slice(count - 1).join(' ')];
}

/** Reads and validates the header. Throws EdfError on anything that would make the data unreadable. */
export async function parseHeader(source: ByteSource, options: ParseOptions = {}): Promise<EdfHeader> {
  const warnings: string[] = [];
  if (source.size < 256) throw new EdfError('TOO_SHORT', `The file is ${source.size} bytes, shorter than the 256-byte EDF header.`);
  const fixed = await source.read(0, 256);

  let bytesPerSample: 2 | 3;
  if (fixed[0] === 0xff && latin1.decode(fixed.subarray(1, 8)) === 'BIOSEMI') {
    bytesPerSample = 3;
  } else if (text(fixed, 0, 8) === '0') {
    bytesPerSample = 2;
  } else {
    throw new EdfError('BAD_VERSION', 'This is not an EDF or BDF file: the version field is neither "0" nor 0xFF "BIOSEMI".');
  }

  const patientRaw = text(fixed, 8, 80);
  const recordingRaw = text(fixed, 88, 80);
  const dateField = text(fixed, 168, 8);
  const timeField = text(fixed, 176, 8);
  const headerBytes = int(text(fixed, 184, 8), 'number of bytes in header');
  const reservedField = text(fixed, 192, 44);
  const recordCountInHeader = int(text(fixed, 236, 8), 'number of data records');
  const recordDuration = num(text(fixed, 244, 8), 'duration of a data record');
  const ns = int(text(fixed, 252, 4), 'number of signals');

  if (ns < 1) throw new EdfError('NO_SIGNALS', 'The header says the file has no signals.');
  if (headerBytes !== 256 * (ns + 1)) {
    throw new EdfError(
      'HEADER_SIZE_MISMATCH',
      `The header length field says ${headerBytes} bytes, but ${ns} signals need ${256 * (ns + 1)}.`,
    );
  }
  if (source.size < headerBytes) {
    throw new EdfError('TOO_SHORT', `The file ends inside its header (${source.size} of ${headerBytes} bytes).`);
  }

  const plusTag = reservedField.slice(0, 5);
  const plusPrefix = bytesPerSample === 2 ? 'EDF+' : 'BDF+';
  const isPlus = plusTag === `${plusPrefix}C` || plusTag === `${plusPrefix}D`;
  const discontinuous = isPlus && plusTag.endsWith('D');
  const variant = (isPlus ? plusTag : bytesPerSample === 2 ? 'EDF' : 'BDF') as Variant;

  let patient: EdfPlusPatient | undefined;
  let recording: EdfPlusRecording | undefined;
  if (isPlus) {
    const [code, sex, birthdate, name, additional] = subfields(patientRaw, 5);
    patient = { code, sex, birthdate, name, additional };
    const r = subfields(recordingRaw, 6);
    if (r[0] === 'Startdate') {
      recording = { startdate: r[1], adminCode: r[2], technician: r[3], equipment: r[4], additional: r[5] };
    } else {
      warnings.push('The EDF+ recording field does not start with "Startdate".');
    }
  }

  const start = parseStart(dateField, timeField, recording);
  const startMs = Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute, start.second);

  const sh = await source.read(256, 256 * ns);
  const field = (offset: number, width: number, i: number) => text(sh, offset * ns + width * i, width);
  // Field widths in the order they appear: label 16, transducer 80, unit 8, pmin 8, pmax 8, dmin 8, dmax 8,
  // prefiltering 80, samples per record 8, reserved 32.
  const base = { label: 0, transducer: 16, unit: 96, pmin: 104, pmax: 112, dmin: 120, dmax: 128, prefilter: 136, spr: 216, reserved: 224 };

  const annotationLabel = bytesPerSample === 2 ? 'EDF Annotations' : 'BDF Annotations';
  const signals: SignalHeader[] = [];
  let byteOffset = 0;
  for (let i = 0; i < ns; i++) {
    const label = field(base.label, 16, i);
    const isAnnotation = isPlus && label === annotationLabel;
    const at = `signal ${i + 1} (${label || 'no label'})`;
    const samplesPerRecord = int(field(base.spr, 8, i), `samples per record of ${at}`);
    let physicalMin = 0;
    let physicalMax = 1;
    let digitalMin = 0;
    let digitalMax = 1;
    if (isAnnotation) {
      // Only label and samples per record are meaningful for an annotation signal.
    } else {
      physicalMin = num(field(base.pmin, 8, i), `physical minimum of ${at}`);
      physicalMax = num(field(base.pmax, 8, i), `physical maximum of ${at}`);
      digitalMin = int(field(base.dmin, 8, i), `digital minimum of ${at}`);
      digitalMax = int(field(base.dmax, 8, i), `digital maximum of ${at}`);
      if (digitalMax <= digitalMin) throw new EdfError('BAD_SIGNAL', `The digital maximum of ${at} is not larger than its minimum.`);
      if (physicalMax === physicalMin) throw new EdfError('BAD_SIGNAL', `The physical minimum and maximum of ${at} are equal.`);
      if (samplesPerRecord < 1) throw new EdfError('BAD_SIGNAL', `${at} has no samples in a data record.`);
      const limit = bytesPerSample === 2 ? 32768 : 8388608;
      if (digitalMin < -limit || digitalMax > limit - 1) warnings.push(`The digital range of ${at} is wider than ${bytesPerSample * 8}-bit samples allow.`);
    }
    if (samplesPerRecord < 0) throw new EdfError('BAD_SIGNAL', `${at} has a negative number of samples per record.`);
    const bitValue = isAnnotation ? 1 : (physicalMax - physicalMin) / (digitalMax - digitalMin);
    if (!isAnnotation && !Number.isFinite(bitValue)) throw new EdfError('BAD_FIELD', `The physical range of ${at} is too wide to convert.`);
    signals.push({
      index: i,
      label,
      transducer: field(base.transducer, 80, i),
      unit: field(base.unit, 8, i),
      physicalMin,
      physicalMax,
      digitalMin,
      digitalMax,
      prefiltering: field(base.prefilter, 80, i),
      samplesPerRecord,
      reserved: field(base.reserved, 32, i),
      isAnnotation,
      sampleRate: recordDuration > 0 ? samplesPerRecord / recordDuration : 0,
      bitValue,
      offset: isAnnotation ? 0 : physicalMax / bitValue - digitalMax,
      byteOffset,
    });
    byteOffset += samplesPerRecord * bytesPerSample;
  }
  const recordBytes = byteOffset;
  if (recordBytes === 0) throw new EdfError('NO_SIGNALS', 'A data record holds no samples.');

  const hasOrdinary = signals.some((s) => !s.isAnnotation);
  if (hasOrdinary && !(recordDuration > 0)) {
    throw new EdfError('BAD_RECORD_DURATION', `The data record duration is ${recordDuration} s; it must be above 0 when the file has signals.`);
  }
  if (recordDuration < 0) throw new EdfError('BAD_RECORD_DURATION', 'The data record duration is negative.');
  if (isPlus && !signals.some((s) => s.isAnnotation)) {
    throw new EdfError('NO_TIMEKEEPING', `An ${variant} file must contain an "${annotationLabel}" signal.`);
  }

  const available = Math.floor((source.size - headerBytes) / recordBytes);
  let recordCount = recordCountInHeader;
  if (recordCountInHeader === -1) {
    recordCount = available;
    warnings.push(`The header gives the record count as -1 (still recording); ${available} complete records were found.`);
  } else if (recordCountInHeader < 0) {
    throw new EdfError('BAD_FIELD', `The number of data records is ${recordCountInHeader}.`);
  } else if (available < recordCountInHeader) {
    if (!options.allowTruncated) {
      throw new EdfError(
        'TRUNCATED',
        `The file is truncated: the header promises ${recordCountInHeader} data records but only ${available} complete ones are present.`,
      );
    }
    recordCount = available;
    warnings.push(`The file is truncated; only ${available} of ${recordCountInHeader} data records are read.`);
  } else {
    const extra = source.size - headerBytes - recordCountInHeader * recordBytes;
    if (extra > 0) warnings.push(`The file has ${extra} bytes after its last data record; they are ignored.`);
  }

  return {
    variant,
    bytesPerSample,
    isPlus,
    discontinuous,
    patientRaw,
    recordingRaw,
    patient,
    recording,
    start,
    startMs,
    headerBytes,
    reservedField,
    recordCount,
    recordCountInHeader,
    recordDuration,
    recordBytes,
    signals,
    warnings,
  };
}
