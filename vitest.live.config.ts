import { defineConfig } from 'vitest/config';

/**
 * Opt-in LIVE Gemini compatibility test (npm run test:live). Not part of
 * `npm test`. Requires GEMINI_API_KEY in the server process environment.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
