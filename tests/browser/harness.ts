// Runs the real engine inside a real Web Worker in the browser and reports what it saw.
import { createEngineClient } from '../../src/core/client';

async function run() {
  const out: Record<string, unknown> = {};
  const eeg = createEngineClient(new Worker(new URL('../../src/core/worker.ts', import.meta.url), { type: 'module' }));
  const fetchFile = async (name: string) => {
    const r = await fetch(`/samples/${name}`);
    return new File([await r.blob()], name);
  };
  const info = await eeg.open(await fetchFile('S001R03.edf'));
  out.variant = info.variant;
  out.signals = info.signals.length;
  await eeg.setSettings({ filters: { highpass: 0.5, lowpass: 35, notch: 60, order: 2, notchQ: 30 } });
  const times: number[] = [];
  let first: Float32Array | null = null;
  for (let s = 0; s <= 90; s += 3) {
    const t = performance.now();
    const w = await eeg.readWindow({ start: s, duration: 30, width: 1600 });
    times.push(performance.now() - t);
    if (!first) first = w.channels[0].data;
    out.channels = w.channels.length;
    out.mode = w.channels[0].mode;
  }
  times.sort((a, b) => a - b);
  out.roundTripMedianMs = times[Math.floor(times.length / 2)];
  out.roundTripWorstMs = times[times.length - 1];
  out.firstValues = Array.from(first!.slice(0, 4));
  const sleep = await eeg.open(await fetchFile('SC4001E0-PSG-sleep-excerpt.edf'));
  out.sleepDuration = sleep.duration;
  const added = await eeg.addAnnotationFile(await fetchFile('SC4001EC-Hypnogram.edf'), 'SC4001EC-Hypnogram.edf');
  out.hypnogramOffset = added.offset;
  const hyp = await eeg.hypnogram();
  out.hypnogramEpochs = hyp.epochs.length;
  // Through the Worker too: the EEG filters never touch the 1 Hz non-EEG rows.
  await eeg.setSettings({ filters: { highpass: 0, lowpass: 0, notch: 0, order: 2, notchQ: 30 } });
  const plain = await eeg.readWindow({ start: 12000, duration: 600, width: 8192 });
  await eeg.setSettings({ filters: { highpass: 0.3, lowpass: 35, notch: 0, order: 2, notchQ: 30 } });
  const filt = await eeg.readWindow({ start: 12000, duration: 600, width: 8192 });
  out.kinds = filt.channels.map((c) => c.kind);
  // A filtered read may carry one more sample at the window end (its settle margin reaches past it); compare the shared part.
  out.slowRowsRaw = [3, 4, 5, 6].every((i) => {
    const a = filt.channels[i].data;
    const b = plain.channels[i].data;
    return b.length >= 599 && b.every((v, k) => Object.is(v, a[k]));
  });
  out.eegFiltered = filt.channels[0].data.some((v, k) => Math.abs(v - plain.channels[0].data[k]) > 1);
  const t = performance.now();
  const tile = await eeg.spectrogram({ derivation: 0, start: 0, duration: sleep.duration, segment: 30, overlap: 0, fmax: 30, columns: 600 });
  out.spectrogramMs = performance.now() - t;
  out.spectrogramShape = [tile.ntime, tile.nfreq];
  try {
    await eeg.open(new File([new Uint8Array(100)], 'broken.edf'));
    out.brokenFile = 'opened (wrong)';
  } catch (e) {
    out.brokenFile = (e as { code?: string }).code;
  }
  (window as any).__result = out;
  document.getElementById('out')!.textContent = JSON.stringify(out, null, 2);
}
run().catch((e) => {
  (window as any).__result = { error: String(e) };
});
