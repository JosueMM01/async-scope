/**
 * Serializing console for the sandbox.
 *
 * User code must not touch the real console: every call is serialized into a
 * plain string (with depth and length caps) and recorded as a trace event.
 */
import type { LogLevel } from '../types';
import { SandboxPromise } from './promise';

const MAX_DEPTH = 3;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 500;

export interface SandboxConsole {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  [key: string]: (...args: unknown[]) => void;
}

class Circle {
  readonly seen = new WeakSet<object>();
}

function truncate(text: string): string {
  return text.length > MAX_STRING_LENGTH
    ? `${text.slice(0, MAX_STRING_LENGTH)}…`
    : text;
}

/** Formats a value the way a developer expects in a console. */
export function serializeValue(value: unknown, depth = 0, circle?: Circle): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const type = typeof value;
  switch (type) {
    case 'string':
      return depth === 0 ? truncate(value as string) : `"${truncate(value as string)}"`;
    case 'number':
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return (value as symbol).toString();
    case 'function': {
      const fn = value as { name?: string };
      return `ƒ ${fn.name || '(anonymous)'}()`;
    }
  }

  // Objects from here on.
  const c = circle ?? new Circle();
  const obj = value as object;
  if (c.seen.has(obj)) return '[Circular]';
  c.seen.add(obj);

  try {
    if (value instanceof SandboxPromise) {
      const promise = value as SandboxPromise;
      const state = promise._state;
      if (state === 'pending') return 'Promise { <pending> }';
      if (state === 'fulfilled') {
        return `Promise { ${serializeValue(promise._value, depth + 1, c)} }`;
      }
      return `Promise { <rejected> ${serializeValue(promise._value, depth + 1, c)} }`;
    }
    if (value instanceof Error) {
      const err = value as Error;
      const name = err.name || 'Error';
      return err.message ? `${name}: ${err.message}` : name;
    }
    if (value instanceof Date) {
      return (value as Date).toISOString();
    }
    if (value instanceof RegExp) {
      return String(value);
    }
    if (typeof Map !== 'undefined' && value instanceof Map) {
      const map = value as Map<unknown, unknown>;
      const items = [...map.entries()].slice(0, MAX_ARRAY_ITEMS);
      const suffix = map.size > items.length ? `, … +${map.size - items.length}` : '';
      return `Map(${map.size}) {${items
        .map(([k, v]) => ` ${serializeValue(k, depth + 1, c)} => ${serializeValue(v, depth + 1, c)}`)
        .join(',')}${suffix} }`;
    }
    if (typeof Set !== 'undefined' && value instanceof Set) {
      const set = value as Set<unknown>;
      const items = [...set.values()].slice(0, MAX_ARRAY_ITEMS);
      const suffix = set.size > items.length ? `, … +${set.size - items.length}` : '';
      return `Set(${set.size}) {${items
        .map((v) => ` ${serializeValue(v, depth + 1, c)}`)
        .join(',')}${suffix} }`;
    }
    if (Array.isArray(value)) {
      if (depth >= MAX_DEPTH) return `Array(${value.length})`;
      const items = value.slice(0, MAX_ARRAY_ITEMS);
      const suffix = value.length > items.length ? `, … +${value.length - items.length}` : '';
      return `[${items.map((v) => serializeValue(v, depth + 1, c)).join(', ')}${suffix}]`;
    }
    if (depth >= MAX_DEPTH) return '{…}';
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_ARRAY_ITEMS);
    const total = Object.keys(value as Record<string, unknown>).length;
    const suffix = total > entries.length ? `, … +${total - entries.length}` : '';
    const ctor = (value as object).constructor;
    const tag =
      ctor && ctor !== Object && ctor.name ? `${ctor.name} ` : '';
    return `${tag}{ ${entries
      .map(([k, v]) => `${k}: ${serializeValue(v, depth + 1, c)}`)
      .join(', ')}${suffix} }`;
  } finally {
    c.seen.delete(obj);
  }
}

export function formatArguments(args: unknown[]): string {
  if (args.length === 0) return '';
  return args.map((arg) => serializeValue(arg)).join(' ');
}

/** Creates the `console` object injected into the sandbox. */
export function createSandboxConsole(emit: (level: LogLevel, text: string) => void): SandboxConsole {
  const make =
    (level: LogLevel) =>
    (...args: unknown[]): void => {
      emit(level, formatArguments(args));
    };

  const base: SandboxConsole = {
    log: make('log'),
    info: make('info'),
    debug: make('log'),
    warn: make('warn'),
    error: make('error'),
  };

  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) {
        return target[prop];
      }
      return (...args: unknown[]): void => {
        emit('warn', `console.${String(prop)}() is not supported in AsyncScope yet`);
      };
    },
  });
}
