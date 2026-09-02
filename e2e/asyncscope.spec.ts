/**
 * E2E coverage for Phase 1, following the ten scenarios from the spec:
 * sync, timer, promise-vs-timer, async/await, queueMicrotask, rejected
 * promise, syntax error, infinite execution, restart and custom code.
 */
import { expect, test } from '@playwright/test';
import { consoleLines, runAndWait, selectExample, setEditorCode } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AsyncScope' })).toBeVisible();
  // Start from a known editor state for every test.
  await page.evaluate(() => {
    window.localStorage.removeItem('asyncscope:source');
    window.localStorage.removeItem('asyncscope:language');
  });
  await page.reload();
});

test('1 — synchronous code logs in order', async ({ page }) => {
  await setEditorCode(page, 'console.log("A");\nconsole.log("B");');
  await runAndWait(page);
  await expect.poll(() => consoleLines(page)).toEqual(['A', 'B']);
});

test('2 — setTimeout defers its callback after the sync code', async ({ page }) => {
  await setEditorCode(
    page,
    'console.log("A");\n\nsetTimeout(() => {\n  console.log("B");\n}, 0);\n\nconsole.log("C");',
  );
  await runAndWait(page);
  await expect.poll(() => consoleLines(page)).toEqual(['A', 'C', 'B']);
});

test('3 — promises run before timers', async ({ page }) => {
  await setEditorCode(
    page,
    'console.log("A");\n\nsetTimeout(() => console.log("timer"), 0);\n\nPromise.resolve().then(() => console.log("promise"));\n\nconsole.log("B");',
  );
  await runAndWait(page);
  await expect.poll(() => consoleLines(page)).toEqual(['A', 'B', 'promise', 'timer']);
});

test('4 — async/await defers the continuation', async ({ page }) => {
  await setEditorCode(
    page,
    'async function run() {\n  console.log("A");\n  await Promise.resolve();\n  console.log("B");\n}\n\nrun();\nconsole.log("C");',
  );
  await runAndWait(page);
  await expect.poll(() => consoleLines(page)).toEqual(['A', 'C', 'B']);
});

test('5 — queueMicrotask runs between sync code and tasks', async ({ page }) => {
  await setEditorCode(
    page,
    'console.log("start");\nqueueMicrotask(() => console.log("microtask"));\nsetTimeout(() => console.log("task"), 0);\nPromise.resolve().then(() => console.log("promise"));\nconsole.log("end");',
  );
  await runAndWait(page);
  await expect
    .poll(() => consoleLines(page))
    .toEqual(['start', 'end', 'microtask', 'promise', 'task']);
});

test('6 — a rejected promise does not break the app', async ({ page }) => {
  await setEditorCode(
    page,
    'Promise.reject(new Error("boom")).catch((e) => console.log("caught:", e.message));\nconsole.log("after");',
  );
  await runAndWait(page);
  await expect.poll(() => consoleLines(page)).toEqual(['after', 'caught: boom']);
  // The unhandled rejection of an un-caught promise is also survivable.
  await setEditorCode(page, 'Promise.reject("nobody listens");\nconsole.log("alive");');
  await runAndWait(page);
  await expect.poll(() => consoleLines(page)).toEqual(['alive']);
  await expect(page.locator('.as-tl-error, .as-console-error')).toHaveCount(1, { timeout: 10_000 });
});

test('7 — syntax errors show a clear, recoverable message', async ({ page }) => {
  await setEditorCode(page, 'const = broken;');
  await page.getByRole('button', { name: 'Run (Ctrl+Enter)' }).click();
  const banner = page.getByRole('alert');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(/syntax error/i);
  await expect(banner).toContainText(/line 1/i);
  // The app recovers when the code is fixed.
  await setEditorCode(page, 'console.log("fixed");');
  await runAndWait(page);
  await expect.poll(() => consoleLines(page)).toEqual(['fixed']);
});

test('8 — infinite execution can be stopped and the sandbox recovers', async ({ page }) => {
  await setEditorCode(page, 'while (true) {}');
  await page.getByRole('button', { name: 'Run (Ctrl+Enter)' }).click();
  // The engine's limit error surfaces and the app stays usable.
  await expect(page.locator('.as-tl-error').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Run (Ctrl+Enter)' })).toBeEnabled();
  // Stop resets everything.
  await page.getByRole('button', { name: '■ Stop' }).click();
  await expect(page.locator('.as-status')).toContainText(/ready/i);
  // And a fresh program runs normally afterwards.
  await setEditorCode(page, 'console.log("recovered");');
  await runAndWait(page);
  await expect.poll(() => consoleLines(page)).toEqual(['recovered']);
});

test('9 — restart replays the same trace from the beginning', async ({ page }) => {
  await selectExample(page, 'setTimeout');
  await runAndWait(page);
  await expect.poll(() => consoleLines(page)).toEqual(['A', 'C', 'B']);
  await page.getByRole('button', { name: '↺ Restart' }).click();
  await expect(page.locator('.as-console-line')).toHaveCount(0);
  await expect(page.locator('.as-status')).toContainText(/paused at start/i);
  // Play again reaches the same final state.
  await page.getByRole('button', { name: 'Resume (Space)' }).click();
  await expect.poll(() => consoleLines(page)).toEqual(['A', 'C', 'B']);
});

test('10 — custom code: the engine is not preset-only', async ({ page }) => {
  const code = [
    'function make(name) {',
    '  return () => console.log("hello", name);',
    '}',
    'const hi = make("asyncscope");',
    'hi();',
    'setTimeout(hi, 10);',
    'Promise.resolve().then(() => console.log("micro"));',
  ].join('\n');
  await setEditorCode(page, code);
  await runAndWait(page);
  await expect
    .poll(() => consoleLines(page))
    .toEqual(['hello asyncscope', 'micro', 'hello asyncscope']);
});

test('11 — TypeScript types are erased while async behavior stays observable', async ({ page }) => {
  await selectExample(page, 'TypeScript async flow');
  await expect(page.getByLabel('Language')).toHaveValue('typescript');
  await runAndWait(page);
  await expect
    .poll(() => consoleLines(page))
    .toEqual(['start: Ada', 'scheduled', 'after await', 'timer: 20']);
});

test('visualizer panels reflect execution state during playback', async ({ page }) => {
  await setEditorCode(page, 'setTimeout(() => console.log("t"), 30);\nconsole.log("sync");');
  await page.getByRole('button', { name: 'Run (Ctrl+Enter)' }).click();
  // While paused early, the timer is visible in the Browser APIs panel.
  await expect(page.locator('.as-timer')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.as-timer')).toContainText('setTimeout');
  await runAndWait(page);
  await expect.poll(() => consoleLines(page)).toEqual(['sync', 't']);
});

test('the welcome preset explains the canonical ordering', async ({ page }) => {
  await selectExample(page, 'Welcome / Mixed Event Loop');
  await runAndWait(page);
  await expect
    .poll(() => consoleLines(page))
    .toEqual(['Start', 'Before await', 'End', 'Promise', 'After await', 'Timeout']);
});

test('step controls walk the timeline back and forth', async ({ page }) => {
  // Run to completion first, then Restart to get a clean paused-at-start
  // state with no auto-play interference.
  await setEditorCode(
    page,
    'console.log("sync");\nPromise.resolve().then(() => console.log("micro"));\nsetTimeout(() => console.log("task"), 0);',
  );
  await runAndWait(page);
  await page.getByRole('button', { name: '↺ Restart' }).click();
  await expect(page.locator('.as-status')).toContainText(/paused at start/i);

  const next = page.getByRole('button', { name: 'Next ▶ (ArrowRight)' });
  const prev = page.getByRole('button', { name: '◀ Prev (ArrowLeft)' });

  // Step to the end — all 3 lines visible.
  for (let i = 0; i < 30; i++) await next.click({ force: true });
  await expect(page.locator('.as-console-line').nth(2)).toBeVisible({ timeout: 5_000 });
  expect(await page.locator('.as-console-line').count()).toBe(3);

  // Step back into the microtask loop phase — "task" not yet fired.
  for (let i = 0; i < 5; i++) await prev.click({ force: true });
  expect(await page.locator('.as-console-line').count()).toBe(2);

  // Step back into the sync phase — only "sync".
  for (let i = 0; i < 10; i++) await prev.click({ force: true });
  expect(await page.locator('.as-console-line').count()).toBe(1);

  // All the way back to the start — no console output yet.
  for (let i = 0; i < 10; i++) await prev.click({ force: true });
  expect(await page.locator('.as-console-line').count()).toBe(0);
});
