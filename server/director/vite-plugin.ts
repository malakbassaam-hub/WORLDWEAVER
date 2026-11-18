import type { Plugin } from 'vite';
import { readConfig } from './config';
import { createDirectorHandler, type DirectorHandler } from './handler';

/**
 * Mounts the Director proxy at /api/director in the Vite dev and preview
 * servers (Node.js). The key is read from the server process environment;
 * nothing is injected into the client bundle.
 */
export function directorPlugin(): Plugin {
  let handler: DirectorHandler | null = null;
  const get = (): DirectorHandler => {
    if (handler) return handler;
    const config = readConfig(process.env);
    // Startup diagnostics: mode and whether a key is configured. Never the key.
    console.info(
      `[director] mode=${config.mode.toUpperCase()} · model=${config.model} · key=${config.keyConfigured ? 'configured' : 'not configured'} (${config.modeReason})`,
    );
    handler = createDirectorHandler({ config });
    return handler;
  };
  return {
    name: 'worldweaver-director',
    configureServer(server) {
      if (process.env.VITEST) return; // unit tests use createDirectorServer directly
      const h = get();
      server.middlewares.use((req, res, next) => h(req, res, next));
    },
    configurePreviewServer(server) {
      const h = get();
      server.middlewares.use((req, res, next) => h(req, res, next));
    },
  };
}
