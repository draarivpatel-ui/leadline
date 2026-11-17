import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EdfError } from '../src/core/edf/errors';
import { EdfRecording } from '../src/core/edf/recording';
import { DATA, fileSource, golden, hasData, sha256 } from './helpers';

const G = hasData ? golden() : {};
const REAL = [
  'SC4001E0-PSG.edf',
  'SC4001EC-Hypnogram.edf',
  'S001R03.edf',
  'S001R01.edf',
  'test_generator_2.edf',
  'test_generator_2.bdf',
  'test_generator.edf',
  'Newtest17-256.bdf',
  'Newtest17-2048.bdf',
  'PositiveSpikes.edf',
  'synthetic/valid_small.edf',
];

const UNIT_TO_VOLT: Record<string, number> = { uV: 1e-6, µV: 1e-6, mV: 1e-3, V: 1, nV: 1e-9 };

describe.skipIf(!hasData)('matches pyEDFlib sample for sample', () => {
  for (const name of REAL) {
    it(name, async () => {
      const g = G[name];
      const rec = await EdfRecording.open(await fileSource(name));
      const sigs = rec.signals;
      expect(sigs.length).toBe(g.signals.length);
      expect(rec.header.recordCount).toBe(g.nrec);
      for (let i = 0; i < sigs.length; i++) {
        const s = sigs[i];
        const ref = g.signals[i];
        expect(s.label).toBe(ref.label);
        expect(s.sampleRate).toBeCloseTo(ref.fs, 9);
        const digital = await rec.readDigital(s.index, 0, rec.header.recordCount);
        expect(digital.length).toBe(ref.n);
        expect(sha256(digital)).toBe(ref.digitalSha256);
        const physical = await rec.readPhysical(s.index, 0, rec.header.recordCount);
        expect(sha256(physical)).toBe(ref.physicalSha256);
      }
      // Annotations: pyEDFlib reports a missing duration as -1.
      const ours = rec.annotations.map((a) => [a.onset, a.duration ?? -1, a.text]);
      expect(ours.length).toBe(g.annotations.length);
      ours.forEach((a, k) => {
        expect(Math.abs((a[0] as number) - g.annotations[k][0])).toBeLessThan(1e-7);
        expect(Math.abs((a[1] as number) - g.annotations[k][1])).toBeLessThan(1e-7);
        expect(a[2]).toBe(g.annotations[k][2]);
      });
    }, 60_000);
  }
});

describe.skipIf(!hasData)('agrees with MNE-Python', () => {
  for (const name of REAL) {
    const g = G[name];
    if (!g?.mne) continue;
    it(name, async () => {
      const rec = await EdfRecording.open(await fileSource(name));
      let checked = 0;
      for (const ch of g.mne.channels) {
        const s = rec.signals[ch.index];
        const scale = UNIT_TO_VOLT[s.unit];
        if (scale === undefined || /status/i.test(s.label)) continue;
        const phys = await rec.readPhysical(s.index, 0, rec.header.recordCount);
        for (let k = 0; k < ch.values.length; k++) {
          const ours = phys[k * ch.stride] * scale;
          const theirs = ch.values[k];
          expect(Math.abs(ours - theirs)).toBeLessThanOrEqual(1e-9 * Math.max(Math.abs(theirs), scale));
        }
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    }, 60_000);
  }
});

describe.skipIf(!hasData)('EDF+D and BDF+D (pyEDFlib refuses these; truth from the independent Python writer)', () => {
  for (const name of ['synthetic/synthetic_edf_D.edf', 'synthetic/synthetic_bdf_D.bdf']) {
    it(name, async () => {
      const truth = JSON.parse(readFileSync(join(DATA, name.replace(/\.(edf|bdf)$/, '.json')), 'utf8'));
      const rec = await EdfRecording.open(await fileSource(name));
      expect(rec.header.variant).toBe(truth.variant);
      expect(Array.from(rec.recordOnsets)).toEqual(truth.recordOnsets);
      expect(rec.segments.map((s) => [s.start, s.end])).toEqual(truth.segments);
      expect(rec.annotations.map((a) => [a.onset, a.duration, a.text])).toEqual(truth.annotations);
      for (let i = 0; i < truth.signals.length; i++) {
        const t = truth.signals[i];
        const s = rec.signals[i];
        expect([s.label, s.unit, s.physicalMin, s.physicalMax, s.digitalMin, s.digitalMax, s.samplesPerRecord]).toEqual([
          t.label, t.unit, t.pmin, t.pmax, t.dmin, t.dmax, t.spr,
        ]);
        expect(Array.from(await rec.readDigital(s.index, 0, rec.header.recordCount))).toEqual(t.digital);
      }
      // A time read across the first gap: data, then NaN, then data again on the same grid.
      const [fp1] = await rec.readTime([0], 1.0, 8.0);
      expect(fp1.sampleRate).toBe(256);
      expect(fp1.t0).toBe(1.0);
      expect(fp1.data.length).toBe(7 * 256);
      const s0 = rec.signals[0];
      const phys = (d: number) => Math.fround(s0.bitValue * (s0.offset + d));
      expect(fp1.data[0]).toBe(phys(truth.signals[0].digital[256]));
      expect(fp1.data[127]).toBe(phys(truth.signals[0].digital[383]));
      expect(Number.isNaN(fp1.data[128])).toBe(true);
      expect(Number.isNaN(fp1.data[6.25 * 256 - 1])).toBe(true);
      expect(fp1.data[6.25 * 256]).toBe(phys(truth.signals[0].digital[384]));
    });
  }
});

describe.skipIf(!hasData)('agrees with edfcore (independent MIT reader)', () => {
  for (const name of ['synthetic/synthetic_edf_D.edf', 'synthetic/synthetic_bdf_D.bdf', 'S001R03.edf', 'test_generator_2.bdf']) {
    it(name, async () => {
      const edfcore = await import('edfcore');
      const { fileSource: coreFile } = await import('edfcore/node');
      const src = await coreFile(join(DATA, name));
      try {
        const theirs: any = await edfcore.openEdf(src);
        const ours = await EdfRecording.open(await fileSource(name));
        const th = theirs.header;
        expect(ours.header.variant).toBe(th.variant);
        const theirSignals = th.signals.filter((s: any) => !/Annotations/.test(s.label));
        expect(ours.signals.map((s) => s.label)).toEqual(theirSignals.map((s: any) => s.label));
        const ann: any = await edfcore.readAnnotations(theirs, { start: 0, count: th.recordCount });
        const theirTexts = ann.annotations.map((a: any) => a.text).sort();
        expect(ours.annotations.map((a) => a.text).sort()).toEqual(theirTexts);
        const index: any = await edfcore.buildRecordIndex(theirs);
        expect(index.coverage).toBe('complete');
        expect(ours.segments.map((g) => [g.firstRecord, g.start, g.end])).toEqual(
          index.segments.map((g: any) => [g.records.start ?? g.records.first, g.startSeconds, g.endSeconds]),
        );
        for (let r = 0; r < th.recordCount; r++) {
          expect(ours.recordOnsets[r]).toBe(Number(await index.onsetTicks(r)) / 1e7);
        }
        const raw: any = await edfcore.readRecords(theirs, {
          records: { start: 0, count: th.recordCount },
          signalIndices: [theirSignals[0].index],
        });
        const theirDigital = raw.signals[0].digital;
        const ourDigital = await ours.readDigital(ours.signals[0].index, 0, th.recordCount);
        expect(Array.from(theirDigital as ArrayLike<number>)).toEqual(Array.from(ourDigital));
      } finally {
        await src.close();
      }
    });
  }
});

describe.skipIf(!hasData)('malformed files fail cleanly', () => {
  const cases: [string, string | null][] = [
    ['truncated', 'TRUNCATED'],
    ['header_size_mismatch', 'HEADER_SIZE_MISMATCH'],
    ['non_numeric_duration', 'BAD_FIELD'],
    ['non_numeric_physical_min', 'BAD_FIELD'],
    ['digital_min_equals_max', 'BAD_SIGNAL'],
    ['zero_samples_per_record', 'BAD_SIGNAL'],
    ['zero_signals', 'NO_SIGNALS'],
    ['bad_version', 'BAD_VERSION'],
    ['too_short', 'TOO_SHORT'],
    ['zero_duration_with_signals', 'BAD_RECORD_DURATION'],
    ['record_count_minus_one', null],
    ['tal_without_terminator', null],
  ];
  for (const [name, code] of cases) {
    it(`${name} -> ${code ?? 'opens with a warning'}`, async () => {
      const p = EdfRecording.open(await fileSource(`synthetic/bad_${name}.edf`));
      if (code) {
        await expect(p).rejects.toBeInstanceOf(EdfError);
        await expect(p).rejects.toHaveProperty('code', code);
      } else {
        const rec = await p;
        expect(rec.warnings.length).toBeGreaterThan(0);
        expect(rec.header.recordCount).toBe(4);
      }
    });
  }
  it('truncated file opens with allowTruncated and reads complete records only', async () => {
    const rec = await EdfRecording.open(await fileSource('synthetic/bad_truncated.edf'), { allowTruncated: true });
    expect(rec.header.recordCount).toBe(3);
    expect(rec.warnings.join(' ')).toMatch(/truncated/);
  });
});
