// Regression coverage for the hostile-review findings: malformed headers fail
// closed, absurd claims stay bounded, and exported API surfaces reject bad
// arguments instead of poisoning later calls.
import { describe, expect, it } from 'vitest';
import { EdfRecording } from '../src/core/edf/recording';
import { Engine } from '../src/core/engine';
import { parseTals } from '../src/core/edf/tal';
import { chooseTickStep } from '../src/app/ticks';
import { annotationSignal, eegSignal, synthSource } from './synth';

const open = (o: Parameters<typeof synthSource>[0]) => Engine.open(synthSource(o));

describe('non-finite and overflowing header fields', () => {
  it('rejects a physical range that overflows to infinity', async () => {
    await expect(open({ signals: [eegSignal(4), { ...eegSignal(4), label: 'B', pmin: '-1e309', pmax: '1e309' }], recordCount: 1, records: 1 }))
      .rejects.toMatchObject({ code: 'BAD_FIELD' });
  });

  it('rejects a record duration that overflows to infinity', async () => {
    await expect(open({ signals: [eegSignal(4)], recordCount: 1, records: 1, recordDuration: '1e309' }))
      .rejects.toMatchObject({ code: 'BAD_FIELD' });
  });

  it('rejects a finite range too wide to convert', async () => {
    await expect(open({ signals: [eegSignal(4), { ...eegSignal(4), label: 'B', pmin: '-1e308', pmax: '1e308' }], recordCount: 1, records: 1 }))
      .rejects.toMatchObject({ code: 'BAD_FIELD' });
  });
});

describe('an absurd claimed duration stays bounded', () => {
  it('opens a file claiming a trillion-second span without hanging the ticks', async () => {
    const e = await open({ signals: [eegSignal(4)], recordCount: 1, records: 1, recordDuration: '1e+12' });
    expect(e.info().duration).toBe(1e12);
    const ticks = e.info().duration / chooseTickStep(e.info().duration, 8);
    expect(ticks).toBeLessThanOrEqual(601);
  });

  it('chooseTickStep bounds the count at any duration and keeps normal steps', () => {
    expect(60 / chooseTickStep(60, 8)).toBeLessThanOrEqual(601);
    expect(chooseTickStep(60, 8)).toBe(10);
    expect(1e12 / chooseTickStep(1e12, 8)).toBeLessThanOrEqual(601);
    expect(chooseTickStep(Infinity, 8)).toBe(Infinity);
    expect(chooseTickStep(0, 8)).toBeGreaterThan(0);
  });
});

describe('start date validation', () => {
  const plus = (startdate: string) =>
    open({ reserved: 'EDF+C', recording: `Startdate ${startdate} X X X`, signals: [eegSignal(2), annotationSignal(['+0\x14\x14\x00'])], recordCount: 1, records: 1 });

  it('rejects out-of-range EDF+ Startdate days', async () => {
    await expect(plus('99-JAN-2020')).rejects.toMatchObject({ code: 'BAD_FIELD' });
    await expect(plus('00-JAN-2020')).rejects.toMatchObject({ code: 'BAD_FIELD' });
    await expect(plus('30-FEB-2020')).rejects.toMatchObject({ code: 'BAD_FIELD' });
    await expect(plus('31-APR-2020')).rejects.toMatchObject({ code: 'BAD_FIELD' });
  });

  it('rejects an unknown EDF+ Startdate month', async () => {
    await expect(plus('15-FOO-2020')).rejects.toMatchObject({ code: 'BAD_FIELD' });
  });

  it('accepts a leap day and a normal date in the EDF+ Startdate', async () => {
    const leap = await plus('29-FEB-2020');
    expect(new Date(leap.info().startMs).getUTCDate()).toBe(29);
    await expect(plus('01-MAR-2020')).resolves.toBeDefined();
  });

  it('checks the month length on the plain date field too', async () => {
    await expect(open({ date: '30.02.20', signals: [eegSignal(2)], recordCount: 1, records: 1 })).rejects.toMatchObject({ code: 'BAD_FIELD' });
    const e = await open({ date: '29.02.20', signals: [eegSignal(2)], recordCount: 1, records: 1 });
    expect(new Date(e.info().startMs).getUTCDate()).toBe(29);
    await expect(open({ date: '29.02.99', signals: [eegSignal(2)], recordCount: 1, records: 1 })).rejects.toMatchObject({ code: 'BAD_FIELD' });
  });
});

describe('annotation onsets beyond the clock', () => {
  it('keeps a far-future annotation, reports it, and survives the open', async () => {
    const tals = ['+0\x14\x14\x00', '+9000000000000\x14mark\x14\x00'];
    const e = await open({ reserved: 'EDF+C', signals: [eegSignal(2), annotationSignal(tals)], recordCount: 2, records: 2 });
    expect(e.annotations().some((a) => a.onset === 9e12 && a.text === 'mark')).toBe(true);
    expect(e.info().warnings.some((w) => /far outside any plausible recording/.test(w))).toBe(true);
  });

  it('parseTals flags the absurd onset', () => {
    const r = parseTals(new TextEncoder().encode('+9000000000000\x14x\x14\x00'), true);
    expect(r.annotations[0].onset).toBe(9e12);
    expect(r.problems.some((p) => /far outside/.test(p))).toBe(true);
  });
});

describe('engine argument validation', () => {
  it('readWindow rejects a non-finite start', async () => {
    const e = await open({ signals: [eegSignal(4, [[0, 1, 2, 3]])], recordCount: 1, records: 1 });
    await expect(e.readWindow({ start: NaN, duration: 1, width: 100 })).rejects.toThrow(/start/);
    await expect(e.readWindow({ start: Infinity, duration: 1, width: 100 })).rejects.toThrow(/start/);
    await expect(e.readWindow({ start: 0, duration: 1, width: 100 })).resolves.toBeDefined();
  });

  it('setSettings rejects a non-integer or zero filter order', async () => {
    const e = await open({ signals: [eegSignal(4, [[0, 1, 2, 3]])], recordCount: 1, records: 1 });
    expect(() => e.setSettings({ filters: { order: 2.5 } })).toThrow(/whole number/);
    expect(() => e.setSettings({ filters: { order: 0 } })).toThrow(/whole number/);
    expect(() => e.setSettings({ filters: { order: 4 } })).not.toThrow();
  });
});
