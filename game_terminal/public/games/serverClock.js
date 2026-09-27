// Tracks the offset between this browser's clock and the server's, so countdowns and
// server-timestamped animations (hazards, round timers) line up for everyone even when a
// player's system clock is off. Each sample is serverNow - localNow at receipt, which
// undershoots the true offset by the one-way latency — so the largest sample seen is the
// best estimate.
export function makeServerClock() {
  let offset = null;
  return {
    sync(serverNow) {
      if (typeof serverNow !== 'number') return;
      const sample = serverNow - Date.now();
      if (offset === null || sample > offset) offset = sample;
    },
    now() {
      return Date.now() + (offset || 0);
    },
  };
}
