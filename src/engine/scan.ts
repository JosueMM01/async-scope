/**
 * Static analysis over the user's AST that runs before any transformation.
 *
 * Phase 1 supports a well-defined subset of JavaScript. Rather than failing
 * with a confusing runtime error, unsupported constructs and sandboxed-away
 * globals are detected here and reported with an actionable message.
 */
import type * as t from '@babel/types';
import { traverse } from './babel';

/** Error thrown when the scanner finds an unsupported construct. */
export class UnsupportedFeatureError extends Error {
  readonly line: number | null;

  constructor(message: string, line: number | null) {
    super(message);
    this.name = 'UnsupportedFeatureError';
    this.line = line;
  }
}

/**
 * Globals that must not be referenced. The key is the identifier name; the
 * value is a human-readable reason shown to the user.
 */
const BLOCKED_GLOBALS: Record<string, string> = {
  __AS__: 'the AsyncScope runtime is internal',
  // network
  fetch: 'network requests are disabled',
  XMLHttpRequest: 'network requests are disabled',
  WebSocket: 'network requests are disabled',
  EventSource: 'network requests are disabled',
  sendBeacon: 'network requests are disabled',
  // sandbox escape / host access
  postMessage: 'messaging the host page is disabled',
  close: 'terminating the sandbox is handled by the Stop button',
  importScripts: 'loading remote scripts is disabled',
  self: 'the sandbox has no direct global scope access',
  globalThis: 'the sandbox has no direct global scope access',
  window: 'there is no window inside the sandbox',
  document: 'there is no DOM inside the sandbox',
  navigator: 'there is no DOM inside the sandbox',
  location: 'there is no DOM inside the sandbox',
  history: 'there is no DOM inside the sandbox',
  alert: 'blocking dialogs are disabled',
  confirm: 'blocking dialogs are disabled',
  prompt: 'blocking dialogs are disabled',
  open: 'opening windows is disabled',
  Worker: 'nested workers are disabled',
  SharedWorker: 'nested workers are disabled',
  indexedDB: 'storage APIs are disabled',
  caches: 'storage APIs are disabled',
  localStorage: 'storage APIs are disabled',
  sessionStorage: 'storage APIs are disabled',
  crypto: 'the Web Crypto API is not available in the sandbox',
  // rendering pipeline (Phase 3)
  requestAnimationFrame: 'the rendering pipeline is not supported in Phase 1',
  requestIdleCallback: 'the rendering pipeline is not supported in Phase 1',
  // DOM events (Phase 3)
  addEventListener: 'DOM events are not supported in Phase 1',
  removeEventListener: 'DOM events are not supported in Phase 1',
  dispatchEvent: 'DOM events are not supported in Phase 1',
  // dynamic code / powerful natives that bypass the sandbox model
  eval: 'eval is disabled in the sandbox',
  Function: 'dynamic code generation is disabled',
  WebAssembly: 'WebAssembly is disabled in the sandbox',
  SharedArrayBuffer: 'SharedArrayBuffer is disabled in the sandbox',
  Atomics: 'Atomics is disabled in the sandbox',
};

function unsupported(message: string, node: t.Node): never {
  throw new UnsupportedFeatureError(message, node.loc?.start.line ?? null);
}

/**
 * Throws {@link UnsupportedFeatureError} when the AST contains constructs
 * outside the supported subset or references blocked globals.
 */
export function scanForUnsupportedFeatures(ast: t.Node): void {
  traverse(ast, {
    ForOfStatement(path) {
      if (path.node.await) {
        unsupported('for await…of loops are not supported in Phase 1', path.node);
      }
    },
    'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod|ClassPrivateMethod'(
      path,
    ) {
      const node = path.node as t.Function;
      if (node.generator) {
        unsupported(
          'generator functions (function*) are not supported in Phase 1',
          path.node,
        );
      }
    },
    YieldExpression(path) {
      unsupported('yield is not supported in Phase 1', path.node);
    },
    CallExpression(path) {
      if (path.node.callee.type === 'Import') {
        unsupported('dynamic import() is not supported', path.node);
      }
    },
    ReferencedIdentifier(path) {
      const name = path.node.name;
      const reason = BLOCKED_GLOBALS[name];
      if (reason !== undefined && !path.scope.getBinding(name)) {
        unsupported(`"${name}" is not available in the AsyncScope sandbox: ${reason}`, path.node);
      }
    },
  });
}
