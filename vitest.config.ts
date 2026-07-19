import { defineConfig } from 'vitest/config';

/**
 * Test configuration.
 *
 * The only thing here is the timeout, and it is here for a specific reason.
 *
 * A good half of this suite proves properties that only appear over time — that the
 * simulation is deterministic across a long run, that a season never records more
 * episodes than it has, that money is conserved over twelve years. Those tests earn
 * their keep precisely because they simulate hundreds of weeks, and at roughly 6-10ms
 * a week a 400-week test legitimately takes several seconds.
 *
 * Vitest defaults to 5 seconds per test. As the suite grew from 41 tests to 56 the
 * long ones started drifting over that line, and — worse — a *different* test failed
 * on each run depending on machine load. A suite that fails randomly is worse than a
 * slow one: it trains you to re-run instead of to read, and the day it catches a real
 * bug you will assume it is the flake again.
 *
 * 30s is far above the slowest test (~8s under load) and still low enough to catch a
 * genuine hang.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
