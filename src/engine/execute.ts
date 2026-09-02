/**
 * executeProgram: compiles and records a full execution of user code.
 *
 * This is the engine's public entry point. It is environment-agnostic: the
 * same function runs inside the sandbox worker in production and directly in
 * Node during unit tests. The whole recording is synchronous; nothing in it
 * touches native asynchronous machinery.
 */
import { compile } from './compile';
import { configurePromiseHost, resetPromiseHost } from './runtime/promise';
import { VirtualScheduler } from './runtime/scheduler';
import { createRuntime, type RuntimeHandles, type SandboxGlobals } from './runtime/handles';
import { DEFAULT_LIMITS, type EngineLimits, type RunOutcome, type SourceLanguage } from './types';

export interface ExecuteOptions {
  language?: SourceLanguage;
  limits?: EngineLimits;
}

export function executeProgram(
  source: string,
  options: EngineLimits | ExecuteOptions = DEFAULT_LIMITS,
): RunOutcome {
  const limits = 'maxTicks' in options ? options : (options.limits ?? DEFAULT_LIMITS);
  const language = 'maxTicks' in options ? 'javascript' : (options.language ?? 'javascript');
  const compiled = compile(source, language);
  if (!compiled.ok) {
    return { ok: false, error: compiled.error };
  }

  const scheduler = new VirtualScheduler(limits);
  const { handles, globals } = createRuntime(scheduler);
  configurePromiseHost(scheduler);

  // Shadow every sandboxed global through function parameters. This keeps the
  // sandbox deterministic across environments (Node tests vs. the worker) —
  // the real platform globals are simply never visible to user code.
  const program = new Function(
    '__AS__',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'queueMicrotask',
    'Promise',
    'console',
    `"use strict";\n${compiled.code}`,
  ) as (handles: RuntimeHandles, ...globals: unknown[]) => unknown;

  scheduler.pushEvent({ type: 'execution:start' });
  try {
    scheduler.runProtected(() => runUserProgram(program, handles, globals));
    if (scheduler.fatal === null) {
      scheduler.drive();
    }
  } finally {
    resetPromiseHost();
  }
  scheduler.pushTerminalEvent({
    type: 'execution:end',
    ok: !scheduler.fatal && !scheduler.hadError,
  });

  return { ok: true, events: scheduler.events };
}

function runUserProgram(
  program: (handles: RuntimeHandles, ...globals: unknown[]) => unknown,
  handles: RuntimeHandles,
  globals: SandboxGlobals,
): void {
  program(
    handles,
    globals.setTimeout,
    globals.clearTimeout,
    globals.setInterval,
    globals.clearInterval,
    globals.queueMicrotask,
    globals.Promise,
    globals.console,
  );
}
