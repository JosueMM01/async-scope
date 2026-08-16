/**
 * useRecorder: main-thread lifecycle for the sandbox worker.
 *
 * Responsibilities: lazy worker creation, run id invalidation (stale results
 * are dropped), a wall-clock watchdog that terminates a stuck worker, and a
 * stop() that hard-terminates (the only guaranteed way to kill runaway code).
 */
import { useCallback, useEffect, useRef } from 'react';
import type { CompileError, TraceEvent } from '../engine/types';
import { RUN_TIMEOUT_MS, type WorkerResponse } from '../worker/protocol';

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
  run: (code: string) => void;
  /** Hard-terminates the current run and discards the worker. */
  stop: () => void;
}

export function useRecorder(callbacks: RecorderCallbacks): Recorder {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const workerRef = useRef<Worker | null>(null);
  const runRef = useRef<ActiveRun | null>(null);
  const nextIdRef = useRef(1);

  const spawn = useCallback((): Worker => {
    const worker = new Worker(new URL('../worker/recorder.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const active = runRef.current;
      if (!active || message.id !== active.id) return; // stale run
      if (message.type === 'trace') {
        callbacksRef.current.onTrace(message.events);
      } else {
        callbacksRef.current.onCompileError(message.error);
      }
      clearTimeout(active.watchdog);
      runRef.current = null;
    };
    worker.onerror = () => {
      const active = runRef.current;
      if (active) clearTimeout(active.watchdog);
      runRef.current = null;
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
    (code: string) => {
      terminate();
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
      worker.postMessage({ type: 'run', id, code });
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
