import { expect, test } from '@playwright/test';
import { runAndWait, setEditorCode } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AsyncScope' })).toBeVisible();
});

test('Help opens as a modal with MDN links and locks the page behind it', async ({ page }) => {
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'How AsyncScope works' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Supported JavaScript');
  await expect(dialog).toContainText('Not supported (by design)');
  await expect(dialog).toContainText('Limits to keep in mind');

  // MDN links: verified docs, opening in a new tab.
  const eventLoop = dialog.getByRole('link', { name: 'Event loop on MDN' }).first();
  await expect(eventLoop).toHaveAttribute(
    'href',
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop',
  );
  await expect(eventLoop).toHaveAttribute('target', '_blank');
  await expect(dialog.getByRole('link', { name: 'Promise.all' })).toHaveAttribute(
    'href',
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all',
  );

  // The modal body scrolls internally while the page behind it cannot scroll.
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.overflow))
    .toBe('hidden');
  await expect(dialog.locator('.as-help-dialog-body')).toBeVisible();

  // Esc closes it and returns focus to the Help button.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeFocused();
});

test('Help closes from the backdrop and the Close button', async ({ page }) => {
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'How AsyncScope works' });
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Close help' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
});

test('Run pauses at the first step and Next walks forward', async ({ page }) => {
  await setEditorCode(page, 'console.log("A");\nconsole.log("B");');
  await page.getByRole('button', { name: 'Run (Ctrl+Enter)' }).click();
  await expect(page.locator('.as-status')).toContainText(/paused at start/i);
  await expect(page.locator('.as-console-line')).toHaveCount(0);
  // Step forward until the first console.log lands (the first trace steps
  // are stack events, not console output).
  for (let i = 0; i < 10; i++) {
    if ((await page.locator('.as-console-line').count()) >= 1) break;
    await page.getByRole('button', { name: 'Next ▶ (ArrowRight)' }).click();
  }
  await expect(page.locator('.as-console-line')).toHaveCount(1);
  await page.getByRole('button', { name: 'Resume (Space)' }).click();
  await expect(page.locator('.as-status')).toContainText(/finished/i);
});

test('editing the code marks the example as Custom', async ({ page }) => {
  await setEditorCode(page, 'console.log("mine");');
  await expect(page.getByText('Custom', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Examples')).toHaveValue('custom');
  // Reset restores the selected example and clears the Custom mark.
  await page.getByRole('button', { name: 'Reset editor to the selected example' }).click();
  await expect(page.getByText('Custom', { exact: true })).toHaveCount(0);
});

test('new examples run cleanly: setInterval, Promise.all, async error handling', async ({
  page,
}) => {
  await page.getByLabel('Examples').selectOption({ label: 'setInterval' });
  await runAndWait(page);
  await expect
    .poll(() => page.locator('.as-console-line .as-console-text').allTextContents())
    .toEqual(['started', 'tick 1', 'tick 2', 'tick 3', 'stopped']);

  await page.getByLabel('Examples').selectOption({ label: 'Promise.all' });
  await runAndWait(page);
  await expect
    .poll(() => page.locator('.as-console-line .as-console-text').allTextContents())
    .toEqual(['waiting', 'all: 1,2,3']);

  await page.getByLabel('Examples').selectOption({ label: 'async / await error handling' });
  await runAndWait(page);
  await expect
    .poll(() => page.locator('.as-console-line .as-console-text').allTextContents())
    .toEqual(['started', 'caught: oops', 'continues']);
});
