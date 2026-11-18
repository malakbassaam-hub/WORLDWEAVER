import { defineConfig } from 'vitest/config';
import { directorPlugin } from './server/director/vite-plugin';

// No `define` or env injection: secrets must never reach the client bundle.
// Gemini calls go through the Director proxy (server/director), mounted by
// directorPlugin() in the Node.js dev and preview servers at /api/director.
export default defineConfig({
  plugins: [directorPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
