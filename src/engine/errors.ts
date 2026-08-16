/**
 * Internal error taxonomy for the engine.
 *
 * These classes never leave the engine as exceptions: they are classified and
 * converted into trace events (or {@link CompileError} values) so the UI can
 * always render something useful.
 */

/** Thrown when a resource limit is exceeded while recording. Always fatal. */
export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LimitError';
  }
}

/** Thrown by the sandbox when user code misuses a sandboxed API. */
export class SandboxApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxApiError';
  }
}

/** Formats a caught value the way browsers render uncaught exceptions. */
export function formatThrownValue(value: unknown): string {
  if (value instanceof Error) {
    const name = value.name || 'Error';
    const message = value.message ? `: ${value.message}` : '';
    return `${name}${message}`;
  }
  if (typeof value === 'string') return `Uncaught ${value}`;
  return `Uncaught ${String(value)}`;
}
