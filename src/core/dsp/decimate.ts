/**
 * Min/max decimation for drawing: each pixel column keeps the lowest and highest sample in its time span, so
 * spikes narrower than a pixel stay visible. NaN samples (gaps) are skipped; a column with no samples is NaN.
 */
export interface Decimated {
  /** 'minmax': data holds [min0, max0, min1, max1, ...] for `columns` columns. 'raw': data holds samples. */
  mode: 'minmax' | 'raw';
  columns: number;
  data: Float32Array;
  /** Time of data[0] for 'raw', of column 0's left edge for 'minmax'. */
  t0: number;
  /** Seconds per sample ('raw') or per column ('minmax'). */
  dt: number;
}

export function decimateMinMax(
  x: ArrayLike<number>,
  xT0: number,
  fs: number,
  viewStart: number,
  viewDuration: number,
  columns: number,
): Decimated {
  const first = Math.max(0, Math.floor((viewStart - xT0) * fs));
  const last = Math.min(x.length, Math.ceil((viewStart + viewDuration - xT0) * fs) + 1);
  const count = Math.max(0, last - first);
  if (count <= 2 * columns) {
    const data = new Float32Array(count);
    for (let i = 0; i < count; i++) data[i] = x[first + i];
    return { mode: 'raw', columns, data, t0: xT0 + first / fs, dt: 1 / fs };
  }
  const data = new Float32Array(columns * 2).fill(Number.NaN);
  const dt = viewDuration / columns;
  for (let c = 0; c < columns; c++) {
    const a = Math.max(first, Math.floor((viewStart + c * dt - xT0) * fs));
    const b = Math.min(last, Math.floor((viewStart + (c + 1) * dt - xT0) * fs) + 1);
    let mn = Number.POSITIVE_INFINITY;
    let mx = Number.NEGATIVE_INFINITY;
    for (let i = a; i < b; i++) {
      const v = x[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn <= mx) {
      data[2 * c] = mn;
      data[2 * c + 1] = mx;
    }
  }
  return { mode: 'minmax', columns, data, t0: viewStart, dt };
}
