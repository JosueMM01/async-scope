/**
 * SandboxPromise: the Promise implementation user code sees inside the sandbox.
 *
 * Real native promises are scheduled by the engine on its own microtask queue,
 * invisible to us and impossible to pause or record. Every promise in the
 * sandbox is therefore a SandboxPromise, and every reaction is scheduled on the
 * virtual scheduler, where it becomes a traceable microtask.
 *
 * Semantics follow the ECMAScript promise specification for the observable
 * behaviors that matter for education: FIFO microtask ordering, `.then`
 * deferral, adoption of thenables, and unhandled-rejection tracking.
 */

/** Minimal host surface SandboxPromise needs from the scheduler. */
export interface PromiseHost {
  enqueueMicrotask(job: () => void, label: string): void;
  /** Called when a promise is rejected while it has no reactions attached. */
  notifyUnhandledRejection(promise: object, reason: unknown): void;
  /** Called if a reaction is attached to a previously-unhandled rejection. */
  revokeUnhandledRejection(promise: object): void;
}

type OnFulfilled = ((value: unknown) => unknown) | undefined | null;
type OnRejected = ((reason: unknown) => unknown) | undefined | null;

interface Reaction {
  onFulfilled: OnFulfilled;
  onRejected: OnRejected;
  label: string;
  target: SandboxPromise;
}

const noop = () => {};

/** Current host; configured once per execution by the engine. */
let host: PromiseHost | null = null;

export function configurePromiseHost(newHost: PromiseHost): void {
  host = newHost;
}

export function resetPromiseHost(): void {
  host = null;
}

function describeHandler(onFulfilled: OnFulfilled, onRejected: OnRejected): string {
  const fn = onFulfilled ?? onRejected;
  const name = typeof fn === 'function' ? fn.name : '';
  return name && !name.startsWith('__as') ? name : 'then';
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export class SandboxPromise {
  /** Brand used by the console serializer for `Promise { … }` previews. */
  static readonly brand = Symbol('asyncscope.promise');

  private state: 'pending' | 'fulfilled' | 'rejected' = 'pending';
  private value: unknown = undefined;
  private reactions: Reaction[] = [];
  private isHandled = false;

  constructor(executor: (resolve: (v: unknown) => void, reject: (r: unknown) => void) => void) {
    if (typeof executor !== 'function') {
      throw new TypeError('Promise resolver is not a function');
    }
    try {
      executor(resolveThis.bind(null, this), rejectThis.bind(null, this));
    } catch (error) {
      rejectThis(this, error);
    }
  }

  get _state(): 'pending' | 'fulfilled' | 'rejected' {
    return this.state;
  }

  get _value(): unknown {
    return this.value;
  }

  get _settled(): boolean {
    return this.state !== 'pending';
  }

  then(
    onFulfilled?: OnFulfilled | null,
    onRejected?: OnRejected | null,
    internalLabel?: string,
  ): SandboxPromise {
    this.markHandled();
    const target = new SandboxPromise(noop);
    const reaction: Reaction = {
      onFulfilled: onFulfilled ?? null,
      onRejected: onRejected ?? null,
      label: internalLabel ?? describeHandler(onFulfilled, onRejected),
      target,
    };
    if (this.state === 'pending') {
      this.reactions.push(reaction);
    } else if (host) {
      host.enqueueMicrotask(() => runReaction(reaction, this), reaction.label);
    }
    return target;
  }

  catch(onRejected?: OnRejected | null): SandboxPromise {
    return this.then(undefined, onRejected);
  }

  finally(onFinally?: (() => unknown) | null): SandboxPromise {
    const settle = (value: unknown, rejected: boolean) => () => {
      const result = onFinally ? onFinally() : undefined;
      const awaited = SandboxPromise.resolve(result);
      return awaited.then(() => {
        if (rejected) throw value;
        return value;
      });
    };
    return this.then(
      (value) => settle(value, false)(),
      (reason) => settle(reason, true)(),
      'finally',
    );
  }

  private markHandled(): void {
    if (this.state === 'rejected' && !this.isHandled && host) {
      host.revokeUnhandledRejection(this);
    }
    this.isHandled = true;
  }

  /** Internal: mark as handled when adopted by another promise. */
  _markHandled(): void {
    this.markHandled();
  }

  static resolve(value?: unknown, internalLabel?: string): SandboxPromise {
    if (value instanceof SandboxPromise) return value;
    const p = new SandboxPromise(noop);
    resolveThis(p, value);
    return p;
  }

  static reject(reason?: unknown): SandboxPromise {
    const p = new SandboxPromise(noop);
    rejectThis(p, reason);
    return p;
  }

  static all(values: Iterable<unknown>): SandboxPromise {
    return new SandboxPromise((resolve, reject) => {
      const items = [...(values as Iterable<unknown>)];
      const results: unknown[] = new Array(items.length);
      let pending = items.length;
      if (pending === 0) {
        resolve(results);
        return;
      }
      items.forEach((item, index) => {
        SandboxPromise.resolve(item).then(
          (value) => {
            results[index] = value;
            if (--pending === 0) resolve(results);
          },
          reject,
          'all',
        );
      });
    });
  }

  static race(values: Iterable<unknown>): SandboxPromise {
    return new SandboxPromise((resolve, reject) => {
      for (const item of values as Iterable<unknown>) {
        SandboxPromise.resolve(item).then(resolve, reject, 'race');
      }
    });
  }

  static allSettled(values: Iterable<unknown>): SandboxPromise {
    return new SandboxPromise((resolve) => {
      const items = [...(values as Iterable<unknown>)];
      const results: unknown[] = new Array(items.length);
      let pending = items.length;
      if (pending === 0) {
        resolve(results);
        return;
      }
      items.forEach((item, index) => {
        SandboxPromise.resolve(item).then(
          (value) => {
            results[index] = { status: 'fulfilled', value };
            if (--pending === 0) resolve(results);
          },
          (reason) => {
            results[index] = { status: 'rejected', reason };
            if (--pending === 0) resolve(results);
          },
          'allSettled',
        );
      });
    });
  }

  static any(values: Iterable<unknown>): SandboxPromise {
    return new SandboxPromise((resolve, reject) => {
      const items = [...(values as Iterable<unknown>)];
      const errors: unknown[] = new Array(items.length);
      let pending = items.length;
      if (pending === 0) {
        reject(new AggregateError(errors, 'All promises were rejected'));
        return;
      }
      items.forEach((item, index) => {
        SandboxPromise.resolve(item).then(
          resolve,
          (reason) => {
            errors[index] = reason;
            if (--pending === 0) reject(new AggregateError(errors, 'All promises were rejected'));
          },
          'any',
        );
      });
    });
  }
}

/** Spec-style resolve procedure. */
function resolveThis(promise: SandboxPromise, value: unknown): void {
  if (value === promise) {
    rejectThis(promise, new TypeError('Chaining cycle detected for promise'));
    return;
  }
  if (value instanceof SandboxPromise) {
    // Adopt another sandbox promise: react to its eventual settlement.
    value._markHandled();
    if (value.state === 'fulfilled') {
      settle(promise, 'fulfilled', value.value);
    } else if (value.state === 'rejected') {
      settle(promise, 'rejected', value.value);
    } else {
      value.reactions.push({
        onFulfilled: null,
        onRejected: null,
        label: 'adopt',
        target: promise,
      });
    }
    return;
  }
  if (isObjectLike(value)) {
    let then: unknown;
    try {
      then = (value as { then?: unknown }).then;
    } catch (error) {
      rejectThis(promise, error);
      return;
    }
    if (typeof then === 'function') {
      // Foreign thenable: call then(resolvePromise, rejectPromise) as a job,
      // at most once.
      let called = false;
      const once = (fn: (v: unknown) => void) => (v: unknown) => {
        if (called) return;
        called = true;
        fn(v);
      };
      host?.enqueueMicrotask(() => {
        try {
          (then as (res: (v: unknown) => void, rej: (r: unknown) => void) => void).call(
            value,
            once((v) => resolveThis(promise, v)),
            once((r) => rejectThis(promise, r)),
          );
        } catch (error) {
          once(() => {});
          rejectThis(promise, error);
        }
      }, 'thenable');
      return;
    }
  }
  settle(promise, 'fulfilled', value);
}

function rejectThis(promise: SandboxPromise, reason: unknown): void {
  const wasPending = promise.state === 'pending';
  settle(promise, 'rejected', reason);
  if (wasPending && !promise.isHandled) {
    host?.notifyUnhandledRejection(promise, reason);
  }
}

function settle(
  promise: SandboxPromise,
  state: 'fulfilled' | 'rejected',
  value: unknown,
): void {
  if (promise.state !== 'pending') return;
  promise.state = state;
  promise.value = value;
  const reactions = promise.reactions;
  promise.reactions = [];
  for (const reaction of reactions) {
    if (host) {
      host.enqueueMicrotask(() => runReaction(reaction, promise), reaction.label);
    }
  }
}

/** Runs a single reaction, settling its target promise appropriately. */
function runReaction(reaction: Reaction, parent: SandboxPromise): void {
  const handler = parent.state === 'fulfilled' ? reaction.onFulfilled : reaction.onRejected;
  try {
    const result =
      typeof handler === 'function'
        ? handler(parent.value)
        : parent.state === 'fulfilled'
          ? parent.value
          : (() => {
              throw parent.value;
            })();
    resolveThis(reaction.target, result);
  } catch (error) {
    rejectThis(reaction.target, error);
  }
}
