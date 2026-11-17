/**
 * Time-stamped Annotations Lists (EDF+ spec section 2.2). One TAL is
 *   Onset [0x15 Duration] 0x14 annotation 0x14 [annotation 0x14 ...] 0x00
 * Onset starts with '+' or '-'. The first TAL of a record begins with an empty annotation whose onset is the
 * start time of that record (section 2.2.4). Unused bytes are 0x00.
 */

export interface Annotation {
  /** Seconds after the header start date and time. */
  onset: number;
  /** Seconds, or null when the TAL gives no duration. */
  duration: number | null;
  text: string;
}

export interface TalResult {
  /** Onset of the record's time-keeping annotation, or null if absent. */
  recordOnset: number | null;
  annotations: Annotation[];
  problems: string[];
}

const utf8 = new TextDecoder('utf-8');
const ONSET = /^[+-](\d+\.?\d*|\.\d+)$/;
const DURATION = /^(\d+\.?\d*|\.\d+)$/;

/** Parses the annotation bytes of one data record. Never throws; malformed TALs are reported in `problems`. */
export function parseTals(bytes: Uint8Array, firstSignal: boolean): TalResult {
  const annotations: Annotation[] = [];
  const problems: string[] = [];
  let recordOnset: number | null = null;
  let p = 0;
  let talIndex = 0;
  const n = bytes.length;

  while (p < n) {
    if (bytes[p] === 0) {
      p++;
      continue;
    }
    // Find the end of this TAL: the 0x00 after a 0x14.
    let end = p;
    while (end < n && bytes[end] !== 0) end++;
    if (end >= n) {
      problems.push('A TAL runs to the end of its data record without the closing 0x00 byte.');
    }
    const tal = bytes.subarray(p, end);
    p = end + 1;
    if (tal[tal.length - 1] !== 0x14) {
      problems.push('A TAL does not end with the 0x14 separator.');
      talIndex++;
      continue;
    }
    const firstSep = tal.indexOf(0x14);
    const stamp = tal.subarray(0, firstSep);
    const dSep = stamp.indexOf(0x15);
    const onsetText = utf8.decode(dSep >= 0 ? stamp.subarray(0, dSep) : stamp);
    const durationText = dSep >= 0 ? utf8.decode(stamp.subarray(dSep + 1)) : null;
    if (!ONSET.test(onsetText)) {
      problems.push(`A TAL onset is malformed: "${onsetText}".`);
      talIndex++;
      continue;
    }
    const onset = Number(onsetText);
    let duration: number | null = null;
    if (durationText !== null && durationText.length > 0) {
      if (!DURATION.test(durationText)) {
        problems.push(`A TAL duration is malformed: "${durationText}".`);
      } else {
        duration = Number(durationText);
      }
    }
    // Annotation texts between the separators.
    const texts: string[] = [];
    let s = firstSep + 1;
    while (s < tal.length) {
      const e = tal.indexOf(0x14, s);
      texts.push(utf8.decode(tal.subarray(s, e)));
      s = e + 1;
    }
    let startText = 0;
    if (firstSignal && talIndex === 0 && texts.length > 0 && texts[0] === '') {
      recordOnset = onset;
      startText = 1;
    }
    for (let i = startText; i < texts.length; i++) {
      if (texts[i] === '') continue;
      annotations.push({ onset, duration, text: texts[i] });
    }
    talIndex++;
  }
  return { recordOnset, annotations, problems };
}
