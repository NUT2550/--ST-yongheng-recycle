/**
 * ST-75 P2-A: Bounded delayed reconciliation for authoritative refresh after
 * ambiguous transport outcomes (429/5xx after apply dispatch, network error).
 *
 * Problem this solves:
 *   When the backend returns 429/5xx (or the network drops) AFTER /api/import/apply
 *   was dispatched, the backend MAY still be committing per-bill transactions.
 *   A single immediate `onRefreshAfterImport()` call can therefore execute BEFORE
 *   the commit completes — the UI sees stale state and stays stale even though
 *   bills were actually saved.
 *
 * Design:
 *   - Fires the immediate refresh (preserves current behavior — gives a chance
 *     to catch already-committed state if the commit was fast).
 *   - Schedules a BOUNDED number of delayed retries (default: 2) at increasing
 *     delays (default: 1500ms, 4000ms). Each retry is a GET/read refresh — it
 *     does NOT re-issue the POST /api/import/apply mutation.
 *   - Returns a `cancel()` function so callers can clean up on unmount or
 *     dialog reset. Pending timers are cleared to prevent stale-closure leaks.
 *
 * Invariants:
 *   - NEVER retries the POST /api/import/apply mutation.
 *   - Bounded: `maxRetries` cap prevents infinite polling.
 *   - Idempotent: each refresh call is the same GET/read; duplicate side effects
 *     are the parent's responsibility (typical implementations just setState
 *     from fetched data, which is safe to call multiple times).
 *   - No stale closures: the callback is captured at schedule time; if the
 *     dialog unmounts, `cancel()` clears timers.
 */

export interface ScheduleAmbiguousRefreshOptions {
  /**
   * Maximum number of delayed retries after the immediate refresh.
   * Default: 2. Bounded — never infinite.
   */
  maxRetries?: number;
  /**
   * Delay in ms before each delayed retry. If a single number is provided,
   * the same delay is used for all retries. If an array is provided, each
   * element is the delay before that retry (index 0 = first retry).
   * Default: [1500, 4000] (1.5s, then 4s).
   */
  delaysMs?: number[] | number;
  /**
   * Optional injected timer scheduler (for test determinism).
   * Default: setTimeout.
   */
  scheduleTimer?: (fn: () => void, delay: number) => number;
  /**
   * Optional injected timer clearer (for test determinism).
   * Default: clearTimeout.
   */
  clearTimer?: (id: number) => void;
}

export interface ScheduledRefreshHandle {
  /** Cancel all pending delayed retries. Safe to call multiple times. */
  cancel: () => void;
}

/**
 * ST-75 P2-A: Schedule a bounded delayed reconciliation refresh.
 *
 * Immediately invokes `refresh` (gives a chance to catch already-committed
 * state), then schedules up to `maxRetries` delayed retries at increasing
 * intervals. Each retry calls the same `refresh` callback — this is a
 * GET/read refresh, NOT a POST /api/import/apply retry.
 *
 * @param refresh - The authoritative server-backed refresh callback (e.g.,
 *   `() => loadProducts()` or `() => loadData()`). Must be idempotent.
 * @param opts - Optional configuration for retry count, delays, and timer
 *   injection (for tests).
 * @returns A handle with a `cancel()` method. Callers MUST cancel on unmount
 *   or dialog reset to prevent stale-closure leaks.
 */
export function scheduleAmbiguousRefresh(
  refresh: () => void | Promise<void>,
  opts: ScheduleAmbiguousRefreshOptions = {},
): ScheduledRefreshHandle {
  const maxRetries = opts.maxRetries ?? 2;
  const delaysRaw = opts.delaysMs ?? [1500, 4000];
  const delays: number[] = Array.isArray(delaysRaw)
    ? delaysRaw
    : Array.from({ length: maxRetries }, () => delaysRaw);
  const scheduleTimer = opts.scheduleTimer ?? setTimeout;
  const clearTimer = opts.clearTimer ?? clearTimeout;

  const pendingTimers = new Set<number>();
  let cancelled = false;
  // ST-75 P2-A3: Serialize refresh attempts so a slow immediate fetch cannot
  // be overwritten by a faster delayed retry returning stale pre-commit state.
  // ST-75 P2-1: Chain queued retries to the active refresh promise. When a
  // retry timer fires while a refresh is active, the retry must wait for the
  // active promise to settle, then execute. The prior implementation called
  // runRefresh() again immediately (which returned false because
  // refreshInFlight was still true), effectively discarding the queued retry.
  let activeRefreshPromise: Promise<void> | null = null;
  let hasQueuedRefresh = false;

  const runRefresh = (): Promise<void> => {
    // If a refresh is already in flight, mark that a queued refresh is pending.
    // The active refresh's .finally() will drain the queue after it settles.
    if (activeRefreshPromise !== null) {
      hasQueuedRefresh = true;
      return activeRefreshPromise;
    }
    activeRefreshPromise = (async () => {
      try {
        await refresh();
      } catch {
        // Swallow — bounded, so failures don't propagate.
      } finally {
        // ST-75 P2-1: Drain the queued refresh after the active one settles.
        // Only ONE queued refresh runs (bounded — no infinite chain).
        const shouldRunQueued = hasQueuedRefresh;
        hasQueuedRefresh = false;
        activeRefreshPromise = null; // clear BEFORE running queued so it can set again
        if (shouldRunQueued && !cancelled) {
          // Chain the queued refresh to the current settlement.
          void runRefresh();
        }
      }
    })();
    return activeRefreshPromise;
  };

  // Fire the immediate refresh — gives a chance to catch already-committed
  // state if the backend commit was fast.
  void runRefresh();

  // Schedule bounded delayed retries.
  for (let i = 0; i < maxRetries; i++) {
    const delay = delays[i] ?? delays[delays.length - 1] ?? 4000;
    const id = scheduleTimer(() => {
      if (cancelled) return;
      pendingTimers.delete(id);
      // ST-75 P2-1: Call runRefresh() — it will either start immediately (if
      // no refresh is active) or queue itself to run after the active refresh
      // settles. The chaining logic in runRefresh handles this correctly.
      void runRefresh();
    }, delay);
    pendingTimers.add(id);
  }

  return {
    cancel: () => {
      cancelled = true;
      for (const id of pendingTimers) {
        clearTimer(id);
      }
      pendingTimers.clear();
    },
  };
}
