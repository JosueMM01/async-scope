/**
 * The `__AS__` runtime object injected into instrumented code, plus the
 * sandboxed platform globals (timers, queueMicrotask, Promise, console).
 */
import { SandboxApiError } from '../errors';
import type { LogLevel } from '../types';
import { SandboxPromise } from './promise';
import type { VirtualScheduler } from './scheduler';
import { createSandboxConsole, type SandboxConsole } from './console';

export interface RuntimeHandles {
  /** Called at the top of every instrumented function. */
  enter(name: string, line: number | null): void;
  /** Called in the `finally` of every instrumented function. */
  exit(): void;
  /** Statement-level position tracking (also feeds the step budget). */
  loc(line: number): void;
  /** Loop-iteration budget guard. */
  tick(line: number | null): void;
  /** Pops the frame of an async function suspending at `await`. */
  beforeYield<T>(value: T, name: string, line: number | null): T;
  /** Re-pushes the frame of an async function resuming after `await`. */
  afterYield<T>(value: T, name: string, line: number | null): T;
  /** Drives a lowered async function (generator) with sandbox promises. */
  a2g(
    genFn: (...args: unknown[]) => Generator<unknown, unknown, unknown>,
    thisArg: unknown,
    args: unknown,
    displayName: string,
  ): SandboxPromise;
  console: SandboxConsole;
}

export interface SandboxGlobals {
  setTimeout: (callback: () => void, delay?: unknown, ...extra: unknown[]) => number;
  clearTimeout: (timerId?: unknown) => void;
  setInterval: (callback: () => void, delay?: unknown, ...extra: unknown[]) => number;
  clearInterval: (timerId?: unknown) => void;
  queueMicrotask: (callback: () => void) => void;
  Promise: typeof SandboxPromise;
  console: SandboxConsole;
}

function requireFunction(value: unknown, api: string): asserts value is () => void {
  if (typeof value !== 'function') {
    throw new SandboxApiError(`${api} expects a function as its first argument`);
  }
}

export function createRuntime(scheduler: VirtualScheduler): {
  handles: RuntimeHandles;
  globals: SandboxGlobals;
} {
  const console = createSandboxConsole((level: LogLevel, text: string) => {
    scheduler.pushEvent({ type: 'console', level, text });
  });

  const handles: RuntimeHandles = {
    enter(name) {
      scheduler.enterFrame(name);
    },
    exit() {
      scheduler.exitFrame();
    },
    loc(line) {
      scheduler.tick();
      scheduler.line = line;
      scheduler.pushEvent({ type: 'loc', to: line });
    },
    tick() {
      scheduler.tick();
    },
    beforeYield(value, name) {
      scheduler.suspendTopFrame(name);
      return value;
    },
    afterYield(value, name) {
      scheduler.resumeFrame(name);
      return value;
    },
    a2g(genFn, thisArg, args, displayName) {
      return new SandboxPromise((resolve, reject) => {
        let gen: Generator<unknown, unknown, unknown>;
        try {
          gen = genFn.apply(thisArg, args as unknown[]);
        } catch (error) {
          reject(error);
          return;
        }
        const step = (result: IteratorResult<unknown>): void => {
          if (result.done) {
            resolve(result.value);
            return;
          }
          SandboxPromise.resolve(result.value).then(
            (value) => {
              try {
                step(gen.next(value));
              } catch (error) {
                reject(error);
              }
            },
            (error) => {
              try {
                step(gen.throw(error));
              } catch (thrown) {
                reject(thrown);
              }
            },
            `${displayName} (await)`,
          );
        };
        let first: IteratorResult<unknown>;
        try {
          first = gen.next();
        } catch (error) {
          reject(error);
          return;
        }
        step(first);
      });
    },
    console,
  };

  const globals: SandboxGlobals = {
    setTimeout(callback, delay) {
      requireFunction(callback, 'setTimeout');
      return scheduler.scheduleTimer(callback, delay, 'timeout');
    },
    clearTimeout(timerId) {
      scheduler.clearTimer(timerId);
    },
    setInterval(callback, delay) {
      requireFunction(callback, 'setInterval');
      return scheduler.scheduleTimer(callback, delay, 'interval');
    },
    clearInterval(timerId) {
      scheduler.clearTimer(timerId);
    },
    queueMicrotask(callback) {
      requireFunction(callback, 'queueMicrotask');
      const label = (callback as { name?: string }).name || 'microtask';
      scheduler.enqueueMicrotask(() => callback(), label);
    },
    Promise: SandboxPromise,
    console,
  };

  return { handles, globals };
}
