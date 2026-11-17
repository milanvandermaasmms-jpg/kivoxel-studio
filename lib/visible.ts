/** Polls only while Milan looks at the Studio: a hidden tab (another tab, minimised window) asks nothing. */
export const pageVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * One poll at a time (17-11-2026): when the database answers slower than the poll interval, the next round is skipped
 * instead of piling up requests that make a slow database even slower. Only for timers; a click still asks at once.
 */
export function pollOnce(busy: { current: boolean }, run: () => Promise<unknown>): void {
  if (busy.current || !pageVisible()) return;
  busy.current = true;
  void run()
    .catch(() => undefined)
    .finally(() => {
      busy.current = false;
    });
}
