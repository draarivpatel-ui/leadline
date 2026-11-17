/**
 * Montages: which derivations are drawn. A derivation is one signal minus a reference (another signal, the
 * average of a set of signals, or nothing). Electrode names follow the EDF+ standard texts (edftexts.html,
 * section 2): 10-20 names, with the 10-10 aliases T7/T8/P7/P8 for T3/T4/T5/T6.
 */
import type { SignalHeader } from './edf/header';

export type MontageId = 'referential' | 'bipolar' | 'average';

/**
 * What a derivation carries, which decides the display filters it gets: 'eeg' gets the chosen filters, 'eog' the
 * same with its high-pass capped at EOG_MAX_HIGHPASS, and 'other' (respiration, temperature, event markers, EMG,
 * ECG, oximetry, trigger channels) none at all.
 */
export type ChannelKind = 'eeg' | 'eog' | 'other';

/** The highest high-pass an EOG row gets: the AASM recommended EOG setting, so slow eye movements survive. */
export const EOG_MAX_HIGHPASS = 0.3;

export interface Derivation {
  label: string;
  /** Signal index (in the file's signal list) of the active electrode. */
  plus: number;
  /** Signal index of the reference electrode, or 'average', or null for none. */
  minus: number | 'average' | null;
  unit: string;
  sampleRate: number;
  /** Chain name for bipolar montages, used to space groups apart. */
  group?: string;
  kind: ChannelKind;
}

export interface Montage {
  id: MontageId;
  name: string;
  derivations: Derivation[];
  /** Signal indices averaged for the 'average' reference. */
  averageOf: number[];
  /** Why a montage is limited or unavailable. */
  note?: string;
}

export const ELECTRODES = new Set(
  (
    'FP1 FPZ FP2 AF7 AF3 AFZ AF4 AF8 F9 F7 F5 F3 F1 FZ F2 F4 F6 F8 F10 FT9 FT7 FC5 FC3 FC1 FCZ FC2 FC4 FC6 FT8 FT10 ' +
    'T9 T7 C5 C3 C1 CZ C2 C4 C6 T8 T10 TP9 TP7 CP5 CP3 CP1 CPZ CP2 CP4 CP6 TP8 TP10 P9 P7 P5 P3 P1 PZ P2 P4 P6 P8 P10 ' +
    'PO7 PO3 POZ PO4 PO8 O1 OZ O2 IZ T3 T4 T5 T6 A1 A2 M1 M2 NZ'
  ).split(' '),
);

const ALIAS: Record<string, string> = { T7: 'T3', T8: 'T4', P7: 'T5', P8: 'T6' };

/**
 * A voltage sampled fast enough to be EEG. The page uses the same rule for scaling, so scaling and filtering never
 * disagree about which rows are EEG-like.
 */
export function isEegLike(c: { unit: string; sampleRate: number }): boolean {
  return /V$/i.test(c.unit.trim()) && c.sampleRate >= 32;
}

/**
 * EDF+ standard-text signal types (edftexts.html 1.2) and common polysomnography labels that are not EEG. Matched
 * as a whole word at the start of the label, so electrode names such as "POz" or BioSemi "A1" never match.
 */
const NOT_EEG = /^(ECG|EKG|EMG|Resp|Temp|Event|SaO2|SpO2|Pleth|Light|Sound|Snore|Pos|Position|Flow|Airflow|Pres|Pressure|Thor|Thorax|Abdo|Abdomen|Chin|Leg|HR|Pulse|Status|Trigger|Marker|ERG|MEG|MCG|Body|Effort)(?![A-Za-z])/i;
/** EOG by word, or the AASM eye electrodes E1 and E2 on an ear or mastoid reference ("E1-M2"). Bare E1 is EGI EEG. */
const EOG = /^(EOG|LOC|ROC)(?![A-Za-z])|^E[12][-_ ](M1|M2|A1|A2)$/i;

/** The kind of a recorded channel, from its label, unit and rate. A plain or unknown label at an EEG rate is EEG. */
export function channelKind(label: string, unit: string, sampleRate: number): ChannelKind {
  if (!isEegLike({ unit, sampleRate })) return 'other';
  const l = label.trim().replace(/^EEG\s+/i, ''); // TUH-style "EEG EKG1-REF", "EEG LOC-REF"
  if (NOT_EEG.test(l)) return 'other';
  if (EOG.test(l)) return 'eog';
  return 'eeg';
}

/**
 * Signals only a polysomnography montage carries: chin or leg EMG, airflow, oximetry, breathing effort, snoring. A bare
 * "EMG" or "Resp" is left out because routine clinical EEG records those too (TUH "EMG-REF", "EEG RESP1-REF").
 */
const SLEEP_ONLY = /^((EMG\W*)?(Chin|Submental|Subment|Ment|Leg)|Flow|Airflow|Nasal|Thor|Thorax|Abdo|Abdomen|Effort|SaO2|SpO2|Pleth|Snore)(?![A-Za-z])/i;

/**
 * A sleep recording: scored stages, or an EOG row next to a signal only a sleep study records. An eye channel alone
 * is not enough, since routine clinical EEG often carries EOG, LOC or ROC.
 */
export function isSleepRecording(channels: readonly { label: string; kind: ChannelKind }[], hasStages: boolean): boolean {
  if (hasStages) return true;
  return channels.some((c) => c.kind === 'eog') && channels.some((c) => c.kind !== 'eeg' && SLEEP_ONLY.test(c.label.trim().replace(/^EEG\s+/i, '')));
}

/**
 * Electrode name of a referential channel label, or null if the label is not a single scalp electrode.
 * Handles "EEG Fp1-REF", "Fp1-LE", "FP1", and the trailing dots of the PhysioNet motor imagery set ("Fc5.").
 */
export function electrodeOf(label: string): string | null {
  return parseElectrode(label)?.electrode ?? null;
}

/**
 * The electrode (canonical 10-20 name, for matching), the file's own spelling of it (for display) and the reference
 * the label names ('REF' when it names none). Null when the label is not a single scalp electrode.
 */
export function parseElectrode(label: string): { electrode: string; spelling: string; reference: string } | null {
  let s = label.trim().replace(/^EEG\s+/i, '').replace(/\.+$/, '');
  let reference = 'REF';
  // A reference suffix (common reference, linked ears, ear or mastoid) is split off; "Fpz-Cz" stays bipolar.
  const ref = /^([A-Za-z0-9]+)[-_ ](REF|LE|RE|AVG|AV|LINKED|AR|A1|A2|M1|M2)$/i.exec(s);
  if (ref) {
    s = ref[1];
    reference = ref[2].toUpperCase();
  }
  const up = s.toUpperCase();
  if (!ELECTRODES.has(up)) return null;
  return { electrode: ALIAS[up] ?? up, spelling: s, reference };
}

/** Longitudinal bipolar "double banana": the four parasagittal and temporal chains and the midline. */
export const DOUBLE_BANANA: [string, string, string][] = [
  ['FP1', 'F7', 'Left temporal'], ['F7', 'T3', 'Left temporal'], ['T3', 'T5', 'Left temporal'], ['T5', 'O1', 'Left temporal'],
  ['FP2', 'F8', 'Right temporal'], ['F8', 'T4', 'Right temporal'], ['T4', 'T6', 'Right temporal'], ['T6', 'O2', 'Right temporal'],
  ['FP1', 'F3', 'Left parasagittal'], ['F3', 'C3', 'Left parasagittal'], ['C3', 'P3', 'Left parasagittal'], ['P3', 'O1', 'Left parasagittal'],
  ['FP2', 'F4', 'Right parasagittal'], ['F4', 'C4', 'Right parasagittal'], ['C4', 'P4', 'Right parasagittal'], ['P4', 'O2', 'Right parasagittal'],
  ['FZ', 'CZ', 'Midline'], ['CZ', 'PZ', 'Midline'],
];

export function buildMontages(signals: SignalHeader[]): Montage[] {
  const ordinary = signals.filter((s) => !s.isAnnotation);
  const referential: Montage = {
    id: 'referential',
    name: 'As recorded',
    averageOf: [],
    derivations: ordinary.map((s) => ({ label: s.label, plus: s.index, minus: null, unit: s.unit, sampleRate: s.sampleRate, kind: channelKind(s.label, s.unit, s.sampleRate) })),
  };

  // Scalp electrodes, each with the reference its label names. Only EEG-like signals take part.
  const byElectrode = new Map<string, { s: SignalHeader; spelling: string; reference: string }>();
  for (const s of ordinary) {
    const p = parseElectrode(s.label);
    if (p && isEegLike(s) && !byElectrode.has(p.electrode)) byElectrode.set(p.electrode, { s, spelling: p.spelling, reference: p.reference });
  }
  const references = [...new Set([...byElectrode.entries()].filter(([e]) => !EAR.test(e)).map(([, v]) => v.reference))].sort();
  const mixed = references.length > 1 ? `Mixed references (${references.join(', ')})` : '';

  // A pair is subtracted only when both electrodes share rate, unit and reference; otherwise the result would
  // carry the difference of the two references.
  const bipolar: Derivation[] = [];
  let crossed = 0;
  for (const [a, b, group] of DOUBLE_BANANA) {
    const pa = byElectrode.get(a);
    const pb = byElectrode.get(b);
    if (!pa || !pb || pa.s.sampleRate !== pb.s.sampleRate || pa.s.unit !== pb.s.unit) continue;
    if (pa.reference !== pb.reference) {
      crossed++;
      continue;
    }
    bipolar.push({ label: `${pa.spelling}-${pb.spelling}`, plus: pa.s.index, minus: pb.s.index, unit: pa.s.unit, sampleRate: pa.s.sampleRate, group, kind: 'eeg' });
  }
  const bipolarNotes: string[] = [];
  if (bipolar.length === 0 && crossed === 0) bipolarNotes.push('Needs 10-20 scalp electrodes recorded against a common reference.');
  else if (bipolar.length < DOUBLE_BANANA.length) bipolarNotes.push(`${bipolar.length} of ${DOUBLE_BANANA.length} pairs have both electrodes on one reference.`);
  if (crossed) bipolarNotes.push(`${mixed}: ${crossed} ${crossed === 1 ? 'pair is' : 'pairs are'} left out because ${crossed === 1 ? 'its electrodes use' : 'their electrodes use'} different references.`);
  const bipolarMontage: Montage = {
    id: 'bipolar',
    name: 'Bipolar (double banana)',
    averageOf: [],
    derivations: bipolar,
    note: bipolarNotes.join(' ') || undefined,
  };

  // Average reference over the largest set of scalp electrodes that share one rate, unit and reference.
  const groups = new Map<string, { s: SignalHeader; spelling: string; reference: string }[]>();
  for (const [e, v] of byElectrode) {
    if (EAR.test(e)) continue; // ear and mastoid references stay out
    const k = `${v.s.sampleRate}|${v.s.unit}|${v.reference}`;
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const ok = best.length >= 3;
  const left = [...byElectrode.entries()].filter(([e]) => !EAR.test(e)).length - best.length;
  const average: Montage = {
    id: 'average',
    name: 'Average reference',
    averageOf: ok ? best.map((v) => v.s.index).sort((a, b) => a - b) : [],
    derivations: ok
      ? [...best]
          .sort((a, b) => a.s.index - b.s.index)
          .map((v) => ({ label: `${v.spelling}-Avg`, plus: v.s.index, minus: 'average' as const, unit: v.s.unit, sampleRate: v.s.sampleRate, kind: 'eeg' as const }))
      : [],
    note: !ok
      ? `Needs at least 3 scalp electrodes recorded against a common reference.${mixed ? ` ${mixed}.` : ''}`
      : mixed && left > 0
        ? `${mixed}: the average is built from the ${best.length} electrodes on ${best[0].reference === 'REF' ? 'the common reference' : best[0].reference}; ${left} other ${left === 1 ? 'electrode is' : 'electrodes are'} left out.`
        : undefined,
  };
  return [referential, bipolarMontage, average];
}

const EAR = /^(A1|A2|M1|M2)$/;
