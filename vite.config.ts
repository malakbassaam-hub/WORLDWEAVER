import { defineConfig } from 'vitest/config';

// No `define` or env injection: secrets must never reach the client bundle.
// Future Gemini calls will go through a server-side proxy (Phase 2+).
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
