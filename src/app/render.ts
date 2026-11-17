/** Canvas drawing for the trace view, the depth profile (hypnogram) and the spectrogram. No state lives here. */
import type { AnnotationItem, ChannelWindow, Hypnogram, SpectrogramTile, Stage } from '../core/index';

export interface Palette {
  water: string;
  land: string;
  land2: string;
  landRule: string;
  ink: string;
  ink2: string;
  ink3: string;
  grid: string;
  gridStrong: string;
  depth: string[];
  mark: string;
  markSoft: string;
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  return {
    water: v('--water'),
    land: v('--land'),
    land2: v('--land-2'),
    landRule: v('--land-rule'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    grid: v('--grid'),
    gridStrong: v('--grid-strong'),
    depth: [1, 2, 3, 4, 5, 6].map((i) => v(`--depth-${i}`)),
    mark: v('--mark'),
    markSoft: v('--mark-soft'),
  };
}

/** Sizes the backing store for the device pixel ratio. `setStyle` false leaves layout to CSS (the chart rows). */
export function sizeCanvas(c: HTMLCanvasElement, cssW: number, cssH: number, setStyle = true): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
    if (setStyle) {
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
    }
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export interface TraceLayout {
  width: number;
  rowH: number;
  rows: number;
  /** Rows that start a new bipolar chain get extra space above. */
  groupStarts: Set<number>;
}

export interface TraceScene {
  start: number;
  duration: number;
  channels: ChannelWindow[];
  /** Units per half row for each channel, before gain. */
  scales: number[];
  /** Display offset subtracted from each channel (window median). */
  offsets: number[];
  gain: number;
  /** Channels clipped to their own row (slow, non-EEG signals). */
  tight?: boolean[];
  grid: number;
  annotations: AnnotationItem[];
  cursorX: number | null;
  /** Wall-clock start of the recording, ms, to label the grid. */
  startMs: number;
}

export function drawTraces(ctx: CanvasRenderingContext2D, L: TraceLayout, S: TraceScene, P: Palette): void {
  const H = L.rows * L.rowH;
  ctx.clearRect(0, 0, L.width, H);
  ctx.fillStyle = P.water;
  ctx.fillRect(0, 0, L.width, H);
  const xOf = (t: number) => ((t - S.start) / S.duration) * L.width;

  // Annotation spans first, under everything.
  for (const a of S.annotations) {
    if (a.duration && a.duration > 0) {
      const x0 = Math.max(0, xOf(a.onset));
      const x1 = Math.min(L.width, xOf(a.onset + a.duration));
      if (x1 > x0) {
        ctx.fillStyle = P.markSoft;
        ctx.fillRect(x0, 0, x1 - x0, 20);
      }
    }
  }

  // Time grid: the visible armature.
  if (S.grid > 0) {
    const pxPerS = L.width / S.duration;
    let step = S.grid;
    if (S.grid === 1) step = [1, 2, 5, 10, 15, 30, 60].find((s) => s * pxPerS >= 12) ?? 60;
    if (S.grid === 30) {
      const minor = [5, 10, 15].find((s) => s * pxPerS >= 12);
      if (minor) {
        ctx.strokeStyle = P.grid;
        for (let t = Math.ceil(S.start / minor) * minor; t <= S.start + S.duration + 1e-9; t += minor) {
          const x = Math.round(xOf(t)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
      }
    }
    const first = Math.ceil(S.start / step) * step;
    for (let t = first; t <= S.start + S.duration + 1e-9; t += step) {
      const x = Math.round(xOf(t)) + 0.5;
      const strong = Math.abs(t / (step * 5) - Math.round(t / (step * 5))) < 1e-9 || S.grid === 30;
      ctx.strokeStyle = strong ? P.gridStrong : P.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
  }

  // Row baselines and chain separators.
  for (let r = 0; r < L.rows; r++) {
    if (L.groupStarts.has(r) && r > 0) {
      ctx.strokeStyle = P.gridStrong;
      ctx.beginPath();
      ctx.moveTo(0, r * L.rowH + 0.5);
      ctx.lineTo(L.width, r * L.rowH + 0.5);
      ctx.stroke();
    }
  }

  // Traces.
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = P.ink;
  S.channels.forEach((c, r) => {
    const mid = r * L.rowH + L.rowH / 2;
    const half = L.rowH / 2;
    const k = (half / (S.scales[r] || 1)) * S.gain;
    const off = S.offsets[r] ?? 0;
    // EEG convention: negative up. Non-voltage channels draw positive up.
    const sign = /V$/i.test(c.unit.trim()) ? 1 : -1;
    const y = (v: number) => mid + sign * (v - off) * k;
    ctx.save();
    ctx.beginPath();
    const reach = S.tight?.[r] ? 1 : 1.6;
    ctx.rect(0, mid - half * reach, L.width, half * reach * 2);
    ctx.clip();
    ctx.beginPath();
    if (c.mode === 'minmax') {
      const colW = (c.dt / S.duration) * L.width;
      let prevLo = Number.NaN;
      let prevHi = Number.NaN;
      for (let i = 0; i < c.columns; i++) {
        const mn = c.data[2 * i];
        const mx = c.data[2 * i + 1];
        if (Number.isNaN(mn)) {
          prevLo = prevHi = Number.NaN;
          continue;
        }
        let lo = mn;
        let hi = mx;
        if (!Number.isNaN(prevLo)) {
          lo = Math.min(lo, prevHi);
          hi = Math.max(hi, prevLo);
        }
        const x = (i + 0.5) * colW;
        const ya = y(lo);
        const yb = y(hi);
        ctx.moveTo(x, ya);
        ctx.lineTo(x, Math.abs(yb - ya) < 0.75 ? ya + (yb >= ya ? 0.75 : -0.75) : yb);
        prevLo = mn;
        prevHi = mx;
      }
    } else {
      let pen = false;
      for (let i = 0; i < c.data.length; i++) {
        const v = c.data[i];
        if (Number.isNaN(v)) {
          pen = false;
          continue;
        }
        const x = xOf(c.t0 + i * c.dt);
        if (pen) ctx.lineTo(x, y(v));
        else ctx.moveTo(x, y(v));
        pen = true;
      }
    }
    ctx.stroke();
    ctx.restore();
  });

  // Annotation onsets on top: magenta hairline and its sloped label.
  ctx.font = `italic 500 12px Sounding, 'Arial Narrow', sans-serif`;
  ctx.textBaseline = 'top';
  let lastLabelEnd = -Infinity;
  for (const a of S.annotations) {
    const x = Math.round(xOf(a.onset)) + 0.5;
    if (x < 0 || x > L.width) continue;
    ctx.strokeStyle = P.mark;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (x > lastLabelEnd + 6) {
      const w = ctx.measureText(a.text).width;
      ctx.fillStyle = 'rgba(252,253,251,0.92)';
      ctx.fillRect(x + 2, 2, w + 8, 16);
      ctx.fillStyle = P.mark;
      ctx.fillText(a.text, x + 5, 4);
      lastLabelEnd = x + w + 10;
    }
  }

  if (S.cursorX !== null) {
    const x = Math.round(S.cursorX) + 0.5;
    ctx.strokeStyle = P.ink2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Depth of each stage: the surface is wake, the deepest water stage 4. */
export const STAGE_DEPTH: Partial<Record<Stage, number>> = { W: 0, R: 1, N1: 2, N2: 3, N3: 4, N4: 5, N: 3 };
/** Axis labels in the file's own scoring scheme: R&K stages 1 to 4, or AASM N1 to N3. */
export function depthLabels(hyp: Hypnogram | null): string[] {
  return hyp?.scheme === 'aasm' ? ['W', 'R', 'N1', 'N2', 'N3'] : ['W', 'R', 'S1', 'S2', 'S3', 'S4'];
}

export function drawDepth(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  duration: number,
  hyp: Hypnogram | null,
  marks: AnnotationItem[],
  view: { start: number; duration: number },
  P: Palette,
): void {
  ctx.clearRect(0, 0, W, H);
  const xOf = (t: number) => (t / duration) * W;
  const levels = depthLabels(hyp).length;
  const bandH = H / levels;
  ctx.fillStyle = P.land;
  ctx.fillRect(0, 0, W, H);
  const epochs = hyp?.epochs ?? [];
  if (epochs.length > 0) {
    // Water column from the surface down to the stage depth, tinted by depth zone, land below the profile.
    for (const e of epochs) {
      const x0 = Math.max(0, xOf(e.onset));
      const x1 = Math.min(W, xOf(e.onset + e.duration));
      if (x1 <= x0) continue;
      const d = STAGE_DEPTH[e.stage];
      if (d === undefined) {
        // Unscored or movement time: a flat pale fill, no depth claimed.
        ctx.fillStyle = P.land2;
        ctx.fillRect(x0, 0, x1 - x0, H);
        continue;
      }
      for (let k = 0; k <= d; k++) {
        ctx.fillStyle = P.depth[Math.min(P.depth.length - 1, k)];
        ctx.fillRect(x0, k * bandH, x1 - x0 + 0.5, bandH + 0.5);
      }
    }
    // Depth contours where water is deeper than the line.
    ctx.lineWidth = 0.5;
    for (let k = 1; k < levels; k++) {
      ctx.strokeStyle = 'rgba(24,34,46,0.16)';
      ctx.beginPath();
      for (const e of epochs) {
        const d = STAGE_DEPTH[e.stage];
        if (d === undefined || d < k) continue;
        const x0 = Math.max(0, xOf(e.onset));
        const x1 = Math.min(W, xOf(e.onset + e.duration));
        if (x1 <= x0) continue;
        ctx.moveTo(x0, k * bandH);
        ctx.lineTo(x1, k * bandH);
      }
      ctx.stroke();
    }
    // The profile line, stepped, heavier through REM.
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let pen = false;
    let lastY = 0;
    for (const e of epochs) {
      const d = STAGE_DEPTH[e.stage];
      const x0 = Math.max(0, xOf(e.onset));
      const x1 = Math.min(W, xOf(e.onset + e.duration));
      if (x1 <= x0) continue;
      if (d === undefined) {
        pen = false;
        continue;
      }
      const y = (d + 1) * bandH - 0.75;
      if (pen) ctx.lineTo(x0, lastY);
      if (pen) ctx.lineTo(x0, y);
      else ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      lastY = y;
      pen = true;
    }
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const e of epochs) {
      if (e.stage !== 'R') continue;
      const x0 = Math.max(0, xOf(e.onset));
      const x1 = Math.min(W, xOf(e.onset + e.duration));
      if (x1 <= x0) continue;
      const y = 2 * bandH - 1.5;
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
  }
  // Marks from the file. Without stages the row is an annotation lane: spans as bands, onsets as ticks.
  if (epochs.length === 0) {
    ctx.fillStyle = P.water;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = P.markSoft;
    for (const a of marks) {
      if (!a.duration || a.duration <= 0) continue;
      const x0 = xOf(a.onset);
      ctx.fillRect(x0, 4, Math.max(1, xOf(a.onset + a.duration) - x0 - 1), H - 8);
    }
  }
  ctx.strokeStyle = P.mark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const a of marks) {
    const x = Math.round(xOf(a.onset)) + 0.5;
    if (epochs.length === 0) {
      ctx.moveTo(x, 4);
      ctx.lineTo(x, H - 4);
    } else {
      ctx.moveTo(x, H - 7);
      ctx.lineTo(x, H);
    }
  }
  ctx.stroke();
  drawBracket(ctx, xOf(view.start), xOf(view.start + view.duration), H, P);
}

/** The draggable viewport bracket: at least 8 px wide, translucent water fill, end caps above and below. */
export function drawBracket(ctx: CanvasRenderingContext2D, x0: number, x1: number, H: number, P: Palette): void {
  const w = Math.max(8, x1 - x0);
  const bx = Math.min(Math.max(0, (x0 + x1) / 2 - w / 2), Math.max(0, ctx.canvas.clientWidth - w));
  ctx.fillStyle = 'rgba(252,253,251,0.45)';
  ctx.fillRect(bx, 0, w, H);
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx + 0.75, 0.75, w - 1.5, H - 1.5);
  ctx.fillStyle = P.ink;
  ctx.fillRect(bx, 0, w, 3);
  ctx.fillRect(bx, H - 3, w, 3);
}

/** Sequential ramp from open water to deep navy, for power. */
function ramp(P: Palette): [number, number, number][] {
  const stops = [P.water, P.depth[0], P.depth[1], P.depth[2], P.depth[3], P.depth[4], P.depth[5], '#0d2238'];
  const rgb = stops.map((h) => {
    const n = Number.parseInt(h.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number];
  });
  const out: [number, number, number][] = [];
  for (let i = 0; i < 256; i++) {
    const p = (i / 255) * (rgb.length - 1);
    const a = Math.floor(p);
    const b = Math.min(rgb.length - 1, a + 1);
    const f = p - a;
    out.push([0, 1, 2].map((j) => Math.round(rgb[a][j] + (rgb[b][j] - rgb[a][j]) * f)) as [number, number, number]);
  }
  return out;
}

/** Log frequency axis of the spectrogram strip: delta and theta get as much room as beta. */
export function specAxis(tile: SpectrogramTile) {
  const lo = Math.max(0.5, tile.freqs[1] ?? 0.5);
  const hi = tile.freqs[tile.nfreq - 1] ?? 1;
  return { lo, hi, frac: (f: number) => Math.log(f / lo) / Math.log(hi / lo) };
}

const SPEC_ROWS = 120;

/**
 * Spectrogram as an image on a log frequency axis. Power is shown relative to the median at each frequency over
 * the whole range shown, so changes across the recording stand out over the steep 1/f slope of EEG.
 */
export function spectrogramImage(tile: SpectrogramTile, P: Palette): { canvas: HTMLCanvasElement; lo: number; hi: number } {
  const { lo: fLo, hi: fHi } = specAxis(tile);
  const rows = SPEC_ROWS;
  // Bin range feeding each output row.
  const df = tile.freqs[1] - tile.freqs[0] || 1;
  const ranges: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    const fa = fLo * Math.pow(fHi / fLo, (r - 0.5) / (rows - 1));
    const fb = fLo * Math.pow(fHi / fLo, (r + 0.5) / (rows - 1));
    let a = Math.max(1, Math.round(fa / df));
    let b = Math.min(tile.nfreq - 1, Math.round(fb / df));
    if (b < a) b = a = Math.min(tile.nfreq - 1, Math.max(1, Math.round(((fa + fb) / 2) / df)));
    ranges.push([a, b]);
  }
  const val = new Float32Array(tile.ntime * rows);
  for (let t = 0; t < tile.ntime; t++) {
    for (let r = 0; r < rows; r++) {
      const [a, b] = ranges[r];
      let sum = 0;
      for (let f = a; f <= b; f++) sum += tile.db[t * tile.nfreq + f];
      val[t * rows + r] = sum / (b - a + 1);
    }
  }
  for (let r = 0; r < rows; r++) {
    const col: number[] = [];
    for (let t = 0; t < tile.ntime; t++) if (Number.isFinite(val[t * rows + r])) col.push(val[t * rows + r]);
    col.sort((x, y) => x - y);
    const med = col.length ? col[Math.floor(col.length / 2)] : 0;
    for (let t = 0; t < tile.ntime; t++) val[t * rows + r] -= med;
  }
  const vals = Array.from(val).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.02)] ?? 0;
  const hi = vals[Math.floor(vals.length * 0.995)] ?? 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, tile.ntime);
  c.height = rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  const lut = ramp(P);
  for (let t = 0; t < tile.ntime; t++) {
    for (let r = 0; r < rows; r++) {
      const v = val[t * rows + r];
      const o = ((rows - 1 - r) * c.width + t) * 4;
      if (!Number.isFinite(v)) continue;
      const k = Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo || 1)) * 255)));
      img.data[o] = lut[k][0];
      img.data[o + 1] = lut[k][1];
      img.data[o + 2] = lut[k][2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, lo, hi };
}

export function drawSpectrogram(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  duration: number,
  tile: SpectrogramTile | null,
  image: HTMLCanvasElement | null,
  view: { start: number; duration: number },
  P: Palette,
): void {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = P.water;
  ctx.fillRect(0, 0, W, H);
  if (tile && image && tile.ntime > 0 && W >= 1 && H >= 1 && image.width > 0) ctx.drawImage(fitted(tile, image, W, H, duration), 0, 0, W, H);
  drawBracket(ctx, (view.start / duration) * W, ((view.start + view.duration) / duration) * W, H, P);
}

let fitCache: { image: HTMLCanvasElement; W: number; H: number; out: HTMLCanvasElement } | null = null;
/** The spectrogram resampled once to the strip's size, so panning only blits it. */
function fitted(tile: SpectrogramTile, image: HTMLCanvasElement, W: number, H: number, duration: number): HTMLCanvasElement {
  if (fitCache && fitCache.image === image && fitCache.W === W && fitCache.H === H) return fitCache.out;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const out = document.createElement('canvas');
  out.width = Math.round(W * dpr);
  out.height = Math.round(H * dpr);
  const c = out.getContext('2d')!;
  c.scale(dpr, dpr);
  const t0 = tile.times[0];
  const t1 = tile.times[tile.ntime - 1];
  const step = tile.ntime > 1 ? (t1 - t0) / (tile.ntime - 1) : duration;
  const x0 = ((t0 - step / 2) / duration) * W;
  const x1 = ((t1 + step / 2) / duration) * W;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(image, x0, 0, x1 - x0, H);
  fitCache = { image, W, H, out };
  return out;
}
