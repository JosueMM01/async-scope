/** Message protocol between the main thread and the recorder worker. */
import type { CompileError, SourceLanguage, TraceEvent } from '../engine/types';

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
