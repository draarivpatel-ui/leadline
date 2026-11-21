// Sleep-stage recognition and hypnogram assembly: R&K and AASM texts, epoch durations, totals, scheme.
import { describe, expect, it } from 'vitest';
import { buildHypnogram, stageOf } from '../src/core/hypnogram';

const ann = (onset: number, text: string, duration: number | null = 30) => ({ onset, duration, text });

describe('stageOf', () => {
  it('maps the R&K and AASM standard texts', () => {
    const cases: [string, string][] = [
      ['Sleep stage W', 'W'], ['Sleep stage 1', 'N1'], ['Sleep stage 2', 'N2'], ['Sleep stage 3', 'N3'],
      ['Sleep stage 4', 'N4'], ['Sleep stage R', 'R'], ['Sleep stage ?', '?'], ['Sleep stage M', 'MT'],
      ['Sleep stage N', 'N'], ['Sleep stage N1', 'N1'], ['Sleep stage N2', 'N2'], ['Sleep stage N3', 'N3'],
      ['Movement time', 'MT'], ['  sleep stage n3 ', 'N3'], ['SLEEP STAGE W', 'W'],
    ];
    for (const [text, want] of cases) expect(stageOf(text), text).toBe(want);
  });

  it('returns null for other annotations and near-misses', () => {
    for (const text of ['Lights off', 'Sleep stage 5', 'Sleep stage N4', 'Sleep stage', 'stage 2', 'Sleep stage R5', '']) {
      expect(stageOf(text), text).toBeNull();
    }
  });
});

describe('buildHypnogram', () => {
  it('orders epochs by onset and keeps the stage text', () => {
    const h = buildHypnogram([ann(60, 'Sleep stage 2'), ann(0, 'Sleep stage W'), ann(30, 'Sleep stage 1')]);
    expect(h.epochs.map((e) => e.stage)).toEqual(['W', 'N1', 'N2']);
    expect(h.epochs[1].text).toBe('Sleep stage 1');
  });

  it('a stage without a duration lasts until the next stage; the last defaults to 30 s', () => {
    const h = buildHypnogram([ann(0, 'Sleep stage W', null), ann(40, 'Sleep stage 1', null), ann(90, 'Sleep stage 2', null)]);
    expect(h.epochs.map((e) => e.duration)).toEqual([40, 50, 30]);
  });

  it('a zero duration is treated as missing', () => {
    const h = buildHypnogram([ann(0, 'Sleep stage W', 0), ann(30, 'Sleep stage 1', 0)]);
    expect(h.epochs[0].duration).toBe(30);
  });

  it('sums the time in each stage', () => {
    const h = buildHypnogram([ann(0, 'Sleep stage W', 10), ann(10, 'Sleep stage 2', 60), ann(70, 'Sleep stage W', 5), ann(75, 'Sleep stage 2', 30)]);
    expect(h.totals.W).toBe(15);
    expect(h.totals.N2).toBe(90);
    expect(h.totals.N1).toBeUndefined();
  });

  it('reports the scoring scheme', () => {
    expect(buildHypnogram([ann(0, 'Sleep stage 3')]).scheme).toBe('rk');
    expect(buildHypnogram([ann(0, 'Sleep stage N3')]).scheme).toBe('aasm');
    expect(buildHypnogram([ann(0, 'Sleep stage N'), ann(1, 'Sleep stage 1')]).scheme).toBe('mixed');
    expect(buildHypnogram([ann(0, 'Sleep stage W')]).scheme).toBe('none');
    expect(buildHypnogram([]).scheme).toBe('none');
  });

  it('ignores annotations that are not stages', () => {
    const h = buildHypnogram([ann(0, 'Impedance check'), ann(30, 'Sleep stage 2'), ann(60, 'Note about snoring')]);
    expect(h.epochs.length).toBe(1);
    expect(h.epochs[0].onset).toBe(30);
  });
});
