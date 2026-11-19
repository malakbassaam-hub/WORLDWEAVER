import { defineConfig } from 'vitest/config';
/**
 * Opt-in performance measurements for the Causal Ledger and Parallel Futures:
 *   npx vitest run --config vitest.measure.config.ts
 * Not part of `npm test`. Prints timings; asserts only generous upper bounds.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.measure.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
