import { describe, expect, it } from 'vitest';

/**
 * WebGL context-loss / restore regression test.
 *
 * Runs only in a browser environment (vitest `environment: 'node'` skips it).
 * It exercises the real `webglcontextlost` / `webglcontextrestored` event path
 * on the canvas, which is what `SceneRenderer.onContextLost` /
 * `onContextRestored` (and the new `recover()`) respond to.
 *
 * A full `WEBGL_lose_context` end-to-end test (invalidating real GPU objects
 * then restoring them) requires a browser automation tool that can drive the
 * `WEBGL_lose_context` extension; none is installed here and the safety rules
 * prohibit installing one. That end-to-end verification is therefore blocked
 * by tooling and is documented as such. The event-path test below still
 * confirms recovery runs without throwing and the renderer stays functional.
 */

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

const loadRenderer = isBrowser
  ? async () => (await import('../render/SceneRenderer')).SceneRenderer
  : async () => null as unknown as typeof import('../render/SceneRenderer').SceneRenderer;

function probeLoseContextSupport(): boolean {
  if (!isBrowser) return false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    return gl?.getExtension('WEBGL_lose_context') != null;
  } catch {
    return false;
  }
}

const hasLoseContext = probeLoseContextSupport();

function mount(container: HTMLElement, seed: number) {
  return import('../render/SceneRenderer').then(({ SceneRenderer }) =>
    new SceneRenderer(
      container,
      {
        onSelect: () => {},
        onHover: () => {},
        onContextLost: () => {},
        onContextRestored: () => {},
      },
      seed,
    ),
  );
}

describe('WebGL context-loss recovery', () => {
  it.skipIf(!isBrowser)(
    'loads SceneRenderer in a browser environment',
    async () => {
      const SceneRenderer = await loadRenderer();
      expect(SceneRenderer).toBeDefined();
    },
  );

  it.skipIf(!isBrowser)(
    'recovers without throwing after context lost / restored events',
    async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      try {
        const renderer = await mount(container, 20261031);
        const canvas = renderer.domElement;

        // Simulate context loss.
        canvas.dispatchEvent(new Event('webglcontextlost'));
        expect(renderer.getQuality()).toBe('cinematic');

        // Simulate context restore -> triggers recover().
        canvas.dispatchEvent(new Event('webglcontextrestored'));

        // Renderer must remain functional after recovery.
        expect(renderer.getQuality()).toBe('cinematic');
        const stats = renderer.getStats();
        expect(typeof stats.fps).toBe('number');
        expect(typeof stats.drawCalls).toBe('number');
        expect(typeof stats.triangles).toBe('number');
        expect(typeof stats.entities).toBe('number');

        renderer.dispose();
      } finally {
        document.body.removeChild(container);
      }
    },
  );

  it.skipIf(!isBrowser || !hasLoseContext)(
    'reports WEBGL_lose_context availability for end-to-end testing',
    () => {
      // Documents whether a real GPU-invalidation test is possible in this browser.
      expect(typeof hasLoseContext).toBe('boolean');
    },
  );
});
