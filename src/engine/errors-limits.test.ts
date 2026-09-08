/** Compile-time errors, unsupported features, limits and sandbox safety. */
import { describe, expect, it } from 'vitest';
import { executeProgram } from './execute';
import { DEFAULT_LIMITS, type EngineLimits } from './types';
import { allOf, consoleText, firstOf, run } from './test-utils';

const TIGHT_LIMITS: EngineLimits = {
  ...DEFAULT_LIMITS,
  maxTicks: 5_000,
  wallClockMs: 5_000,
  maxEvents: 2_000,
  maxTasksRun: 50,
  maxMicrotasks: 5_000,
};

describe('syntax errors', () => {
  it('reports a syntax error with its line', () => {
    const outcome = executeProgram('console.log("a");\nconst = broken;');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.phase).toBe('syntax');
      expect(outcome.error.line).toBe(2);
      expect(outcome.error.message).toBeTruthy();
    }
  });

  it('rejects JSX (not supported)', () => {
    const outcome = executeProgram('const x = <div>hi</div>;');
    expect(outcome.ok).toBe(false);
  });

  it('rejects import statements with a syntax error', () => {
    const outcome = executeProgram('import x from "y";');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.phase).toBe('syntax');
  });
});

describe('unsupported features', () => {
  it('blocks for await…of with a helpful message', () => {
    const outcome = executeProgram('async function f() {\n  for await (const x of []) {}\n}');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.phase).toBe('unsupported');
      expect(outcome.error.message).toContain('for await');
    }
  });

  it('blocks user generator functions', () => {
    const outcome = executeProgram('function* g() { yield 1; }');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.phase).toBe('unsupported');
      expect(outcome.error.message).toContain('generator');
    }
  });

  it('blocks fetch with a network explanation', () => {
    const outcome = executeProgram('fetch("https://example.com");');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.phase).toBe('unsupported');
      expect(outcome.error.message).toContain('fetch');
      expect(outcome.error.message).toContain('network');
    }
  });

  it('blocks eval and Function', () => {
    expect(executeProgram('eval("1+1");').ok).toBe(false);
    expect(executeProgram('const F = Function("return 1");').ok).toBe(false);
  });

  it('blocks constructor-chain dynamic code escapes', () => {
    const direct = executeProgram('const root = (() => {}).constructor("return this")();');
    const computed = executeProgram('const root = (() => {})["constructor"]("return this")();');
    const joined = executeProgram('const root = (() => {})["con" + "structor"]("return this")();');
    const optional = executeProgram('const root = (() => {})?.constructor("return this")();');
    expect(direct.ok).toBe(false);
    expect(computed.ok).toBe(false);
    expect(joined.ok).toBe(false);
    expect(optional.ok).toBe(false);
    if (!direct.ok) expect(direct.error.message).toContain('constructor');
  });

  it('blocks globalThis and self escapes', () => {
    expect(executeProgram('globalThis.setTimeout(() => {}, 0);').ok).toBe(false);
    expect(executeProgram('self.setTimeout(() => {}, 0);').ok).toBe(false);
  });

  it('blocks document and window references', () => {
    expect(executeProgram('document.querySelector("body");').ok).toBe(false);
    expect(executeProgram('window.location = "x";').ok).toBe(false);
  });

  it('allows locals that shadow blocked names', () => {
    const events = run('const fetch = 1;\nconsole.log(fetch);');
    expect(consoleText(events)).toEqual(['1']);
  });

  it('blocks dynamic import()', () => {
    const outcome = executeProgram('import("./other.js");');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.phase).toBe('unsupported');
  });
});

describe('runtime errors', () => {
  it('records a synchronous throw and continues scheduled work', () => {
    const events = run(
      `setTimeout(() => console.log("timer still fires"), 0);\nthrow new Error("sync boom");`,
    );
    expect(consoleText(events)).toEqual(['timer still fires']);
    const error = firstOf(events, 'error');
    expect(error?.kind).toBe('sync');
    expect(error?.message).toContain('Error: sync boom');
  });

  it('unwinds the call stack on a throw', () => {
    const events = run(
      `function a() {\n  b();\n}\nfunction b() {\n  throw new Error("deep");\n}\ntry { a(); } catch (e) {}`,
    );
    const unwindPops = allOf(events, 'stack:pop').filter((e) => e.reason === 'error');
    expect(unwindPops.length).toBe(0); // try/finally in wrappers popped normally
    const names = allOf(events, 'stack:pop').map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['b', 'a']));
  });

  it('errors inside timer callbacks do not stop later tasks', () => {
    const events = run(
      `setTimeout(() => { throw new Error("t1"); }, 0);\nsetTimeout(() => console.log("t2 ok"), 0);`,
    );
    expect(consoleText(events)).toEqual(['t2 ok']);
    expect(firstOf(events, 'error')?.message).toContain('t1');
  });

  it('reports unhandled rejections', () => {
    const events = run(
      `Promise.reject(new Error("unhandled"));\nsetTimeout(() => console.log("after"), 0);`,
    );
    const error = firstOf(events, 'error');
    expect(error?.kind).toBe('unhandled-rejection');
    expect(error?.message).toContain('Uncaught (in promise) Error: unhandled');
    expect(consoleText(events)).toEqual(['after']);
    expect(events.at(-1)).toMatchObject({ type: 'execution:end', ok: false });
  });

  it('does not report rejections handled later in the same drain', () => {
    const events = run(
      `const p = Promise.reject(new Error("late catch"));\np.catch((e) => console.log("handled"));\np.catch(() => {});`,
    );
    const errors = allOf(events, 'error');
    expect(errors.length).toBe(0);
    expect(consoleText(events)).toEqual(['handled']);
  });

  it('reports uncaught errors inside async functions as unhandled rejections', () => {
    const events = run(`async function f() {\n  throw new Error("async uncaught");\n}\nf();`);
    const error = firstOf(events, 'error');
    expect(error?.kind).toBe('unhandled-rejection');
    expect(error?.message).toContain('async uncaught');
  });

  it('marks the execution:end event as failed when errors happened', () => {
    const events = run(`throw new Error("x");`);
    expect(events[events.length - 1]).toMatchObject({ type: 'execution:end', ok: false });
  });
});

describe('limits and safety', () => {
  it('keeps traces bounded while preserving the first terminal error and execution:end', () => {
    const outcome = executeProgram(
      'for (let i = 0; i < 500; i++) Promise.reject(new Error(`reject ${i}`));',
      { ...TIGHT_LIMITS, maxEvents: 40 },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.events.length).toBeLessThanOrEqual(42);
      expect(outcome.events.some((event) => event.type === 'error')).toBe(true);
      expect(outcome.events.at(-1)).toMatchObject({ type: 'execution:end', ok: false });
    }
  });

  it('stops infinite while loops with a limit error', () => {
    const events = executeProgram('while (true) {}', TIGHT_LIMITS);
    expect(events.ok).toBe(true);
    if (events.ok) {
      const error = firstOf(events.events, 'error');
      expect(error?.kind).toBe('limit');
      expect(error?.message).toContain('infinite loop');
      expect(events.events[events.events.length - 1]).toMatchObject({
        type: 'execution:end',
        ok: false,
      });
    }
  });

  it('stops infinite for loops with empty bodies', () => {
    const events = executeProgram('for (;;) ;', TIGHT_LIMITS);
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(firstOf(events.events, 'error')?.kind).toBe('limit');
    }
  });

  it('stops runaway setInterval via the task limit', () => {
    const events = executeProgram('setInterval(() => {}, 1);', TIGHT_LIMITS);
    expect(events.ok).toBe(true);
    if (events.ok) {
      const error = firstOf(events.events, 'error');
      expect(error?.kind).toBe('limit');
      expect(error?.message).toContain('task');
    }
  });

  it('stops infinite microtask cascades', () => {
    const events = executeProgram(
      'function loop() { Promise.resolve().then(loop); } loop();',
      TIGHT_LIMITS,
    );
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(firstOf(events.events, 'error')?.kind).toBe('limit');
    }
  });

  it('stops infinite async/await loops', () => {
    const events = executeProgram(
      'async function f() { while (true) { await Promise.resolve(); } } f();',
      TIGHT_LIMITS,
    );
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(firstOf(events.events, 'error')?.kind).toBe('limit');
    }
  });

  it('stops unbounded recursion with a stack overflow', () => {
    const events = executeProgram('function r() { r(); } r();', TIGHT_LIMITS);
    expect(events.ok).toBe(true);
    if (events.ok) {
      const error = firstOf(events.events, 'error');
      expect(error?.message).toContain('Maximum call stack size exceeded');
    }
  });

  it('caps the number of active timers', () => {
    const limits = { ...TIGHT_LIMITS, maxTimers: 10 };
    const events = executeProgram(
      'for (let i = 0; i < 2000; i++) setTimeout(() => {}, 1000000 + i);',
      limits,
    );
    expect(events.ok).toBe(true);
    if (events.ok) {
      const error = firstOf(events.events, 'error');
      expect(error?.kind).toBe('limit');
      expect(error?.message).toContain('timers');
    }
  });

  it('caps the trace event count', () => {
    const events = executeProgram(
      'for (let i = 0; i < 1000; i++) { console.log(i); }',
      TIGHT_LIMITS,
    );
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(firstOf(events.events, 'error')?.kind).toBe('limit');
      expect(events.events.length).toBeLessThanOrEqual(TIGHT_LIMITS.maxEvents + 5);
    }
  });
});

describe('sandbox isolation', () => {
  it('sandbox setTimeout is not the host setTimeout', () => {
    const events = run('console.log(typeof setTimeout, setTimeout.length);');
    // Our wrapper has length 2 declared params.
    expect(consoleText(events)).toEqual(['function 2']);
  });

  it('sandbox Promise is not the host Promise', () => {
    const events = run('console.log(Promise.resolve(1) instanceof Promise, typeof Promise.all);');
    expect(consoleText(events)).toEqual(['true function']);
  });

  it('cannot see the AsyncScope runtime', () => {
    const outcome = executeProgram('__AS__.enter("fake", 1);');
    expect(outcome.ok).toBe(false);
  });
});
