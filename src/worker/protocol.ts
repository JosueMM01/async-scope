/** Message protocol between the main thread and the recorder worker. */
import {
  DEFAULT_LIMITS,
  type CompileError,
  type SourceLanguage,
  type TraceEvent,
} from '../engine/types';

export interface RunRequest {
  type: 'run';
  /** Monotonic run id; stale responses are ignored by the main thread. */
  id: number;
  code: string;
  language: SourceLanguage;
}

export type WorkerResponse =
  | { type: 'trace'; id: number; events: TraceEvent[] }
  | { type: 'compile-error'; id: number; error: CompileError };

export const RUN_TIMEOUT_MS = 20_000;
export const MAX_SOURCE_LENGTH = 100_000;
/** Engine budget plus one terminal error and execution:end. */
export const MAX_TRACE_EVENTS = DEFAULT_LIMITS.maxEvents + 2;
const MAX_MESSAGE_TEXT = 1_000;

/** Bound display strings before transport so valid long output remains usable. */
export function boundWorkerResponse(message: WorkerResponse): WorkerResponse {
  const truncate = (text: string) =>
    text.length <= MAX_MESSAGE_TEXT ? text : `${text.slice(0, MAX_MESSAGE_TEXT - 1)}…`;
  if (message.type === 'compile-error') {
    return { ...message, error: { ...message.error, message: truncate(message.error.message) } };
  }
  return {
    ...message,
    events: message.events.map(
      (event) =>
        Object.fromEntries(
          Object.entries(event).map(([key, value]) => [
            key,
            typeof value === 'string' ? truncate(value) : value,
          ]),
        ) as TraceEvent,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isLine(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 1);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_MESSAGE_TEXT;
}

export function isRunRequest(value: unknown): value is RunRequest {
  return (
    isRecord(value) &&
    value.type === 'run' &&
    isId(value.id) &&
    typeof value.code === 'string' &&
    value.code.length <= MAX_SOURCE_LENGTH &&
    (value.language === 'javascript' || value.language === 'typescript')
  );
}

export function isWorkerResponse(value: unknown, expectedId: number): value is WorkerResponse {
  if (!isRecord(value) || value.id !== expectedId) return false;
  if (value.type === 'compile-error') {
    const error = value.error;
    return (
      isRecord(error) &&
      (error.phase === 'syntax' || error.phase === 'unsupported' || error.phase === 'internal') &&
      isText(error.message) &&
      isLine(error.line)
    );
  }
  return (
    value.type === 'trace' &&
    Array.isArray(value.events) &&
    value.events.length <= MAX_TRACE_EVENTS &&
    value.events.every(isTraceEvent)
  );
}

function isTraceEvent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string' || !isLine(value.line)) return false;
  const finite = (candidate: unknown) =>
    typeof candidate === 'number' && Number.isFinite(candidate);
  switch (value.type) {
    case 'execution:start':
      return true;
    case 'execution:end':
      return typeof value.ok === 'boolean';
    case 'stack:push':
      return (
        isId(value.frameId) &&
        isText(value.name) &&
        (value.reason === 'call' || value.reason === 'resume')
      );
    case 'stack:pop':
      return (
        isText(value.name) &&
        (value.reason === 'return' || value.reason === 'suspend' || value.reason === 'error')
      );
    case 'loc':
      return isId(value.to) && value.to > 0;
    case 'console':
      return (
        (value.level === 'log' ||
          value.level === 'info' ||
          value.level === 'warn' ||
          value.level === 'error') &&
        isText(value.text)
      );
    case 'api:schedule':
      return (
        isId(value.timerId) &&
        (value.kind === 'timeout' || value.kind === 'interval') &&
        finite(value.delay) &&
        isText(value.label) &&
        finite(value.dueTime)
      );
    case 'api:clear':
    case 'api:complete':
      return isId(value.timerId);
    case 'task:enqueue':
      return (
        isId(value.taskId) && isId(value.timerId) && isText(value.label) && finite(value.dueTime)
      );
    case 'task:dequeue':
      return isId(value.taskId) && isText(value.label);
    case 'microtask:enqueue':
    case 'microtask:dequeue':
      return isId(value.id) && isText(value.label);
    case 'loop:turn':
      return (
        value.action === 'idle' ||
        value.action === 'drain-microtasks' ||
        value.action === 'run-task' ||
        value.action === 'advance-time'
      );
    case 'time:advance':
      return finite(value.to);
    case 'error':
      return (
        isText(value.message) &&
        (value.kind === 'sync' || value.kind === 'unhandled-rejection' || value.kind === 'limit')
      );
    default:
      return false;
  }
}
