/**
 * Built-in example presets. Examples are plain editable code — the engine has
 * no special-casing whatsoever for any of them.
 */
import type { SourceLanguage } from './types';

export interface Example {
  id: string;
  name: string;
  description: string;
  language: SourceLanguage;
  code: string;
}

export const DEFAULT_EXAMPLE_ID = 'welcome';

export const EXAMPLES: Example[] = [
  {
    id: DEFAULT_EXAMPLE_ID,
    name: 'Welcome / Mixed Event Loop',
    language: 'javascript',
    description:
      'Timers, promises and async/await combined. Watch why the output order is what it is.',
    code: `console.log("Start");

setTimeout(() => {
  console.log("Timeout");
}, 0);

Promise.resolve().then(() => {
  console.log("Promise");
});

async function load() {
  console.log("Before await");
  await Promise.resolve();
  console.log("After await");
}

load();

console.log("End");
`,
  },
  {
    id: 'sync-call-stack',
    name: 'Synchronous Call Stack',
    language: 'javascript',
    description: 'Frames are pushed and popped strictly in call order — no async involved.',
    code: `function greet(name) {
  return "Hello, " + name + "!";
}

function run() {
  const message = greet("Ada");
  console.log(message);
}

console.log("before run");
run();
console.log("after run");
`,
  },
  {
    id: 'settimeout',
    name: 'setTimeout',
    language: 'javascript',
    description: 'A timer hands its callback to the Web APIs and runs it as a later task.',
    code: `console.log("A");

setTimeout(() => {
  console.log("B");
}, 0);

console.log("C");
`,
  },
  {
    id: 'multiple-timers',
    name: 'Multiple Timers',
    language: 'javascript',
    description: 'Timers fire in delay order, not in registration order.',
    code: `setTimeout(() => console.log("100ms"), 100);
setTimeout(() => console.log("0ms"), 0);
setTimeout(() => console.log("50ms"), 50);

console.log("scheduled");
`,
  },
  {
    id: 'promise-microtask',
    name: 'Promise Microtask',
    language: 'javascript',
    description: '.then callbacks are microtasks: they run right after the current stack.',
    code: `Promise.resolve("value").then((v) => {
  console.log("then:", v);
});

console.log("sync");
`,
  },
  {
    id: 'promise-vs-settimeout',
    name: 'Promise vs setTimeout',
    language: 'javascript',
    description: 'The Microtask Queue always drains before the next task.',
    code: `console.log("A");

setTimeout(() => console.log("timer"), 0);

Promise.resolve().then(() => console.log("promise"));

console.log("B");
`,
  },
  {
    id: 'async-await',
    name: 'async / await',
    language: 'javascript',
    description: 'await suspends the function; the rest of the sync code keeps running.',
    code: `async function run() {
  console.log("A");
  await Promise.resolve();
  console.log("B");
}

run();
console.log("C");
`,
  },
  {
    id: 'multiple-await',
    name: 'Multiple await',
    language: 'javascript',
    description: 'Each await suspends and resumes through the Microtask Queue.',
    code: `async function step() {
  console.log("start");

  const value = await Promise.resolve("one");
  console.log("got:", value);

  await new Promise((resolve) => {
    setTimeout(resolve, 30);
  });
  console.log("after awaited timeout");

  await Promise.resolve();
  console.log("end");
}

step();
console.log("main continues");
`,
  },
  {
    id: 'queue-microtask',
    name: 'queueMicrotask',
    language: 'javascript',
    description: 'queueMicrotask, promises and timers all meet: guess the order first.',
    code: `console.log("start");

queueMicrotask(() => console.log("microtask"));

setTimeout(() => console.log("task"), 0);

Promise.resolve().then(() => console.log("promise"));

console.log("end");
`,
  },
  {
    id: 'promise-rejection',
    name: 'Promise rejection',
    language: 'javascript',
    description: 'Rejections travel through .catch like values travel through .then.',
    code: `Promise.reject(new Error("boom"))
  .then(() => console.log("skipped"))
  .catch((err) => console.log("caught:", err.message));

async function risky() {
  throw new Error("async failure");
}

risky().catch((e) => console.log("async caught:", e.message));

Promise.reject("nobody handles me");
`,
  },
  {
    id: 'mixed-event-loop',
    name: 'Mixed Event Loop',
    language: 'javascript',
    description: 'Chained microtasks, an async function and a task interleaved.',
    code: `console.log("1: sync start");

setTimeout(() => console.log("4: task"), 0);

Promise.resolve()
  .then(() => console.log("3: microtask"))
  .then(() => console.log("3b: chained microtask"));

async function flow() {
  console.log("2: async starts synchronously");
  await null;
  console.log("3c: after await");
}

flow();

console.log("2b: sync end");
`,
  },
  {
    id: 'typescript-async-flow',
    name: 'TypeScript async flow',
    language: 'typescript',
    description:
      'Types disappear at runtime; async/await still resumes through the Microtask Queue.',
    code: `interface Learner {
  name: string;
  delay: number;
}

async function study(learner: Learner): Promise<void> {
  console.log("start:", learner.name);
  await Promise.resolve();
  console.log("after await");

  setTimeout(() => {
    console.log("timer:", learner.delay);
  }, learner.delay);
}

const learner: Learner = { name: "Ada", delay: 20 };
study(learner);
console.log("scheduled");
`,
  },
];

export function getExample(id: string): Example {
  return EXAMPLES.find((example) => example.id === id) ?? EXAMPLES[0]!;
}
