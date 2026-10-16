// -----------------------------------------------------------------------------
// Fake timers: nothing fires by itself, the test runs what it wants.
// -----------------------------------------------------------------------------

export function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  const add = (kind, fn, ms) => {
    const id = nextId++;
    pending.set(id, { id, kind, fn, ms });
    return id;
  };
  return {
    pending,
    setTimeout: (fn, ms) => add('timeout', fn, ms),
    setInterval: (fn, ms) => add('interval', fn, ms),
    clearTimeout: (id) => pending.delete(id),
    clearInterval: (id) => pending.delete(id),
    timeouts: () => [...pending.values()].filter((t) => t.kind === 'timeout'),
    intervals: () => [...pending.values()].filter((t) => t.kind === 'interval'),
    /** Run (and remove) the pending timeouts matching `filter`, once. */
    async runTimeouts(filter = () => true) {
      for (const t of [...pending.values()].filter((t) => t.kind === 'timeout' && filter(t))) {
        pending.delete(t.id);
        await t.fn();
      }
    },
    /** Run the pending intervals of a given period once (they stay scheduled). */
    async runIntervals(ms) {
      for (const t of [...pending.values()].filter((t) => t.kind === 'interval' && t.ms === ms)) {
        await t.fn();
      }
    },
  };
}
