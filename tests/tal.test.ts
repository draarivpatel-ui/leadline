// TAL (time-stamped annotation list) parsing through whole recordings: multiple texts per stamp,
// durations, malformed bytes, and the record time-keeping rules of EDF+.
import { describe, expect, it } from 'vitest';
import { EdfRecording } from '../src/core/edf/recording';
import { parseTals } from '../src/core/edf/tal';
import { bytesSource } from '../src/core/edf/source';
import { annotationSignal, eegSignal, synthSource } from './synth';

const TAL = (s: string) => new TextEncoder().encode(s);
const openPlus = (tals: string[]) =>
  EdfRecording.open(synthSource({ reserved: 'EDF+C', signals: [eegSignal(2), annotationSignal(tals)], recordCount: tals.length, records: tals.length }));

describe('parseTals on raw bytes', () => {
  it('reads several texts in one stamp and several TALs in one record', () => {
    const r = parseTals(TAL('+1.5\x15' + '0.5\x14\x14first\x14second\x14\x00+3\x14third\x14\x00'), true);
    expect(r.recordOnset).toBe(1.5);
    expect(r.annotations).toEqual([
      { onset: 1.5, duration: 0.5, text: 'first' },
      { onset: 1.5, duration: 0.5, text: 'second' },
      { onset: 3, duration: null, text: 'third' },
    ]);
    expect(r.problems).toEqual([]);
  });

  it('accepts negative onsets and fractional durations', () => {
    const r = parseTals(TAL('-2.25\x15' + '.75\x14x\x14\x00'), true);
    expect(r.annotations[0]).toEqual({ onset: -2.25, duration: 0.75, text: 'x' });
  });

  it('decodes UTF-8 annotation text', () => {
    const r = parseTals(TAL('+0\x14' + 'sleµp stage 2\x14\x00'), true);
    expect(r.annotations[0].text).toBe('sleµp stage 2');
  });

  it('skips empty annotation texts', () => {
    const r = parseTals(TAL('+0\x14\x14\x14\x00'), true);
    expect(r.annotations).toEqual([]);
  });

  it('reports a TAL that never ends, and a malformed onset', () => {
    const r = parseTals(TAL('+0\x14ok\x14\x00abc\x14x\x14\x00'), true);
    expect(r.annotations.map((a) => a.text)).toEqual(['ok']);
    expect(r.problems.some((p) => /onset is malformed/.test(p))).toBe(true);
  });

  it('reports a missing closing separator and a bad duration', () => {
    const r = parseTals(TAL('+0\x14ok\x14\x00+1\x15two\x14x\x14\x00+2\x14no end\x14'), true);
    expect(r.problems.some((p) => /duration is malformed/.test(p))).toBe(true);
    expect(r.problems.some((p) => /closing 0x00/.test(p) || /0x14 separator/.test(p))).toBe(true);
  });

  it('the first empty TAL of the first signal is the record time-keeping stamp', () => {
    const r = parseTals(TAL('+7\x14\x14text\x14\x00'), true);
    expect(r.recordOnset).toBe(7);
    expect(r.annotations.map((a) => a.text)).toEqual(['text']);
    // A first TAL without the empty stamp leaves recordOnset null; a later empty TAL is not timekeeping.
    expect(parseTals(TAL('+1\x14x\x14\x00+7\x14\x14\x00'), true).recordOnset).toBeNull();
    expect(parseTals(TAL('+7\x14\x14\x00'), false).recordOnset).toBeNull();
  });
});

describe('TALs inside a recording', () => {
  it('collects annotations across records and keeps the record onsets', async () => {
    const rec = await openPlus(['+0\x14\x14Went to bed\x14\x00', '+1\x14\x14Sleep stage W\x14\x00']);
    expect(rec.annotations.map((a) => [a.onset, a.text])).toEqual([
      [0, 'Went to bed'],
      [1, 'Sleep stage W'],
    ]);
    expect(Array.from(rec.recordOnsets)).toEqual([0, 1]);
  });

  it('missing time-keeping is assumed contiguous, with one warning', async () => {
    const rec = await openPlus(['+0\x14\x14\x00', '+1\x14note\x14\x00', '\x00\x00']);
    expect(rec.warnings.some((w) => /no time-keeping annotation/.test(w))).toBe(true);
    expect(rec.recordOnsets[2]).toBeCloseTo(2, 9);
    expect(rec.annotations.map((a) => a.text)).toEqual(['note']);
  });

  it('a record starting before the previous one ends fails closed', async () => {
    const p = openPlus(['+0\x14\x14\x00', '+0.5\x14\x14\x00']); // record 2 begins at 0.5 < 1 s
    await expect(p).rejects.toMatchObject({ code: 'BAD_TAL' });
  });

  it('deduplicates repeated TAL problems into the warnings', async () => {
    const bad = 'badstamp\x14x\x14\x00';
    const rec = await openPlus(['+0\x14\x14\x00', bad, bad]);
    const hits = rec.warnings.filter((w) => /onset is malformed/.test(w));
    expect(hits.length).toBe(1);
  });
});
