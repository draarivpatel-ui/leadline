/**
 * Hypnogram from EDF+ sleep-stage annotations. Texts follow the EDF+ standard texts (edftexts.html 3.2):
 * R&K "Sleep stage W/1/2/3/4/R/?" and "Movement time", and the AASM "Sleep stage N/N1/N2/N3".
 */
import type { Annotation } from './edf/tal';

export type Stage = 'W' | 'R' | 'N1' | 'N2' | 'N3' | 'N4' | 'N' | 'MT' | '?';

export interface StageEpoch {
  onset: number;
  duration: number;
  stage: Stage;
  text: string;
}

export interface Hypnogram {
  epochs: StageEpoch[];
  /** Seconds spent in each stage. */
  totals: Partial<Record<Stage, number>>;
  /** 'rk' when R&K stage 3/4 texts were used, 'aasm' for N1/N2/N3, 'mixed' or 'none'. */
  scheme: 'rk' | 'aasm' | 'mixed' | 'none';
}

const MAP: Record<string, Stage> = {
  W: 'W', M: 'MT', '1': 'N1', '2': 'N2', '3': 'N3', '4': 'N4', R: 'R', '?': '?', N: 'N', N1: 'N1', N2: 'N2', N3: 'N3',
};

export function stageOf(text: string): Stage | null {
  const t = text.trim();
  if (/^movement time$/i.test(t)) return 'MT';
  const m = /^sleep stage\s+(\S+)$/i.exec(t);
  if (!m) return null;
  return MAP[m[1].toUpperCase()] ?? null;
}

export function buildHypnogram(annotations: Annotation[]): Hypnogram {
  const staged = annotations
    .map((a) => ({ a, stage: stageOf(a.text) }))
    .filter((x): x is { a: Annotation; stage: Stage } => x.stage !== null)
    .sort((x, y) => x.a.onset - y.a.onset);
  const epochs: StageEpoch[] = [];
  let rk = false;
  let aasm = false;
  staged.forEach(({ a, stage }, i) => {
    let duration = a.duration ?? 0;
    // A stage without a duration lasts until the next stage annotation (EDF+ asks for one, not every file has it).
    if (!(duration > 0)) duration = i + 1 < staged.length ? staged[i + 1].a.onset - a.onset : 30;
    if (/\s[1-4]$/.test(a.text.trim())) rk = true;
    if (/\sN[1-3]?$/i.test(a.text.trim())) aasm = true;
    epochs.push({ onset: a.onset, duration, stage, text: a.text });
  });
  const totals: Partial<Record<Stage, number>> = {};
  for (const e of epochs) totals[e.stage] = (totals[e.stage] ?? 0) + e.duration;
  return { epochs, totals, scheme: rk && aasm ? 'mixed' : rk ? 'rk' : aasm ? 'aasm' : 'none' };
}
