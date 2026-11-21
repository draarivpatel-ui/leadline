// Timeline tick spacing for the bottom axis. Pure so the edge cases are
// testable without the DOM.

export const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/** Seconds between ticks for a duration and a wanted label count. The step
 *  also scales with the duration itself, so a file that claims an absurd
 *  span still draws a bounded number of ticks instead of hanging. */
export function chooseTickStep(duration: number, want: number): number {
  const step = TICK_STEPS.find((s) => duration / s <= want) ?? 7200;
  return Math.max(step, duration / 600);
}
