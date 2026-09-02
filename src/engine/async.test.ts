/** Promise, microtask, async/await and queueMicrotask semantics. */
import { describe, expect, it } from 'vitest';
import { allOf, consoleText, firstOf, run, statesFor } from './test-utils';

describe('promise basics', () => {
  it('defers .then callbacks until the stack empties', () => {
    const events = run(
      `Promise.resolve("v").then((v) => console.log("then", v));\nconsole.log("sync");`,
    );
    expect(consoleText(events)).toEqual(['sync', 'then v']);
  });

  it('runs microtasks in FIFO order', () => {
    const events = run(
      `Promise.resolve().then(() => console.log(1));\nPromise.resolve().then(() => console.log(2));\nPromise.resolve().then(() => console.log(3));`,
    );
    expect(consoleText(events)).toEqual(['1', '2', '3']);
  });

  it('executes the Promise constructor executor synchronously', () => {
    const events = run(
      `console.log("before");\nnew Promise(() => console.log("executor"));\nconsole.log("after");`,
    );
    expect(consoleText(events)).toEqual(['before', 'executor', 'after']);
  });

  it('resolves via resolve() and then chains values', () => {
    const events = run(
      `new Promise((resolve) => {\n  setTimeout(() => resolve(42), 10);\n}).then((v) => console.log("got", v));`,
    );
    expect(consoleText(events)).toEqual(['got 42']);
  });

  it('chains .then transformations', () => {
    const events = run(
      `Promise.resolve(1)\n  .then((v) => v + 1)\n  .then((v) => v * 10)\n  .then((v) => console.log(v));`,
    );
    expect(consoleText(events)).toEqual(['20']);
  });

  it('adopts returned promises (chaining)', () => {
    const events = run(
      `Promise.resolve()\n  .then(() => Promise.resolve("inner"))\n  .then((v) => console.log(v));`,
    );
    expect(consoleText(events)).toEqual(['inner']);
  });

  it('supports catch and finally', () => {
    const events = run(
      `Promise.reject(new Error("boom"))\n  .catch((e) => console.log("caught", e.message))\n  .finally(() => console.log("finally"));`,
    );
    expect(consoleText(events)).toEqual(['caught boom', 'finally']);
  });

  it('finally runs on the success path too', () => {
    const events = run(
      `Promise.resolve("ok")\n  .finally(() => console.log("cleanup"))\n  .then((v) => console.log(v));`,
    );
    expect(consoleText(events)).toEqual(['cleanup', 'ok']);
  });

  it('propagates throws inside then handlers to catch', () => {
    const events = run(
      `Promise.resolve()\n  .then(() => { throw new Error("thrown in then"); })\n  .catch((e) => console.log("caught:", e.message));`,
    );
    expect(consoleText(events)).toEqual(['caught: thrown in then']);
  });

  it('supports Promise.all', () => {
    const events = run(
      `Promise.all([Promise.resolve(1), Promise.resolve(2)]).then((xs) => console.log(xs.join(",")));`,
    );
    expect(consoleText(events)).toEqual(['1,2']);
  });

  it('supports Promise.race', () => {
    const events = run(
      `Promise.race([new Promise(() => {}), Promise.resolve("winner")]).then((v) => console.log(v));`,
    );
    expect(consoleText(events)).toEqual(['winner']);
  });

  it('detects chaining cycles', () => {
    const events = run(
      `const p = Promise.resolve().then(() => p);\np.catch((e) => console.log("cycle:", e.constructor.name));`,
    );
    expect(consoleText(events)).toEqual(['cycle: TypeError']);
  });

  it('adopts foreign thenables', () => {
    const events = run(
      `const thenable = {\n  then(resolve) {\n    setTimeout(() => resolve("from thenable"), 5);\n  },\n};\nPromise.resolve(thenable).then((v) => console.log(v));`,
    );
    expect(consoleText(events)).toEqual(['from thenable']);
  });
});

describe('microtask queue', () => {
  it('queues promise reactions as visible microtask events', () => {
    const events = run(`Promise.resolve().then(() => console.log("p"));`);
    const enq = allOf(events, 'microtask:enqueue');
    const deq = allOf(events, 'microtask:dequeue');
    expect(enq.length).toBeGreaterThanOrEqual(1);
    expect(deq.length).toBe(enq.length);
    expect(firstOf(events, 'microtask:enqueue')?.label).toBeTruthy();
  });

  it('always drains microtasks before the next task', () => {
    const events = run(
      `setTimeout(() => console.log("task"), 0);\nPromise.resolve().then(() => console.log("promise"));`,
    );
    expect(consoleText(events)).toEqual(['promise', 'task']);
  });

  it('drains microtasks queued by microtasks before the next task', () => {
    const events = run(
      `setTimeout(() => console.log("task"), 0);\nPromise.resolve().then(() => {\n  console.log("m1");\n  Promise.resolve().then(() => console.log("m2"));\n});`,
    );
    expect(consoleText(events)).toEqual(['m1', 'm2', 'task']);
  });

  it('supports queueMicrotask in FIFO with promise reactions', () => {
    const events = run(
      `Promise.resolve().then(() => console.log("promise"));\nqueueMicrotask(() => console.log("queued"));\nqueueMicrotask(function named() { console.log("named"); });`,
    );
    expect(consoleText(events)).toEqual(['promise', 'queued', 'named']);
  });

  it('survives errors inside queueMicrotask callbacks', () => {
    const events = run(
      `queueMicrotask(() => { throw new Error("mt boom"); });\nsetTimeout(() => console.log("later"), 0);`,
    );
    const texts = consoleText(events);
    expect(texts).toEqual(['later']);
    expect(firstOf(events, 'error')?.message).toContain('mt boom');
  });
});

describe('async/await', () => {
  it('runs the sync prefix immediately and defers the continuation', () => {
    const events = run(
      `async function run() {\n  console.log("A");\n  await Promise.resolve();\n  console.log("B");\n}\nrun();\nconsole.log("C");`,
    );
    expect(consoleText(events)).toEqual(['A', 'C', 'B']);
  });

  it('suspends and resumes the call stack frame visibly', () => {
    const events = run(`async function f() {\n  await Promise.resolve();\n}\nf();`);
    const suspend = allOf(events, 'stack:pop').find((e) => e.reason === 'suspend');
    const resume = allOf(events, 'stack:push').find((e) => e.reason === 'resume');
    expect(suspend?.name).toBe('f');
    expect(resume?.name).toBe('f');
  });

  it('handles multiple awaits in order', () => {
    const events = run(
      `async function f() {\n  console.log("1");\n  await Promise.resolve();\n  console.log("2");\n  await Promise.resolve();\n  console.log("3");\n}\nf();\nconsole.log("sync");`,
    );
    expect(consoleText(events)).toEqual(['1', 'sync', '2', '3']);
  });

  it('returns a thenable result that can be chained', () => {
    const events = run(
      `async function f() {\n  return 7;\n}\nf().then((v) => console.log("then", v));`,
    );
    expect(consoleText(events)).toEqual(['then 7']);
  });

  it('forwards awaited values', () => {
    const events = run(
      `async function f() {\n  const v = await Promise.resolve("payload");\n  console.log(v);\n}\nf();`,
    );
    expect(consoleText(events)).toEqual(['payload']);
  });

  it('awaits non-promise values with one microtask tick (matches V8)', () => {
    const events = run(
      `async function f() {\n  console.log("before");\n  await 5;\n  console.log("after");\n}\nf();\nPromise.resolve().then(() => console.log("between"));`,
    );
    expect(consoleText(events)).toEqual(['before', 'after', 'between']);
  });

  it('awaits inside timers (awaiting a timer-based promise)', () => {
    const events = run(
      `async function f() {\n  await new Promise((resolve) => setTimeout(resolve, 20));\n  console.log("resumed after timeout");\n}\nf();\nconsole.log("sync");`,
    );
    expect(consoleText(events)).toEqual(['sync', 'resumed after timeout']);
  });

  it('supports try/catch around await', () => {
    const events = run(
      `async function f() {\n  try {\n    await Promise.reject(new Error("nope"));\n    console.log("unreachable");\n  } catch (e) {\n    console.log("caught", e.message);\n  }\n}\nf();`,
    );
    expect(consoleText(events)).toEqual(['caught nope']);
  });

  it('routes async function throws to .catch', () => {
    const events = run(
      `async function f() {\n  throw new Error("async boom");\n}\nf().catch((e) => console.log("caught:", e.message));`,
    );
    expect(consoleText(events)).toEqual(['caught: async boom']);
  });

  it('supports async arrow functions', () => {
    const events = run(
      `const work = async () => {\n  console.log("arrow start");\n  await Promise.resolve();\n  console.log("arrow end");\n};\nwork();\nconsole.log("main");`,
    );
    expect(consoleText(events)).toEqual(['arrow start', 'main', 'arrow end']);
  });

  it('supports async methods in objects and classes', () => {
    const events = run(
      `const obj = {\n  async load() {\n    await Promise.resolve();\n    return "obj";\n  },\n};\nclass Service {\n  async fetch() {\n    await Promise.resolve();\n    return "class";\n  }\n}\nobj.load().then(console.log);\nnew Service().fetch().then(console.log);`,
    );
    expect(consoleText(events)).toEqual(['obj', 'class']);
  });

  it('supports await in loops', () => {
    const events = run(
      `async function f() {\n  for (let i = 0; i < 3; i++) {\n    await Promise.resolve();\n    console.log("iter", i);\n  }\n}\nf();`,
    );
    expect(consoleText(events)).toEqual(['iter 0', 'iter 1', 'iter 2']);
  });

  it('resolves the frame visually on the awaited example', () => {
    const events = run(
      `async function f() {\n  await Promise.resolve();\n}\nf();\nconsole.log("sync");`,
    );
    const states = statesFor(
      `async function f() {\n  await Promise.resolve();\n}\nf();\nconsole.log("sync");`,
    );
    const suspendIndex = events.findIndex(
      (e) => e.type === 'stack:pop' && e.reason === 'suspend' && e.name === 'f',
    );
    expect(suspendIndex).toBeGreaterThan(0);
    // While suspended, the frame is off the stack even though the global
    // segment is still running.
    expect(states[suspendIndex + 1]?.stack.some((fr) => fr.name === 'f')).toBe(false);
    const end = states[states.length - 1]!;
    expect(end.stack).toEqual([]);
  });
});

describe('the canonical ordering example', () => {
  it('produces the documented Start/Promise/Timeout ordering', () => {
    const events = run(
      `console.log("Start");\n\nsetTimeout(() => {\n  console.log("Timeout");\n}, 0);\n\nPromise.resolve().then(() => {\n  console.log("Promise");\n});\n\nasync function load() {\n  console.log("Before await");\n  await Promise.resolve();\n  console.log("After await");\n}\n\nload();\n\nconsole.log("End");`,
    );
    expect(consoleText(events)).toEqual([
      'Start',
      'Before await',
      'End',
      'Promise',
      'After await',
      'Timeout',
    ]);
  });
});
