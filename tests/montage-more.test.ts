// Electrode parsing and montage construction edges: reference suffixes, aliases, pairing rules.
import { describe, expect, it } from 'vitest';
import { buildMontages, channelKind, DOUBLE_BANANA, electrodeOf, EOG_MAX_HIGHPASS, isEegLike, parseElectrode } from '../src/core/montage';

const sig = (index: number, label: string, extra: Partial<{ unit: string; sampleRate: number }> = {}) =>
  ({ index, label, unit: 'uV', sampleRate: 200, isAnnotation: false, ...extra }) as never;

describe('parseElectrode', () => {
  it('finds the electrode through prefixes, suffixes and padding dots', () => {
    for (const [label, electrode, reference] of [
      ['Fp1', 'FP1', 'REF'], ['EEG Fp1-REF', 'FP1', 'REF'], ['Fp1-LE', 'FP1', 'LE'],
      ['Fc5.', 'FC5', 'REF'], ['C3-A2', 'C3', 'A2'], ['O2-M1', 'O2', 'M1'], ['T7', 'T3', 'REF'],
      ['P8-REF', 'T6', 'REF'], ['fpz', 'FPZ', 'REF'], ['A1', 'A1', 'REF'],
    ] as const) {
      const p = parseElectrode(label);
      expect(p?.electrode, label).toBe(electrode);
      expect(p?.reference, label).toBe(reference);
    }
  });

  it('returns null for bipolar labels, eye channels and non-electrodes', () => {
    for (const label of ['Fpz-Cz', 'EOG left', 'Resp belt', 'Status', 'EEG Annotations', 'SaO2', '']) {
      expect(parseElectrode(label), label).toBeNull();
    }
  });

  it('keeps the file spelling for display while matching canonically', () => {
    expect(parseElectrode('t7..')?.spelling).toBe('t7');
    expect(electrodeOf('EEG T8-REF')).toBe('T4');
  });
});

describe('DOUBLE_BANANA', () => {
  it('is the 18-pair longitudinal montage in order', () => {
    expect(DOUBLE_BANANA.length).toBe(18);
    expect(DOUBLE_BANANA[0]).toEqual(['FP1', 'F7', 'Left temporal']);
    expect(DOUBLE_BANANA[17]).toEqual(['CZ', 'PZ', 'Midline']);
    const groups = new Set(DOUBLE_BANANA.map(([, , g]) => g));
    expect(groups).toEqual(new Set(['Left temporal', 'Right temporal', 'Left parasagittal', 'Right parasagittal', 'Midline']));
  });
});

describe('buildMontages', () => {
  it('always offers three montages; referential lists every ordinary signal', () => {
    const [ref, bip, avg] = buildMontages([sig(0, 'Fp1'), sig(1, 'Cz'), sig(2, 'Resp belt', { unit: '', sampleRate: 1 }), { index: 3, label: 'EDF Annotations', unit: '', sampleRate: 0, isAnnotation: true } as never]);
    expect(ref.derivations.map((d) => d.label)).toEqual(['Fp1', 'Cz', 'Resp belt']);
    expect(ref.derivations[2].kind).toBe('other');
    expect(bip.derivations).toEqual([]);
    expect(avg.derivations).toEqual([]);
  });

  it('a pair needs both electrodes on the same rate, unit and reference', () => {
    const labels = ['FP1-REF', 'F7-REF', 'F3-A2', 'C3-REF', 'FP2-REF', 'F8-REF'];
    const [ref, bip] = buildMontages(labels.map((l, i) => sig(i, l)));
    const pairs = bip.derivations.map((d) => d.label);
    expect(pairs).toContain('FP1-F7');
    expect(pairs).toContain('FP2-F8');
    expect(pairs).not.toContain('F3-C3'); // F3 on A2, C3 on REF: the difference would carry A2 - REF
    expect(bip.note).toMatch(/Mixed references \(A2, REF\): 2 pairs are left out/); // F3-C3 and FP1-F3
    expect(bip.derivations.every((d) => d.group)).toBe(true);
    expect(ref.derivations.length).toBe(6);
  });

  it('electrodes sharing a non-REF reference do pair', () => {
    const [, bip] = buildMontages([sig(0, 'F3-A2'), sig(1, 'C3-A2'), sig(2, 'P3-A2'), sig(3, 'O1-A2')]);
    expect(bip.derivations.map((d) => d.label)).toEqual(['F3-C3', 'C3-P3', 'P3-O1']);
  });

  it('rate or unit mismatches drop the pair silently', () => {
    const [ , bip] = buildMontages([sig(0, 'FP1-REF'), sig(1, 'F7-REF', { sampleRate: 100 }), sig(2, 'FP2-REF'), sig(3, 'F8-REF', { unit: 'mV' })]);
    expect(bip.derivations).toEqual([]);
  });

  it('the first label for an electrode wins; duplicates are ignored', () => {
    const [, bip] = buildMontages([sig(0, 'EEG FP1-REF'), sig(1, 'Fp1-REF'), sig(2, 'F7-REF')]);
    const pair = bip.derivations.find((d) => d.label.includes('F7'));
    expect(pair?.plus).toBe(0); // 'EEG FP1-REF' spelling is kept
    expect(pair?.label).toBe('FP1-F7');
  });

  it('average reference needs three electrodes on one reference; ears stay out', () => {
    const two = buildMontages([sig(0, 'Fp1-REF'), sig(1, 'Cz-REF')])[2];
    expect(two.derivations).toEqual([]);
    expect(two.note).toMatch(/at least 3/);
    const withEars = buildMontages([sig(0, 'Fp1-REF'), sig(1, 'Cz-REF'), sig(2, 'Pz-REF'), sig(3, 'A1-REF'), sig(4, 'M2-REF')])[2];
    expect(withEars.averageOf).toEqual([0, 1, 2]); // A1 and M2 excluded
    expect(withEars.derivations.map((d) => d.label)).toEqual(['Fp1-Avg', 'Cz-Avg', 'Pz-Avg']);
  });

  it('ear and mastoid electrodes never form bipolar pairs', () => {
    const [, bip] = buildMontages(DOUBLE_BANANA.flatMap(([a, b]) => [a, b]).filter((v, i, x) => x.indexOf(v) === i).map((l, i) => sig(i, `${l}-REF`)).concat([sig(90, 'A1-REF'), sig(91, 'M2-REF')]));
    expect(bip.derivations.length).toBe(18);
    expect(bip.derivations.every((d) => d.kind === 'eeg')).toBe(true);
  });
});

describe('channel kind boundaries', () => {
  it('EOG_MAX_HIGHPASS is the AASM 0.3 Hz', () => {
    expect(EOG_MAX_HIGHPASS).toBe(0.3);
  });

  it('the 32 Hz floor decides EEG-like rates', () => {
    expect(isEegLike({ unit: 'uV', sampleRate: 32 })).toBe(true);
    expect(isEegLike({ unit: 'uV', sampleRate: 31.9 })).toBe(false);
    expect(channelKind('Cz', 'uV', 31)).toBe('other');
    expect(channelKind('Cz', 'uV', 32)).toBe('eeg');
  });
});
