/**
 * useRecorder: main-thread lifecycle for the sandbox worker.
 *
 * Responsibilities: lazy worker creation, run id invalidation (stale results
 * are dropped), a wall-clock watchdog that terminates a stuck worker, and a
 * stop() that hard-terminates (the only guaranteed way to kill runaway code).
 */
import { useCallback, useEffect, useRef } from 'react';
import type { CompileError, SourceLanguage, TraceEvent } from '../engine/types';
import { isWorkerResponse, MAX_SOURCE_LENGTH, RUN_TIMEOUT_MS } from '../worker/protocol';

export interface RecorderCallbacks {
  onTrace: (events: TraceEvent[]) => void;
  onCompileError: (error: CompileError) => void;
  onTimeout: () => void;
}

interface ActiveRun {
  id: number;
  watchdog: ReturnType<typeof setTimeout>;
}

export interface Recorder {
  /** true while a run is in flight */
  isRunning: () => boolean;
  /** Starts (or restarts) a recording; ignores results of previous runs. */
  run: (code: string, language: SourceLanguage) => void;
  /** Hard-terminates the current run and discards the worker. */
  stop: () => void;
}

export function useRecorder(callbacks: RecorderCallbacks): Recorder {
  const callbacksRef = useRef(callbacks);

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const workerRef = useRef<Worker | null>(null);
  const runRef = useRef<ActiveRun | null>(null);
  const nextIdRef = useRef(1);

  const spawn = useCallback((): Worker => {
    const worker = new Worker(new URL('../worker/recorder.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      const active = runRef.current;
      if (!active || workerRef.current !== worker) return;
      if (!isWorkerResponse(message, active.id)) {
        clearTimeout(active.watchdog);
        runRef.current = null;
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        callbacksRef.current.onCompileError({
          phase: 'internal',
          message: 'The sandbox returned an invalid response and was stopped.',
          line: null,
        });
        return;
      }
      clearTimeout(active.watchdog);
      runRef.current = null;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      if (message.type === 'trace') {
        callbacksRef.current.onTrace(message.events);
      } else {
        callbacksRef.current.onCompileError(message.error);
      }
    };
    worker.onerror = () => {
      const active = runRef.current;
      if (!active || workerRef.current !== worker) return;
      clearTimeout(active.watchdog);
      runRef.current = null;
      worker.terminate();
      workerRef.current = null;
      callbacksRef.current.onTimeout();
    };
    workerRef.current = worker;
    return worker;
  }, []);

  const terminate = useCallback(() => {
    const active = runRef.current;
    if (active) clearTimeout(active.watchdog);
    runRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const run = useCallback(
    (code: string, language: SourceLanguage) => {
      terminate();
      if (code.length > MAX_SOURCE_LENGTH) {
        callbacksRef.current.onCompileError({
          phase: 'unsupported',
          message: `Source is too large. AsyncScope accepts up to ${MAX_SOURCE_LENGTH.toLocaleString()} characters.`,
          line: null,
        });
        return;
      }
      const worker = spawn();
      const id = nextIdRef.current++;
      const watchdog = setTimeout(() => {
        // The engine has its own CPU limits; this catches pathological cases
        // (e.g. memory bombs that hang before any limit triggers).
        if (runRef.current?.id === id) {
          terminate();
          callbacksRef.current.onTimeout();
        }
      }, RUN_TIMEOUT_MS);
      runRef.current = { id, watchdog };
      worker.postMessage({ type: 'run', id, code, language });
    },
    [spawn, terminate],
  );

  const stop = useCallback(() => {
    terminate();
  }, [terminate]);

  useEffect(() => terminate, [terminate]);

  const isRunning = useCallback(() => runRef.current !== null, []);

  return { isRunning, run, stop };
}
