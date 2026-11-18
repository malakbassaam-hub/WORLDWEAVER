/**
 * Director proxy entry points.
 * - `directorPlugin()` (vite-plugin.ts) mounts the handler in `npm run dev`
 *   and `npm run preview`, so the browser only ever talks to its own origin.
 * - `createDirectorServer()` runs the handler as a standalone Node.js server
 *   bound to 127.0.0.1 (used by tests and the live compatibility test).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDirectorHandler, type HandlerOptions } from './handler';

export * from './config';
export * from './handler';
export { RECORDINGS, selectRecording, SIMULATED_ERRORS } from './recordings';
export { REQUEST_LIMITS, validateDirectorRequest } from './request';

export interface RunningServer {
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
}

export async function createDirectorServer(options: HandlerOptions, port = 0): Promise<RunningServer> {
  const handler = createDirectorHandler(options);
  const server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
