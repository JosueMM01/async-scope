/** Core execution semantics: sync code, call stack, timers, event loop order. */
import { describe, expect, it } from 'vitest';
import { executeProgram } from './execute';
import { allOf, consoleText, firstOf, run, statesFor, typeSeq } from './test-utils';

describe('synchronous execution', () => {
  it('runs statements in order', () => {
    const events = run(`console.log("A");\nconsole.log("B");`);
    expect(consoleText(events)).toEqual(['A', 'B']);
  });

  it('pushes and pops frames in call order, including the global frame', () => {
    const events = run(`function inner() {}\nfunction outer() { inner(); }\nouter();`);
    const pushes = allOf(events, 'stack:push');
    const pops = allOf(events, 'stack:pop');
    expect(pushes.map((e) => e.name)).toEqual(['(global)', 'outer', 'inner']);
    expect(pops.map((e) => e.reason)).toEqual(['return', 'return', 'return']);
  });

  it('names frames from assignment positions', () => {
    const events = run(`const fn = function () {};\nconst arrow = () => {};\nfn();\narrow();`);
    const names = allOf(events, 'stack:push').map((e) => e.name);
    expect(names).toEqual(['(global)', 'fn', 'arrow']);
  });

  it('tracks the currently executing line', () => {
    const events = run(`console.log("A");\nconsole.log("B");`);
    const locs = allOf(events, 'loc').map((e) => e.to);
    expect(locs).toEqual([1, 2]);
    const logLines = allOf(events, 'console').map((e) => e.line);
    expect(logLines).toEqual([1, 2]);
  });

  it('tracks the line inside nested function calls', () => {
    const events = run(`function f() {\n  console.log("in");\n}\nf();`);
    const log = firstOf(events, 'console');
    expect(log?.line).toBe(2);
  });

  it('handles recursion', () => {
    const events = run(
      `function fact(n) {\n  if (n <= 1) return 1;\n  return n * fact(n - 1);\n}\nconsole.log(fact(4));`,
    );
    expect(consoleText(events)).toEqual(['24']);
    const pushes = allOf(events, 'stack:push').filter((e) => e.name === 'fact');
    expect(pushes.length).toBe(4);
  });

  it('supports loops, classes, destructuring and template literals', () => {
    const events = run(`
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
const { x, y } = { x: 1, y: 2 };
const p = new Point(x, y);
let total = 0;
for (let i = 0; i < 3; i++) {
  total += i;
}
console.log(\`\${p.sum()} \${total}\`);
`);
    expect(consoleText(events)).toEqual(['3 3']);
  });
});

describe('timers and the task queue', () => {
  it('defers setTimeout callbacks until the stack is empty', () => {
    const events = run(
      `console.log("A");\nsetTimeout(() => {\n  console.log("B");\n}, 0);\nconsole.log("C");`,
    );
    expect(consoleText(events)).toEqual(['A', 'C', 'B']);
  });

  it('fires timers in delay order, not registration order', () => {
    const events = run(
      `setTimeout(() => console.log("100"), 100);\nsetTimeout(() => console.log("0"), 0);\nsetTimeout(() => console.log("50"), 50);`,
    );
    expect(consoleText(events)).toEqual(['0', '50', '100']);
  });

  it('breaks delay ties in registration order', () => {
    const events = run(
      `setTimeout(() => console.log("first"), 10);\nsetTimeout(() => console.log("second"), 10);`,
    );
    expect(consoleText(events)).toEqual(['first', 'second']);
  });

  it('clearTimeout removes the timer', () => {
    const events = run(
      `const id = setTimeout(() => console.log("nope"), 10);\nclearTimeout(id);\nsetTimeout(() => console.log("yes"), 20);`,
    );
    expect(consoleText(events)).toEqual(['yes']);
    expect(allOf(events, 'api:clear').length).toBe(1);
    // Timer #1 was cleared and must never complete or enqueue a task.
    expect(allOf(events, 'api:complete').every((e) => e.timerId !== 1)).toBe(true);
    expect(allOf(events, 'task:enqueue').every((e) => e.timerId !== 1)).toBe(true);
  });

  it('schedules the api, completes it and dequeues the task in order', () => {
    const events = run(`setTimeout(() => console.log("x"), 5);`);
    const seq = typeSeq(events);
    const scheduleAt = seq.indexOf('api:schedule');
    const completeAt = seq.indexOf('api:complete');
    const enqueueAt = seq.indexOf('task:enqueue');
    const dequeueAt = seq.indexOf('task:dequeue');
    const consoleAt = seq.indexOf('console');
    expect([scheduleAt, completeAt, enqueueAt, dequeueAt, consoleAt]).toEqual(
      expect.arrayContaining([0, 1, 2, 3, 4].map(() => expect.any(Number))),
    );
    expect(scheduleAt).toBeLessThan(completeAt);
    expect(completeAt).toBeLessThan(enqueueAt);
    expect(enqueueAt).toBeLessThan(dequeueAt);
    expect(dequeueAt).toBeLessThan(consoleAt);
  });

  it('runs setInterval repeatedly and honors clearInterval', () => {
    const events = run(
      `let n = 0;\nconst id = setInterval(() => {\n  n++;\n  console.log("tick", n);\n  if (n >= 3) clearInterval(id);\n}, 10);`,
    );
    expect(consoleText(events)).toEqual(['tick 1', 'tick 2', 'tick 3']);
  });

  it('advances virtual time between due timers', () => {
    const events = run(`setTimeout(() => console.log("late"), 1000);`);
    const advance = firstOf(events, 'time:advance');
    expect(advance?.to).toBe(1000);
  });

  it('drains microtasks between tasks', () => {
    const events = run(
      `setTimeout(() => {\n  Promise.resolve().then(() => console.log("micro"));\n  console.log("task1");\n}, 0);\nsetTimeout(() => console.log("task2"), 0);`,
    );
    expect(consoleText(events)).toEqual(['task1', 'micro', 'task2']);
  });

  it('rejects non-function timer callbacks with a clear error', () => {
    const events = run(`console.log("before");\nsetTimeout(42, 0);`);
    expect(consoleText(events)).toEqual(['before']);
    const error = firstOf(events, 'error');
    expect(error?.message).toContain('setTimeout expects a function');
  });
});

describe('event loop narration', () => {
  it('emits loop:turn events around drains and tasks', () => {
    const events = run(`setTimeout(() => console.log("t"), 5);`);
    const actions = allOf(events, 'loop:turn').map((e) => e.action);
    expect(actions).toContain('advance-time');
    expect(actions).toContain('run-task');
  });

  it('brackets execution with start and end', () => {
    const events = run(`console.log("x");`);
    expect(events[0]?.type).toBe('execution:start');
    expect(events[events.length - 1]?.type).toBe('execution:end');
    expect(events[events.length - 1]).toMatchObject({ type: 'execution:end', ok: true });
  });
});

describe('determinism', () => {
  it('produces identical traces across runs', () => {
    const source = `setTimeout(() => console.log("t"), 5);\nPromise.resolve().then(() => console.log("p"));\nasync function f() { await null; console.log("a"); }\nf();`;
    const a = executeProgram(source);
    const b = executeProgram(source);
    expect(a).toEqual(b);
  });

  it('does not leak state between runs (timers, promises)', () => {
    run(`setTimeout(() => console.log("one"), 10);`);
    const events = run(`console.log("two");`);
    expect(consoleText(events)).toEqual(['two']);
  });
});

describe('visualization states', () => {
  it('exposes one state per event plus the initial state', () => {
    const events = run(`console.log("A");`);
    const states = statesFor(`console.log("A");`);
    expect(states.length).toBe(events.length + 1);
    expect(states[0]).toMatchObject({ status: 'running', stack: [], console: [] });
    expect(states[states.length - 1]?.status).toBe('complete');
  });

  it('shows the timer moving from Web APIs to Task Queue to gone', () => {
    const states = statesFor(`setTimeout(() => console.log("x"), 10);`);
    const withApi = states.filter((s) => s.apis.length === 1);
    const withTask = states.filter((s) => s.tasks.length === 1);
    expect(withApi.length).toBeGreaterThan(0);
    expect(withTask.length).toBeGreaterThan(0);
    const end = states[states.length - 1]!;
    expect(end.apis).toEqual([]);
    expect(end.tasks).toEqual([]);
  });

  it('computes remaining time on the clock advance', () => {
    const states = statesFor(
      `setTimeout(() => console.log("x"), 40);\nsetTimeout(() => console.log("y"), 90);`,
    );
    const atForty = states.find((s) => s.virtualTime === 40);
    const second = atForty?.apis.find((t) => t.timerId === 2);
    expect(second?.remaining).toBe(50);
  });

  it('steps backwards purely by index (previous step)', () => {
    const states = statesFor(`console.log("A");\nsetTimeout(() => console.log("B"), 0);`);
    const before = states[states.length - 2]!;
    const after = states[states.length - 1]!;
    expect(before.stack.length).toBeGreaterThanOrEqual(after.stack.length);
  });
});
