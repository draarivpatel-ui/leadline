/**
 * The viewer page. All reading and signal processing happens in the engine Worker (src/core); this file holds
 * view state, input handling and drawing. Window requests are coalesced: one in flight at a time, and a reply
 * for a superseded request is dropped.
 */
import { createEngineClient, isEegLike, isSleepRecording, stageOf, type AnnotationItem, type Derivation, type Hypnogram, type RecordingInfo, type SpectrogramTile, type WindowResult } from '../core/index';
import { depthLabels, drawDepth, drawSpectrogram, drawTraces, readPalette, sizeCanvas, specAxis, spectrogramImage, type Palette } from './render';
import { chooseTickStep } from './ticks';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const worker = new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' });
const eeg = createEngineClient(worker);

const SAMPLES: Record<string, { files: string[]; spectrogram?: number }> = {
  sleep: { files: ['SC4001E0-PSG-sleep-excerpt.edf', 'SC4001EC-Hypnogram.edf'] },
  motor: { files: ['S001R03.edf'] },
};

interface State {
  info: RecordingInfo | null;
  channels: Derivation[];
  start: number;
  span: number;
  gain: number;
  grid: number;
  scales: number[];
  offsets: number[];
  tight: boolean[];
  win: WindowResult | null;
  annotations: AnnotationItem[];
  hyp: Hypnogram | null;
  spec: SpectrogramTile | null;
  specImage: HTMLCanvasElement | null;
  cursorX: number | null;
  rescale: boolean;
  showStageMarks: boolean;
  requestBaseline: number;
  /** Bumped whenever the montage or filters change; a window asked for under an older value is dropped. */
  settingsGen: number;
  /** True once the user picks a filter; until then each file opens with the defaults for its kind. */
  filtersTouched: boolean;
  /** The settings generation whose skipped filters were last announced. */
  announcedGen: number;
}

const S: State = {
  info: null,
  channels: [],
  start: 0,
  span: window.matchMedia('(max-width: 760px)').matches ? 10 : 30,
  gain: 1,
  grid: 1,
  scales: [],
  offsets: [],
  tight: [],
  win: null,
  annotations: [],
  hyp: null,
  spec: null,
  specImage: null,
  cursorX: null,
  rescale: true,
  showStageMarks: false,
  requestBaseline: 0,
  settingsGen: 0,
  filtersTouched: false,
  announcedGen: 0,
};

let P: Palette = readPalette();
const tracesCanvas = $<HTMLCanvasElement>('traces');
const tracesWrap = $('traces-wrap');
const labels = $('labels');
const depthCanvas = $<HTMLCanvasElement>('depth');
const specCanvas = $<HTMLCanvasElement>('spec');

/* ---------------- network proof ---------------- */
function countRequests(): number {
  return performance.getEntriesByType('resource').length;
}
function updateProof() {
  const n = Math.max(0, countRequests() - S.requestBaseline);
  $('req-count').textContent = String(n);
  $('req-word').textContent = n === 1 ? 'network request' : 'network requests';
}
new PerformanceObserver(updateProof).observe({ type: 'resource', buffered: false });

/* ---------------- opening files ---------------- */
async function openFiles(files: File[], allowTruncated = false) {
  if (files.length === 0) return;
  showError(null);
  setBusy(true);
  try {
    // The largest file is the recording; the rest are annotation files (a hypnogram, a scoring).
    const sorted = [...files].sort((a, b) => b.size - a.size);
    let info: RecordingInfo;
    // From here until the file is fully set up, no window is asked for, and replies to earlier ones are dropped:
    // the worker may already hold the new file while the page still shows the old one.
    // Not a settings change: if the current filters were announced, they stay announced (no repeat on the next pan).
    if (S.announcedGen === S.settingsGen) S.announcedGen++;
    S.settingsGen++;
    opening++;
    try {
      info = await eeg.open(sorted[0], { requireSignals: true, allowTruncated });
    } catch (e) {
      if ((e as { code?: string }).code !== 'ANNOTATIONS_ONLY') throw e;
      if (!S.info) throw new Error('It holds only annotations (for example a hypnogram). Open it together with its recording by selecting both files.');
      // A recording is open: add these annotations to it.
      for (const f of sorted) {
        const r = await eeg.addAnnotationFile(f, f.name);
        fileNotes.push(`${f.name}: ${r.added} annotations added, aligned by start time (${formatOffset(r.offset)}).`);
      }
      await refreshAnnotations();
      showToast(`Added the annotations of ${sorted.map((f) => f.name).join(', ')}`);
      return;
    }
    const notes: string[] = [];
    for (const extra of sorted.slice(1)) {
      try {
        const r = await eeg.addAnnotationFile(extra, extra.name);
        notes.push(`${extra.name}: ${r.added} annotations added, aligned by start time (${formatOffset(r.offset)}).`);
      } catch (e) {
        notes.push(`${extra.name} was not added: ${(e as Error).message}`);
      }
    }
    await loaded(info, notes);
  } catch (e) {
    const err = e as { message: string; code?: string };
    if (err.code === 'TRUNCATED') {
      // Common after a crash or a full disk: offer the complete records instead of refusing the file.
      const complete = Number(/only (\d+) complete/.exec(err.message)?.[1] ?? Number.NaN);
      const msg = `${sorted0Name(files)} ends early. ${err.message}${complete === 0 ? ' No complete record is left to show.' : ''}`;
      const action = complete === 0 ? undefined : { label: complete > 0 ? `Open the ${complete} complete records` : 'Open the complete records', run: () => openFiles(files, true) };
      if (S.info) showToast(msg, action);
      else showError(msg, action);
      return;
    }
    const msg = `${sorted0Name(files)} could not be opened. ${err.message} Choose another EDF, EDF+ or BDF file.`;
    if (S.info) {
      // Keep the recording that is open; the worker still holds it.
      showToast(msg);
    } else {
      showError(msg);
    }
  } finally {
    setBusy(false);
    if (opening > 0) opening--;
    pump();
  }
}

function sorted0Name(files: File[]) {
  return [...files].sort((a, b) => b.size - a.size)[0].name;
}

async function openSample(key: string) {
  const s = SAMPLES[key];
  closeMenu();
  setBusy(true);
  try {
    const files = await Promise.all(
      s.files.map(async (name) => {
        const r = await fetch(new URL(`samples/${name}`, document.baseURI));
        if (!r.ok) throw new Error(`The sample ${name} could not be loaded (${r.status}).`);
        return new File([await r.blob()], name);
      }),
    );
    await openFiles(files);
  } catch (e) {
    showError((e as Error).message);
    setBusy(false);
  }
}

let fileNotes: string[] = [];
async function loaded(info: RecordingInfo, notes: string[]) {
  // A reply still on its way for the previous file must not be drawn on this one.
  settingsChanged();
  S.info = info;
  fileNotes = notes;
  S.start = 0;
  S.win = null;
  S.spec = null;
  S.specImage = null;
  S.rescale = true;
  await Promise.all(['500 12px Sounding', '600 12px Sounding', 'italic 500 12px Sounding'].map((f) => document.fonts.load(f)));
  S.requestBaseline = countRequests();
  updateProof();
  // Montage options.
  const sel = $<HTMLSelectElement>('montage');
  sel.innerHTML = '';
  for (const m of info.montages) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.count ? `${m.name} (${m.count})` : `${m.name}, not available`;
    o.disabled = m.count === 0;
    sel.append(o);
  }
  sel.value = 'referential';
  sel.disabled = info.montages.filter((m) => m.count > 0).length < 2;
  for (const m of info.montages) {
    const o = [...sel.options].find((x) => x.value === m.id);
    if (o) o.title = m.note ?? '';
  }
  S.channels = await eeg.channels();
  S.annotations = await eeg.annotations();
  S.hyp = await eeg.hypnogram();
  if (S.hyp.epochs.length === 0) S.hyp = null;
  if (!S.filtersTouched) setFilterControls(isSleepRecording(S.channels, !!S.hyp) ? SLEEP_FILTERS : EEG_FILTERS);
  await applyFilters(false);
  S.announcedGen = S.settingsGen; // the row marks say it on open; the toast is for changes
  if (S.span > info.duration) S.span = pickSpan(info.duration);
  $<HTMLSelectElement>('span').value = String(S.span);
  S.grid = S.hyp ? 30 : 1;
  $<HTMLSelectElement>('grid').value = String(S.grid);
  document.body.classList.add('has-file');
  $('start').hidden = true;
  $('viewer').hidden = false;
  $('chart').hidden = false;
  $('chart').classList.toggle('no-stages', !S.hyp);
  document.title = `${info.fileName} · Leadline`;
  fillSpecChannels();
  renderFacts();
  renderAnnotations();
  layout();
  requestWindow();
  loadSpectrogram();
}

function pickSpan(duration: number) {
  return [5, 10, 20, 30].reverse().find((s) => s <= duration) ?? 5;
}

function formatOffset(s: number) {
  if (s === 0) return 'same start';
  return `starts ${hms(Math.abs(s))} ${s < 0 ? 'before' : 'after'} the recording`;
}

async function refreshAnnotations() {
  S.annotations = await eeg.annotations();
  const h = await eeg.hypnogram();
  S.hyp = h.epochs.length ? h : null;
  if (S.info) S.info = { ...S.info, annotationCount: S.annotations.length };
  $('chart').classList.toggle('no-stages', !S.hyp);
  renderFacts();
  renderAnnotations();
  requestAnimationFrame(onResize);
  renderAxes();
  draw();
}

/* ---------------- settings ---------------- */
/** Display filters a file opens with. Sleep scoring uses 0.3 to 35 Hz (AASM); 1 Hz would shrink 0.5 Hz slow waves to 6%. */
const SLEEP_FILTERS = { hp: '0.3', lp: '35' };
const EEG_FILTERS = { hp: '1', lp: '70' };

function setFilterControls(f: { hp: string; lp: string }) {
  $<HTMLSelectElement>('hp').value = f.hp;
  $<HTMLSelectElement>('lp').value = f.lp;
}

/** Marks the start of a settings change: any window reply asked for before it is dropped, and rows rescale. */
function settingsChanged() {
  S.settingsGen++;
  S.rescale = true;
}

async function applyFilters(redraw = true) {
  const num = (id: string) => Number($<HTMLSelectElement>(id).value);
  settingsChanged();
  try {
    await eeg.setSettings({ filters: { highpass: num('hp'), lowpass: num('lp'), notch: num('notch'), order: 2, notchQ: 30 } });
  } catch (e) {
    showToast((e as Error).message);
    return;
  }
  if (redraw) requestWindow();
}

async function applyMontage() {
  const id = $<HTMLSelectElement>('montage').value as 'referential' | 'bipolar' | 'average';
  settingsChanged();
  try {
    await eeg.setSettings({ montage: id });
  } catch (e) {
    showToast((e as Error).message);
    return;
  }
  S.channels = await eeg.channels();
  // Again, now that the channel list is the new one: a reply that arrived in between belongs to neither.
  settingsChanged();
  const note = S.info?.montages.find((m) => m.id === id)?.note;
  if (note) showToast(note);
  pendingNote = note ?? '';
  S.win = null;
  S.spec = null;
  S.specImage = null;
  fillSpecChannels();
  layout();
  requestWindow();
  loadSpectrogram();
}

/* ---------------- window requests ---------------- */
let inflight = false;
/** Files being opened; windows wait until the new file is set up. */
let opening = 0;
let wanted = 0;
let served = 0;
function requestWindow() {
  wanted++;
  pump();
}

async function pump() {
  if (inflight || opening > 0 || !S.info || served === wanted) return;
  inflight = true;
  const ticket = wanted;
  const gen = S.settingsGen;
  const start = S.start;
  const span = S.span;
  const width = Math.min(4096, Math.max(64, Math.round(tracesWrap.clientWidth)));
  try {
    const win = await eeg.readWindow({ start, duration: span, width });
    // A reply asked for under other settings is never drawn (its rows may not even be this montage's). Under the
    // same settings, a newer request supersedes it only if the view moved since it was asked.
    if (gen === S.settingsGen && (ticket === wanted || (start === S.start && span === S.span))) {
      S.win = win;
      if (S.rescale) autoscale(win);
      else updateOffsets(win, true);
      served = ticket;
      announceSkipped(win, gen);
      draw();
    }
  } catch (e) {
    // An error for a request from older settings (say a start beyond the end of the new file) is not shown; the
    // request is simply asked again under the current settings.
    if (gen === S.settingsGen) {
      showToast((e as Error).message);
      served = ticket;
    }
  } finally {
    inflight = false;
    if (served !== wanted) pump();
    else for (const r of idleWaiters.splice(0)) r();
  }
}
const idleWaiters: (() => void)[] = [];
/** Resolves once the latest requested window has been drawn. */
function whenIdle(): Promise<void> {
  if (!inflight && served === wanted && S.win) return Promise.resolve();
  return new Promise((r) => idleWaiters.push(r));
}

function robust(c: WindowResult['channels'][number]) {
  const mids: number[] = [];
  const amps: number[] = [];
  if (c.mode === 'minmax') {
    for (let i = 0; i < c.columns; i++) {
      const a = c.data[2 * i];
      const b = c.data[2 * i + 1];
      if (Number.isNaN(a)) continue;
      mids.push((a + b) / 2);
    }
  } else {
    for (const v of c.data) if (!Number.isNaN(v)) mids.push(v);
  }
  if (mids.length === 0) return { median: 0, spread: 1, peak: 1 };
  const sorted = [...mids].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (c.mode === 'minmax') {
    for (let i = 0; i < c.columns; i++) {
      const a = c.data[2 * i];
      const b = c.data[2 * i + 1];
      if (!Number.isNaN(a)) amps.push(Math.max(Math.abs(a - median), Math.abs(b - median)));
    }
  } else {
    for (const v of mids) amps.push(Math.abs(v - median));
  }
  amps.sort((a, b) => a - b);
  const spread = amps[Math.floor(amps.length * 0.98)] || amps[amps.length - 1] || 1;
  const peak = amps[amps.length - 1] || 1;
  return { median, spread, peak };
}

function nice(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function autoscale(win: WindowResult) {
  S.scales = [];
  S.offsets = [];
  S.tight = [];
  // Channels that share a unit and look like EEG share one scale, so their amplitudes stay comparable.
  const byUnit = new Map<string, number[]>();
  win.channels.forEach((c, i) => {
    const r = robust(c);
    S.offsets[i] = r.median;
    S.tight[i] = !isEegLike(c);
    S.scales[i] = S.tight[i] ? r.peak * 1.1 || 1 : nice(r.spread || 1);
    if (isEegLike(c)) byUnit.set(c.unit, [...(byUnit.get(c.unit) ?? []), i]);
  });
  for (const ids of byUnit.values()) {
    const s = ids.map((i) => S.scales[i]).sort((a, b) => a - b);
    const shared = s[Math.floor(s.length / 2)];
    for (const i of ids) S.scales[i] = shared;
  }
  S.rescale = false;
}

/** Re-centres every channel on the new window; slow non-EEG channels are also re-fitted to their row. */
function updateOffsets(win: WindowResult, refitTight = false) {
  win.channels.forEach((c, i) => {
    const r = robust(c);
    S.offsets[i] = r.median;
    if (refitTight && S.tight[i]) S.scales[i] = r.peak * 1.1 || 1;
  });
}

/* ---------------- labels and units ---------------- */
const UNIT: Record<string, string> = { uV: '\u00b5V', UV: '\u00b5V', uv: '\u00b5V', mV: 'mV', mv: 'mV', V: 'V', degC: '\u00b0C', DegC: '\u00b0C', degc: '\u00b0C' };
const unitOf = (u: string) => UNIT[u] ?? u;
/** File labels as shown: trailing padding dots (PhysioNet motor imagery) trimmed; the title keeps the original. */
const shown = (label: string) => label.replace(/\.+$/, '');

/** A montage note waiting to be shown together with the skipped filters of that montage's first window. */
let pendingNote = '';

/** After a filter or montage change, one line on the rows drawn without some of the chosen filters. */
function announceSkipped(win: WindowResult, gen: number) {
  if (gen === S.announcedGen) return;
  S.announcedGen = gen;
  const lead = pendingNote;
  pendingNote = '';
  const raw = win.channels.filter((c) => c.kind === 'other' && c.skippedFilters.length).length;
  const partial = new Map<string, number>();
  for (const c of win.channels) if (c.kind !== 'other') for (const f of c.skippedFilters) partial.set(f, (partial.get(f) ?? 0) + 1);
  const parts: string[] = [];
  for (const [f, n] of partial) parts.push(`${f[0].toUpperCase()}${f.slice(1)} is not applied to ${n} ${n === 1 ? 'row' : 'rows'}${/EOG/.test(f) ? '' : ' (at or above their Nyquist frequency)'}.`);
  if (raw) parts.push(`${raw} ${raw === 1 ? 'row is' : 'rows are'} not EEG and ${raw === 1 ? 'is' : 'are'} drawn unfiltered.`);
  if (parts.length) showToast([lead, ...parts].filter(Boolean).join(' '));
}

/* ---------------- layout and drawing ---------------- */
let rowH = 24;
function layout() {
  const n = Math.max(1, S.channels.length);
  const avail = tracesWrap.clientHeight;
  rowH = Math.max(18, Math.floor(avail / n));
  renderLabels();
  draw();
}

function groupStarts(): Set<number> {
  const set = new Set<number>();
  S.channels.forEach((c, i) => {
    if (i > 0 && c.group && c.group !== S.channels[i - 1].group) set.add(i);
  });
  return set;
}

function renderLabels() {
  labels.innerHTML = '';
  labels.style.height = `${S.channels.length * rowH}px`;
  const starts = groupStarts();
  S.channels.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = `row-label${starts.has(i) ? ' group-start' : ''}${rowH >= 40 ? ' tall' : ''}`;
    el.style.top = `${i * rowH}px`;
    el.style.height = `${rowH}px`;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = shown(c.label);
    name.title = `${c.label}, ${c.sampleRate} Hz${c.unit ? `, ${unitOf(c.unit)}` : ''}`;
    const bar = document.createElement('span');
    bar.className = 'scalebar';
    bar.style.height = `${Math.max(6, Math.round(rowH / 2))}px`;
    const scale = document.createElement('span');
    scale.className = 'scale';
    const val = document.createElement('span');
    val.className = 'val';
    const tag = document.createElement('span');
    tag.className = 'tag';
    el.append(name, tag, bar, scale, val);
    labels.append(el);
  });
  syncLabelScroll();
}

function syncLabelScroll() {
  labels.scrollTop = tracesWrap.scrollTop;
  labels.style.transform = `translateY(${-tracesWrap.scrollTop}px)`;
}

function fmtVal(v: number, unit: string) {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${s.replace('-', '−')} ${unitOf(unit)}`.trim();
}

function updateLabelValues() {
  const rows = labels.querySelectorAll<HTMLElement>('.row-label');
  const win = S.win;
  rows.forEach((row, i) => {
    const el = row.querySelector<HTMLElement>('.val')!;
    const sc = row.querySelector<HTMLElement>('.scale')!;
    const c = win?.channels[i];
    markFilters(row, c);
    if (!c) {
      el.textContent = '';
      sc.textContent = '';
      return;
    }
    // The bar is half a row tall, so it measures exactly this much signal.
    const scaleText = `${fmtScale(S.scales[i] / S.gain)} ${unitOf(c.unit)}`.trim();
    sc.textContent = scaleText;
    row.querySelector<HTMLElement>('.scalebar')!.title = `Bar height: ${scaleText}`;
    if (S.cursorX === null) {
      // Short rows have one value slot: it names the bar's scale on the first row of each run that shares one.
      const prev = win?.channels[i - 1];
      const first = !prev || prev.unit !== c.unit || S.scales[i - 1] / S.gain !== S.scales[i] / S.gain;
      el.textContent = row.classList.contains('tall') || !first ? '' : scaleText;
      row.classList.remove('hot');
      return;
    }
    const t = S.start + (S.cursorX / tracesWrap.clientWidth) * S.span;
    let v = Number.NaN;
    if (c.mode === 'raw') {
      const k = Math.round((t - c.t0) / c.dt);
      v = c.data[k];
    } else {
      const k = Math.floor((t - c.t0) / c.dt);
      if (k >= 0 && k < c.columns) v = (c.data[2 * k] + c.data[2 * k + 1]) / 2;
    }
    el.textContent = fmtVal(v, c.unit);
    row.classList.add('hot');
  });
}

/** Rows drawn without some or all of the chosen filters say so: a tag on the label, the details in its title. */
function markFilters(row: HTMLElement, c: WindowResult['channels'][number] | undefined) {
  const skipped = c?.skippedFilters ?? [];
  // Runs on every draw (cursor moves too): touch the DOM only when this row's state changes.
  const key = `${c?.kind ?? ''}|${skipped.join(',')}`;
  if (row.dataset.filters === key) return;
  row.dataset.filters = key;
  const raw = !!c && c.kind === 'other' && skipped.length > 0;
  const partial = !raw && skipped.length > 0;
  row.classList.toggle('unfiltered', raw);
  row.classList.toggle('part-filtered', partial);
  const tag = row.querySelector<HTMLElement>('.tag')!;
  tag.textContent = raw ? 'raw' : partial ? 'part' : '';
  const name = row.querySelector<HTMLElement>('.name')!;
  const base = name.title.split('\n')[0];
  name.title = raw ? `${base}\nNot an EEG channel: drawn without the display filters.` : partial ? `${base}\nDrawn without: ${skipped.join(', ')}.` : base;
  tag.title = name.title;
}

function fmtScale(v: number) {
  return v >= 10 ? String(Math.round(v)) : v >= 1 ? v.toFixed(1).replace(/\.0$/, '') : v.toPrecision(2);
}

function visibleMarks(): AnnotationItem[] {
  return S.annotations.filter((a) => S.showStageMarks || stageOf(a.text) === null);
}

function draw() {
  if (!S.info) return;
  const w = tracesWrap.clientWidth;
  const n = Math.max(1, S.channels.length);
  const ctx = sizeCanvas(tracesCanvas, w, n * rowH);
  const win = S.win;
  if (win) {
    drawTraces(
      ctx,
      { width: w, rowH, rows: n, groupStarts: groupStarts() },
      {
        start: win.start,
        duration: win.duration,
        channels: win.channels,
        scales: S.scales,
        offsets: S.offsets,
        gain: S.gain,
        tight: S.tight,
        grid: S.grid,
        annotations: visibleMarks().filter((a) => a.onset <= win.start + win.duration && a.onset + (a.duration ?? 0) >= win.start),
        cursorX: S.cursorX,
        startMs: S.info.startMs,
      },
      P,
    );
  }
  drawChart();
  updateLabelValues();
  $('clock').textContent = clockAt(S.start);
  $('clock').title = `${hms(S.start)} after the recording start`;
  $('gain-out').textContent = `${S.gain >= 10 ? S.gain.toFixed(0) : S.gain.toFixed(1)}x`;
  depthCanvas.setAttribute('aria-valuemax', String(Math.round(S.info.duration)));
  depthCanvas.setAttribute('aria-valuenow', String(Math.round(S.start)));
  depthCanvas.setAttribute('aria-valuetext', clockAt(S.start));
  markCurrentAnnotations();
}

function drawChart() {
  if (!S.info) return;
  const view = { start: S.start, duration: S.span };
  const dw = depthCanvas.clientWidth;
  const dh = depthCanvas.clientHeight;
  drawDepth(sizeCanvas(depthCanvas, dw, dh, false), dw, dh, S.info.duration, S.hyp, visibleMarks().filter((a) => stageOf(a.text) === null), view, P);
  const sw = specCanvas.clientWidth;
  const sh = specCanvas.clientHeight;
  drawSpectrogram(sizeCanvas(specCanvas, sw, sh, false), sw, sh, S.info.duration, S.spec, S.specImage, view, P);
}

function renderAxes() {
  const da = $('depth-axis');
  da.innerHTML = '';
  if (S.hyp) {
    const labels = depthLabels(S.hyp);
    labels.forEach((l, k) => {
      const s = document.createElement('span');
      s.textContent = l;
      s.style.top = `${((k + 0.5) / labels.length) * 100}%`;
      da.append(s);
    });
  }
  const sa = $('spec-axis');
  sa.innerHTML = '';
  if (S.spec && S.spec.nfreq > 1) {
    const ax = specAxis(S.spec);
    for (const f of [1, 4, 10, 30].filter((f) => f >= ax.lo && f <= ax.hi)) {
      const s = document.createElement('span');
      s.textContent = `${f} Hz`;
      s.style.top = `${Math.min(92, Math.max(8, (1 - ax.frac(f)) * 100))}%`;
      sa.append(s);
    }
  }
  // Clock time along the bottom.
  const tl = $('timeline');
  tl.innerHTML = '';
  if (!S.info) return;
  const d = S.info.duration;
  const want = Math.max(2, Math.floor(tl.clientWidth / 90));
  const step = chooseTickStep(d, want);
  const startClock = (S.info.startMs / 1000) % 86400;
  const first = Math.ceil((startClock) / step) * step - startClock;
  for (let t = first; t <= d; t += step) {
    const s = document.createElement('span');
    s.style.left = `${(t / d) * 100}%`;
    s.textContent = step >= 60 ? clockAt(t).slice(0, 5) : clockAt(t);
    tl.append(s);
  }
}

/* ---------------- spectrogram ---------------- */
function fillSpecChannels() {
  const sel = $<HTMLSelectElement>('spec-channel');
  const prev = sel.value;
  sel.innerHTML = '';
  S.channels.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = shown(c.label);
    sel.append(o);
  });
  const firstEeg = S.channels.findIndex((c) => c.kind === 'eeg' && c.sampleRate >= 64);
  sel.value = prev && Number(prev) < S.channels.length ? prev : String(Math.max(0, firstEeg));
}

let specTicket = 0;
async function loadSpectrogram() {
  if (!S.info) return;
  const ticket = ++specTicket;
  const derivation = Number($<HTMLSelectElement>('spec-channel').value) || 0;
  const c = S.channels[derivation];
  if (!c) return;
  const d = S.info.duration;
  // Short segments averaged into columns give a smoother, more honest picture than one long periodogram each.
  const segment = d > 600 ? 4 : d > 60 ? 1 : 0.5;
  try {
    const tile = await eeg.spectrogram({
      derivation,
      start: 0,
      duration: d,
      segment,
      overlap: 0.5,
      fmax: Math.min(c.sampleRate / 2, 35),
      columns: Math.min(1600, Math.max(100, specCanvas.clientWidth)),
    });
    if (ticket !== specTicket) return;
    S.spec = tile;
    S.specImage = spectrogramImage(tile, P).canvas;
  } catch (e) {
    if (ticket !== specTicket) return;
    S.spec = null;
    S.specImage = null;
    showToast(`No spectrogram for ${c.label}: ${(e as Error).message}`);
  }
  renderAxes();
  drawChart();
}

/* ---------------- panel ---------------- */
function renderFacts() {
  const info = S.info!;
  const dl = $('facts');
  dl.innerHTML = '';
  const rates = [...new Set(info.signals.map((s) => s.sampleRate))].sort((a, b) => b - a).map((r) => `${r} Hz`).join(', ');
  const rows: [string, string][] = [
    ['File', info.fileName],
    ['Format', info.variant],
    ['Size', `${(info.fileBytes / 1048576).toFixed(1)} MB`],
    ['Start', info.start.replace('T', ' ')],
    ['Length', hms(info.duration)],
    ['Signals', `${info.signals.length} at ${rates}`],
    ['Records', `${info.recordCount} of ${info.recordDuration} s`],
    ['Segments', info.segments.length === 1 ? 'continuous' : `${info.segments.length}, with gaps`],
    ['Annotations', annotationFact()],
    ...(S.hyp ? ([['Sleep stages', stageFact(S.hyp, info.duration)]] as [string, string][]) : []),
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  const notes = $('notes');
  notes.innerHTML = '';
  for (const n of [...info.warnings, ...fileNotes, ...info.montages.filter((m) => m.note).map((m) => `${m.name}: ${m.note}`)]) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = n;
    notes.append(p);
  }
}

const SCHEME: Record<Hypnogram['scheme'], string> = { rk: 'R&K stages', aasm: 'AASM stages', mixed: 'R&K and AASM stages', none: 'unrecognised stages' };
/** Counts only the epochs inside the recording: an added hypnogram can cover the whole day around an excerpt. */
function stageFact(h: Hypnogram, duration: number) {
  const inside = h.epochs.filter((e) => e.onset < duration && e.onset + e.duration > 0).length;
  const outside = h.epochs.length - inside;
  return `${inside} scored epochs${outside ? ` (${outside} more outside the recording)` : ''}, ${SCHEME[h.scheme]}`;
}

function annotationFact() {
  const stages = S.annotations.filter((a) => stageOf(a.text) !== null).length;
  const own = S.annotations.filter((a) => a.source === 'recording').length;
  const added = S.annotations.length - own;
  const parts = [`${S.annotations.length} in all`];
  if (stages) parts.push(`${stages} sleep stages`);
  if (added) parts.push(`${added} from added files`);
  return parts.join(', ');
}

function renderAnnotations() {
  const list = $('ann-list');
  list.innerHTML = '';
  const items = S.annotations.filter((a) => S.showStageMarks || stageOf(a.text) === null);
  const stages = S.annotations.filter((a) => stageOf(a.text) !== null).length;
  $('ann-count').textContent = String(S.annotations.length);
  $('ann-stages').closest('label')!.hidden = stages === 0;
  $('ann-stages-label').textContent = `Show the ${stages} sleep stage marks`;
  if (items.length === 0) {
    if (stages === 0) {
      const p = document.createElement('p');
      p.className = 'ann-empty';
      p.textContent = 'This recording has no annotations.';
      list.append(p);
    }
    return;
  }
  for (const a of items.slice(0, 5000)) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.onset = String(a.onset);
    const t = document.createElement('time');
    t.textContent = clockAt(a.onset);
    const tx = document.createElement('span');
    tx.className = 'text';
    tx.textContent = a.text;
    if (a.duration) {
      const d = document.createElement('span');
      d.className = 'dur';
      d.textContent = `${fmtDuration(a.duration)}${a.source !== 'recording' ? `, from ${a.source}` : ''}`;
      tx.append(d);
    }
    b.append(t, tx);
    b.addEventListener('click', () => goTo(a.onset - S.span * 0.1));
    li.append(b);
    list.append(li);
  }
}

function markCurrentAnnotations() {
  $('ann-list')
    .querySelectorAll<HTMLButtonElement>('button[data-onset]')
    .forEach((b) => {
      const o = Number(b.dataset.onset);
      b.setAttribute('aria-current', String(o >= S.start && o < S.start + S.span));
    });
}

/* ---------------- time helpers ---------------- */
function hms(s: number) {
  const sign = s < 0 ? '−' : '';
  s = Math.abs(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = Number.isInteger(sec) ? String(sec).padStart(2, '0') : sec.toFixed(1).padStart(4, '0');
  return `${sign}${h}:${String(m).padStart(2, '0')}:${ss}`;
}

function clockAt(t: number) {
  if (!S.info) return '';
  const d = new Date(S.info.startMs + t * 1000);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toISOString().slice(11, 19);
}

function fmtDuration(s: number) {
  if (s < 60) return `${Number(s.toFixed(2))} s`;
  return `${Math.floor(s / 60)} min${s % 60 ? ` ${Math.round(s % 60)} s` : ''}`;
}

/* ---------------- navigation ---------------- */
function clampStart(t: number) {
  const max = Math.max(0, (S.info?.duration ?? 0) - S.span);
  return Math.min(max, Math.max(0, t));
}

function goTo(t: number) {
  S.start = clampStart(t);
  drawChart();
  requestWindow();
}

/** With the 30 s epoch grid, whole-page moves and jumps land on scoring epochs; fine scrolling does not snap. */
function snapped(t: number) {
  return S.grid === 30 && S.span % 30 === 0 ? Math.round(t / 30) * 30 : t;
}

function page(dir: number, fraction = 1) {
  const t = S.start + dir * S.span * fraction;
  goTo(fraction === 1 ? snapped(t) : t);
}

/* ---------------- toasts and busy ---------------- */
interface Action {
  label: string;
  run: () => void;
}

let toastTimer = 0;
/** A short message over the traces. With an action it stays until the action or Dismiss is pressed. */
function showToast(msg: string, action?: Action) {
  const el = $('busy');
  el.textContent = msg;
  el.hidden = false;
  el.classList.toggle('with-action', !!action);
  clearTimeout(toastTimer);
  if (action) {
    el.append(actionButton(action, () => (el.hidden = true)), actionButton({ label: 'Dismiss', run: () => {} }, () => (el.hidden = true)));
  } else {
    toastTimer = window.setTimeout(() => (el.hidden = true), 5000);
  }
}

function actionButton(a: Action, close: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = a.label;
  b.addEventListener('click', () => {
    close();
    a.run();
  });
  return b;
}

function setBusy(on: boolean) {
  const el = $('busy');
  if (on) {
    el.textContent = 'Reading';
    el.classList.remove('with-action');
    el.hidden = false;
  } else if (el.textContent === 'Reading') {
    el.hidden = true;
  }
  document.body.toggleAttribute('aria-busy', on);
}

function showError(msg: string | null, action?: Action) {
  const el = $('start-error');
  el.hidden = !msg;
  el.textContent = msg ?? '';
  if (msg && action) el.append(' ', actionButton(action, () => showError(null)));
}

/* ---------------- menu ---------------- */
const samplesBtn = $('samples-btn');
const menuList = document.querySelector<HTMLElement>('#samples-menu .menu-list')!;
function closeMenu() {
  menuList.hidden = true;
  samplesBtn.setAttribute('aria-expanded', 'false');
}
samplesBtn.addEventListener('click', () => {
  const open = menuList.hidden;
  menuList.hidden = !open;
  samplesBtn.setAttribute('aria-expanded', String(open));
  if (open) menuList.querySelector<HTMLButtonElement>('button')?.focus();
});
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('#samples-menu')) closeMenu();
});
menuList.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu();
    samplesBtn.focus();
  }
});
document.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach((b) => b.addEventListener('click', () => openSample(b.dataset.sample!)));

/* ---------------- controls ---------------- */
$('controls').addEventListener('submit', (e) => e.preventDefault());
$('file-input').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  openFiles([...(input.files ?? [])]);
  input.value = '';
});
for (const id of ['hp', 'lp', 'notch'])
  $(id).addEventListener('change', () => {
    S.filtersTouched = true;
    applyFilters();
  });
$('montage').addEventListener('change', applyMontage);
$('span').addEventListener('change', () => {
  const center = S.start + S.span / 2;
  S.span = Math.min(Number($<HTMLSelectElement>('span').value), S.info?.duration ?? 600);
  S.start = clampStart(center - S.span / 2);
  S.rescale = true;
  requestWindow();
  drawChart();
});
$('grid').addEventListener('change', () => {
  S.grid = Number($<HTMLSelectElement>('grid').value);
  draw();
});
const setGain = (g: number) => {
  S.gain = Math.min(64, Math.max(1 / 16, g));
  draw();
};
$('gain-up').addEventListener('click', () => setGain(S.gain * 1.5));
$('gain-down').addEventListener('click', () => setGain(S.gain / 1.5));
$('prev').addEventListener('click', () => page(-1));
$('next').addEventListener('click', () => page(1));
$('spec-channel').addEventListener('change', loadSpectrogram);
$('ann-stages').addEventListener('change', (e) => {
  S.showStageMarks = (e.target as HTMLInputElement).checked;
  renderAnnotations();
  draw();
});
$('settings-toggle').addEventListener('click', () => {
  const c = $('controls');
  const open = !c.classList.contains('open');
  c.classList.toggle('open', open);
  $('settings-toggle').setAttribute('aria-expanded', String(open));
  requestAnimationFrame(onResize);
});

const viewer = $('viewer');
function setPanel(open: boolean) {
  viewer.classList.toggle('panel-hidden', !open);
  $('panel-open').setAttribute('aria-pressed', String(open));
  requestAnimationFrame(onResize);
}
$('panel-close').addEventListener('click', () => setPanel(false));
$('panel-open').addEventListener('click', () => setPanel(viewer.classList.contains('panel-hidden')));
if (window.matchMedia('(max-width: 760px)').matches) setPanel(false);

for (const [tab, pane] of [['tab-ann', 'pane-ann'], ['tab-file', 'pane-file']] as const) {
  $(tab).addEventListener('click', () => {
    for (const [t2, p2] of [['tab-ann', 'pane-ann'], ['tab-file', 'pane-file']]) {
      $(t2).setAttribute('aria-selected', String(t2 === tab));
      $(p2).hidden = p2 !== pane;
    }
  });
}

/* ---------------- pointer and keys on the traces ---------------- */
let drag: { x: number; start: number } | null = null;
tracesWrap.addEventListener('pointerdown', (e) => {
  if (!S.info || e.button !== 0 || (e.target as HTMLElement).closest('#busy')) return;
  drag = { x: e.clientX, start: S.start };
  tracesWrap.setPointerCapture(e.pointerId);
  tracesWrap.classList.add('dragging');
});
tracesWrap.addEventListener('pointermove', (e) => {
  const r = tracesWrap.getBoundingClientRect();
  S.cursorX = e.clientX - r.left;
  if (drag) {
    const dt = ((drag.x - e.clientX) / r.width) * S.span;
    S.start = clampStart(drag.start + dt);
    requestWindow();
    drawChart();
  }
  draw();
});
tracesWrap.addEventListener('pointerup', () => {
  drag = null;
  tracesWrap.classList.remove('dragging');
});
tracesWrap.addEventListener('pointerleave', () => {
  if (drag) return;
  S.cursorX = null;
  draw();
});
tracesWrap.addEventListener(
  'wheel',
  (e) => {
    if (!S.info) return;
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
    const canScrollRows = tracesWrap.scrollHeight > tracesWrap.clientHeight + 1;
    if (!horizontal && canScrollRows) return;
    e.preventDefault();
    const d = horizontal ? e.deltaX || e.deltaY : e.deltaY;
    goTo(S.start + (d / tracesWrap.clientWidth) * S.span);
  },
  { passive: false },
);
tracesWrap.addEventListener('scroll', syncLabelScroll);

document.addEventListener('keydown', (e) => {
  if (!S.info) return;
  const t = e.target as HTMLElement;
  if (t.matches('input, select, textarea') || t.closest('[role="menu"]')) return;
  const step = e.shiftKey ? 0.2 : 1;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') {
    page(1, step);
    e.preventDefault();
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    page(-1, step);
    e.preventDefault();
  } else if (e.key === 'Home') {
    goTo(0);
  } else if (e.key === 'End') {
    goTo(S.info.duration);
  // Printable-character keys act only when the view they change has focus (WCAG 2.1.4): the
  // pointer gain buttons work everywhere, so a focused button or field is never surprised.
  } else if ((e.key === '+' || e.key === '=') && t.closest('#traces-wrap')) {
    setGain(S.gain * 1.5);
  } else if ((e.key === '-' || e.key === '_') && t.closest('#traces-wrap')) {
    setGain(S.gain / 1.5);
  }
});

/* ---------------- the depth profile is the navigator ---------------- */
function depthToTime(clientX: number) {
  const r = depthCanvas.getBoundingClientRect();
  return ((clientX - r.left) / r.width) * (S.info?.duration ?? 0);
}
let depthDrag: { offset: number } | null = null;
depthCanvas.addEventListener('pointerdown', (e) => {
  if (!S.info) return;
  const t = depthToTime(e.clientX);
  const inside = t >= S.start && t <= S.start + S.span;
  depthDrag = { offset: inside ? t - S.start : S.span / 2 };
  depthCanvas.setPointerCapture(e.pointerId);
  goTo(snapped(t - depthDrag.offset));
});
depthCanvas.addEventListener('pointermove', (e) => {
  if (depthDrag) goTo(snapped(depthToTime(e.clientX) - depthDrag.offset));
});
depthCanvas.addEventListener('pointerup', () => (depthDrag = null));
depthCanvas.addEventListener('keydown', (e) => {
  if (!S.info) return;
  const big = S.info.duration / 20;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') goTo(S.start + S.span);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') goTo(S.start - S.span);
  else if (e.key === 'PageDown') goTo(S.start + big);
  else if (e.key === 'PageUp') goTo(S.start - big);
  else return;
  e.preventDefault();
  e.stopPropagation();
});

/* ---------------- drag and drop ---------------- */
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  $('drop').hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $('drop').hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').hidden = true;
  openFiles([...(e.dataTransfer?.files ?? [])]);
});

/* ---------------- resize ---------------- */
let lastWidth = 0;
function onResize() {
  if (!S.info) return;
  layout();
  renderAxes();
  const w = tracesWrap.clientWidth;
  if (Math.abs(w - lastWidth) > 8) {
    lastWidth = w;
    requestWindow();
  }
}
new ResizeObserver(() => requestAnimationFrame(onResize)).observe(document.body);
document.fonts?.ready.then(() => {
  P = readPalette();
  if (S.info) draw();
});

// Test hook: lets the browser test read the view state without scraping pixels.
(window as unknown as { __leadline: unknown }).__leadline = {
  state: S,
  eeg,
  draw,
  whenIdle,
  openSample,
  goTo,
  get ready() {
    return !!S.win && served === wanted && !inflight && opening === 0;
  },
};
