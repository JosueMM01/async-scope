/**
 * Public surface of the AsyncScope engine.
 *
 * The engine is framework- and environment-agnostic: it compiles and records
 * synchronously, whether it runs inside the sandbox worker (production) or
 * directly in Node (unit tests).
 */
export { executeProgram } from './execute';
export { compile } from './compile';
export { buildStates, initialVisualizationState, reduceVisualizationState } from './trace/fold';
export { eventToTimelineEntry } from './trace/messages';
export { EXAMPLES, DEFAULT_EXAMPLE_ID, getExample, type Example } from './examples';
export { VirtualScheduler } from './runtime/scheduler';
export { SandboxPromise } from './runtime/promise';
export type {
  ApiTimer,
  CompileError,
  ConsoleLine,
  EngineLimits,
  ErrorKind,
  ExecutionError,
  Frame,
  LoopAction,
  LogLevel,
  QueueItem,
  RunOutcome,
  StackPopReason,
  StackPushReason,
  TaskItem,
  TimelineEntry,
  TimelineKind,
  TimerKind,
  TraceEvent,
  TraceEventType,
  VisualizationState,
} from './types';
export { DEFAULT_LIMITS } from './types';
