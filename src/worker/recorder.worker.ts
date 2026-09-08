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
import { boundWorkerResponse, isRunRequest, type WorkerResponse } from './protocol';

const scope = self as unknown as Record<string, unknown> & {
  postMessage: (message: WorkerResponse) => void;
};

// Keep our own transport before removing the raw scope API.
const post = scope.postMessage.bind(self);

// Remove the constructor links commonly used to recover native dynamic-code
// functions from literals. The AST scanner rejects them too; this is
// worker-only defense in depth and does not alter the Node test environment.
for (const prototype of [
  Function.prototype,
  Object.getPrototypeOf(async function () {}),
  Object.getPrototypeOf(function* () {}),
  Object.getPrototypeOf(async function* () {}),
]) {
  try {
    Object.defineProperty(prototype, 'constructor', {
      value: undefined,
      writable: false,
      configurable: false,
    });
  } catch {
    // A browser may already expose a non-configurable hardened descriptor.
  }
}

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

self.onmessage = (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isRunRequest(request)) return;
  const outcome = executeProgram(request.code, { language: request.language });
  if (outcome.ok) {
    post(boundWorkerResponse({ type: 'trace', id: request.id, events: outcome.events }));
  } else {
    post(boundWorkerResponse({ type: 'compile-error', id: request.id, error: outcome.error }));
  }
};
