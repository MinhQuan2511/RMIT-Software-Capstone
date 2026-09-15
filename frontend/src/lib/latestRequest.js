/**
 * Guards against late responses: only the most recently started request may
 * apply its result. Starting a new request (or invalidating) makes every older
 * token stale, so a slow response for job A cannot overwrite job B.
 */
export function createLatestRequestTracker() {
  let seq = 0;
  return {
    begin() {
      seq += 1;
      const id = seq;
      return { id, isCurrent: () => id === seq };
    },
    invalidate() {
      seq += 1;
    },
  };
}
