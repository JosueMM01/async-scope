import { expect, test } from '@playwright/test';
import { runAndWait, setEditorCode } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

for (const [source, message] of [
  ['null.x;', 'TypeError'],
  ['missingValue;', 'ReferenceError'],
  ["throw '<img src=x onerror=window.__message_xss=true>';", 'Uncaught <img'],
]) {
  test(`runtime error is visible and inert: ${source}`, async ({ page }) => {
    await setEditorCode(page, source!);
    await runAndWait(page);
    await expect(page.locator('.as-console-error')).toContainText(message!);
    await expect(page.locator('.as-status')).toContainText('Finished with errors');
    await expect(page.locator('.as-status')).toHaveClass(/as-status-error/);
    await expect(page.locator('.as-console-error img')).toHaveCount(0);
    expect(await page.evaluate(() => '__message_xss' in window)).toBe(false);
    await page.getByRole('button', { name: '↺ Restart' }).click();
    await expect(page.locator('.as-console-error')).toHaveCount(0);
    await setEditorCode(page, 'console.log("recovered");');
    await runAndWait(page);
    await expect(page.locator('.as-status')).toHaveClass(/as-status-done/);
    await expect(page.locator('.as-console-text')).toHaveText('recovered');
  });
}

test('event budget shows a limit banner and replay remains usable', async ({ page }) => {
  await setEditorCode(page, 'for (let i=0; i<1000; i++) console.log(i);');
  await page.getByRole('button', { name: 'Run (Ctrl+Enter)' }).click();
  await expect(page.getByRole('alert')).toContainText('Execution limit reached');
  // Seek to the terminal snapshot rather than replaying 2000 events in real time.
  const slider = page.getByLabel('Playback position');
  await expect(slider).toBeEnabled();
  await slider.fill((await slider.getAttribute('max')) ?? '0');
  await expect(page.getByRole('alert')).toContainText('Execution limit reached');
  await expect(page.getByRole('alert')).toContainText('2000 events');
  await expect(page.locator('.as-status')).toContainText('Finished with errors');
  await page.getByRole('button', { name: '■ Stop' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
