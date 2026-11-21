/**
 * Session reboot for Restore and Import (v1 restore policy, docs/persistence/).
 *
 * The studio session is replaced as a whole: the old session is torn down and
 * a new one is launched with the loaded world as its genesis. If the new
 * session fails to start, the previous world is launched again (its content is
 * kept, its undo history is not). If that also fails, a plain message is shown
 * instead of a blank page. No DOM or three.js here, so this is unit-tested.
 */
export type Teardown = () => void;

export type RebootOutcome = 'loaded' | 'rolled-back' | 'failed';

export interface RebooterDeps<S> {
  /** Boots a session; resolves with its teardown. May throw or reject. */
  launch(session: S): Promise<Teardown>;
  /** Removes whatever a failed launch left in the page. */
  clearHost(): void;
  /** Receives every error caught here (never rethrown). */
  report(error: unknown): void;
  /** Last resort when even the previous world cannot start. */
  showFatal(message: string): void;
  /** Defers work out of the click handler that requested it. Default: queueMicrotask. */
  defer?(run: () => void): void;
}

export interface Rebooter<S> {
  /** Launches the first session. */
  start(session: S): Promise<void>;
  /**
   * Replaces the running session with `next`, falling back to `previous`.
   * Throws synchronously if a reboot is already running (the persistence
   * controller then reports REPLACE_FAILED and keeps the current session).
   */
  request(next: S, previous: S): Promise<RebootOutcome>;
  readonly busy: boolean;
  /** Tears down the current session (hot reload). */
  dispose(): void;
}

export const FALLBACK_NOTICE = 'The loaded world could not be started. Your previous world was kept.';
export const FATAL_MESSAGE = 'The studio could not start. Reload the page. Your local save and exported files are not affected.';

export function createRebooter<S>(deps: RebooterDeps<S>): Rebooter<S> {
  const defer = deps.defer ?? ((run: () => void) => queueMicrotask(run));
  let teardown: Teardown | null = null;
  let busy = false;

  const safeTeardown = () => {
    const t = teardown;
    teardown = null;
    try {
      t?.();
    } catch (error) {
      deps.report(error);
    }
  };

  const tryLaunch = async (session: S): Promise<boolean> => {
    try {
      teardown = await deps.launch(session);
      return true;
    } catch (error) {
      deps.report(error);
      try {
        deps.clearHost();
      } catch (e) {
        deps.report(e);
      }
      return false;
    }
  };

  return {
    async start(session) {
      if (!(await tryLaunch(session))) deps.showFatal(FATAL_MESSAGE);
    },
    request(next, previous) {
      if (busy) throw new Error('A world load is already in progress.');
      busy = true;
      return new Promise<RebootOutcome>((resolve) => {
        defer(() => {
          void (async () => {
            let outcome: RebootOutcome = 'failed';
            try {
              safeTeardown();
              if (await tryLaunch(next)) outcome = 'loaded';
              else if (await tryLaunch(previous)) outcome = 'rolled-back';
              else deps.showFatal(FATAL_MESSAGE);
            } finally {
              busy = false;
              resolve(outcome);
            }
          })();
        });
      });
    },
    get busy() {
      return busy;
    },
    dispose: safeTeardown,
  };
}
