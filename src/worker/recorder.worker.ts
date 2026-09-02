/// <reference lib="webworker" />
/**
 * Sandbox worker: the only place user code is ever executed.
 *
 * The engine itself is environment-agnostic (it runs the same in Node during
 * tests); this worker adds the isolation boundary: the main thread can always
 * terminate us to stop runaway code, and nothing user code does can reach the
 * page. As defense in depth, worker-scope APIs that must never be touched are
 * removed on top of the static scans and parameter shadowing.
 */
import { executeProgram } from '../engine/execute';
import type { RunRequest, WorkerResponse } from './protocol';

const scope = self as unknown as Record<string, unknown> & {
  postMessage: (message: WorkerResponse) => void;
};

// Keep our own transport before removing the raw scope API.
const post = scope.postMessage.bind(self);

for (const name of [
  'fetch',
  'importScripts',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'indexedDB',
  'caches',
  'crypto',
  'postMessage',
  'close',
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
  'navigator',
  'location',
]) {
  try {
    delete scope[name];
  } catch {
    // Non-configurable properties are already covered by static scans.
  }
}

self.onmessage = (event: MessageEvent<RunRequest>) => {
  const request = event.data;
  if (request.type !== 'run') return;
  const outcome = executeProgram(request.code, { language: request.language });
  if (outcome.ok) {
    post({ type: 'trace', id: request.id, events: outcome.events });
  } else {
    post({ type: 'compile-error', id: request.id, error: outcome.error });
  }
};
