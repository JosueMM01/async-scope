/**
 * Shared event model, visualization state and public result types for the
 * AsyncScope engine.
 *
 * The engine records a full {@link TraceEvent} list while executing user code
 * inside a virtual JavaScript runtime. The UI never re-executes anything: it
 * folds the recorded trace into an array of {@link VisualizationState}
 * snapshots and steps through them.
 */

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export type TimerKind = 'timeout' | 'interval';

/** Kind of runtime failure surfaced to the user. */
export type ErrorKind = 'sync' | 'unhandled-rejection' | 'limit';

export type StackPushReason = 'call' | 'resume';
export type StackPopReason = 'return' | 'suspend' | 'error';

/** What the event loop is doing between segments. */
export type LoopAction = 'idle' | 'drain-microtasks' | 'run-task' | 'advance-time';

interface EventBase {
  /** Source line of the statement being executed when the event fired. */
  line: number | null;
}

/** Discriminated union of every runtime event the engine can record. */
export type TraceEvent = EventBase &
  (
    | { type: 'execution:start' }
    | { type: 'execution:end'; ok: boolean }
    | { type: 'stack:push'; frameId: number; name: string; reason: StackPushReason }
    | { type: 'stack:pop'; name: string; reason: StackPopReason }
    | { type: 'loc'; to: number }
    | { type: 'console'; level: LogLevel; text: string }
    | {
        type: 'api:schedule';
        timerId: number;
        kind: TimerKind;
        delay: number;
        label: string;
        dueTime: number;
      }
    | { type: 'api:clear'; timerId: number }
    | { type: 'api:complete'; timerId: number }
    | { type: 'task:enqueue'; taskId: number; timerId: number; label: string; dueTime: number }
    | { type: 'task:dequeue'; taskId: number; label: string }
    | { type: 'microtask:enqueue'; id: number; label: string }
    | { type: 'microtask:dequeue'; id: number; label: string }
    | { type: 'loop:turn'; action: LoopAction }
    | { type: 'time:advance'; to: number }
    | { type: 'error'; message: string; kind: ErrorKind }
  );

export type TraceEventType = TraceEvent['type'];

export interface Frame {
  id: number;
  name: string;
}

export interface QueueItem {
  id: number;
  label: string;
}

export interface TaskItem extends QueueItem {
  timerId: number;
  dueTime: number;
}

export interface ApiTimer {
  timerId: number;
  kind: TimerKind;
  delay: number;
  remaining: number;
  label: string;
  /** Virtual time at which the timer fires (used to recompute remaining). */
  dueTime: number;
}

export interface ConsoleLine {
  id: number;
  level: LogLevel;
  text: string;
}

export type TimelineKind =
  'start' | 'stack' | 'api' | 'microtask' | 'task' | 'loop' | 'console' | 'error' | 'end' | 'time';

export interface TimelineEntry {
  id: number;
  kind: TimelineKind;
  text: string;
  line: number | null;
}

export interface ExecutionError {
  message: string;
  kind: ErrorKind;
  line: number | null;
}

/** Immutable visualization state at a single step of the recorded trace. */
export interface VisualizationState {
  status: 'running' | 'complete' | 'error';
  stack: Frame[];
  microtasks: QueueItem[];
  tasks: TaskItem[];
  apis: ApiTimer[];
  console: ConsoleLine[];
  timeline: TimelineEntry[];
  currentLine: number | null;
  virtualTime: number;
  loop: LoopAction;
  error: ExecutionError | null;
}

/** Errors detected before any user code runs (parse / unsupported features). */
export interface CompileError {
  phase: 'syntax' | 'unsupported' | 'internal';
  message: string;
  line: number | null;
}

export type RunOutcome = { ok: true; events: TraceEvent[] } | { ok: false; error: CompileError };

/** Resource limits enforced while recording a program. */
export interface EngineLimits {
  /** Combined budget of statements, function entries and loop iterations. */
  maxTicks: number;
  /** Maximum number of recorded trace events. */
  maxEvents: number;
  /** Wall-clock time budget for the whole recording, in milliseconds. */
  wallClockMs: number;
  /** Maximum call stack depth before a stack overflow error is reported. */
  maxStackDepth: number;
  /** Maximum timers alive at the same time. */
  maxTimers: number;
  /** Maximum total executed tasks (protects against runaway setInterval). */
  maxTasksRun: number;
  /** Maximum total executed microtask jobs. */
  maxMicrotasks: number;
}

export const DEFAULT_LIMITS: EngineLimits = {
  maxTicks: 2_000_000,
  maxEvents: 20_000,
  wallClockMs: 10_000,
  maxStackDepth: 200,
  maxTimers: 1_000,
  maxTasksRun: 2_000,
  maxMicrotasks: 20_000,
};
