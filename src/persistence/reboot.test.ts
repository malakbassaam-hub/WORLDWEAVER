import { describe, expect, it, vi } from 'vitest';
import { createRebooter, FATAL_MESSAGE, type RebooterDeps } from './reboot';

type S = { readonly name: string };

/** A fake studio: `launch` records sessions; names listed in `failing` throw. */
function harness(failing: string[] = [], opts: { teardownThrows?: boolean } = {}) {
  const events: string[] = [];
  const errors: unknown[] = [];
  const fatal: string[] = [];
  const deps: RebooterDeps<S> = {
    launch: vi.fn(async (s: S) => {
      events.push(`launch:${s.name}`);
      if (failing.includes(s.name)) throw new Error(`cannot start ${s.name}`);
      return () => {
        events.push(`teardown:${s.name}`);
        if (opts.teardownThrows) throw new Error('teardown failed');
      };
    }),
    clearHost: () => events.push('clear'),
    report: (e) => errors.push(e),
    showFatal: (m) => fatal.push(m),
  };
  return { r: createRebooter(deps), events, errors, fatal };
}

describe('session rebooter', () => {
  it('tears down the old session, then launches the new one', async () => {
    const h = harness();
    await h.r.start({ name: 'a' });
    expect(await h.r.request({ name: 'b' }, { name: 'a' })).toBe('loaded');
    expect(h.events).toEqual(['launch:a', 'teardown:a', 'launch:b']);
    expect(h.errors).toEqual([]);
    h.r.dispose();
    expect(h.events.at(-1)).toBe('teardown:b');
  });

  it('defers the work out of the calling handler', async () => {
    const h = harness();
    await h.r.start({ name: 'a' });
    const done = h.r.request({ name: 'b' }, { name: 'a' });
    expect(h.events).toEqual(['launch:a']); // nothing happened synchronously
    expect(h.r.busy).toBe(true);
    await done;
    expect(h.r.busy).toBe(false);
  });

  it('rolls back to the previous world when the new session fails to start', async () => {
    const h = harness(['bad']);
    await h.r.start({ name: 'a' });
    expect(await h.r.request({ name: 'bad' }, { name: 'a-copy' })).toBe('rolled-back');
    expect(h.events).toEqual(['launch:a', 'teardown:a', 'launch:bad', 'clear', 'launch:a-copy']);
    expect(h.errors).toHaveLength(1);
    expect(h.fatal).toEqual([]);
    // The rolled-back session is the current one.
    h.r.dispose();
    expect(h.events.at(-1)).toBe('teardown:a-copy');
  });

  it('shows a plain message, not a blank page, when the previous world also fails', async () => {
    const h = harness(['bad', 'prev']);
    await h.r.start({ name: 'a' });
    expect(await h.r.request({ name: 'bad' }, { name: 'prev' })).toBe('failed');
    expect(h.fatal).toEqual([FATAL_MESSAGE]);
    expect(h.errors).toHaveLength(2);
    expect(h.r.busy).toBe(false);
  });

  it('refuses a second request while one is running, synchronously', async () => {
    const h = harness();
    await h.r.start({ name: 'a' });
    const first = h.r.request({ name: 'b' }, { name: 'a' });
    expect(() => h.r.request({ name: 'c' }, { name: 'a' })).toThrow(/already in progress/);
    await first;
    expect(await h.r.request({ name: 'c' }, { name: 'b' })).toBe('loaded');
  });

  it('a throwing teardown is reported and does not block the load', async () => {
    const h = harness([], { teardownThrows: true });
    await h.r.start({ name: 'a' });
    expect(await h.r.request({ name: 'b' }, { name: 'a' })).toBe('loaded');
    expect(h.errors).toHaveLength(1);
  });

  it('a failing first start shows the fatal message', async () => {
    const h = harness(['a']);
    await h.r.start({ name: 'a' });
    expect(h.fatal).toEqual([FATAL_MESSAGE]);
  });
});
