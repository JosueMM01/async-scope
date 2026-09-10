import { expect, test } from '@playwright/test';
import { consoleLines, runAndWait, selectExample, setEditorCode } from './helpers';

test('edited code preserves an explicitly labelled execution and its original source', async ({
  page,
}) => {
  await page.goto('/');
  await selectExample(page, 'TypeScript async flow');
  await runAndWait(page);
  const original = await page.locator('.cm-content').innerText();
  const output = await consoleLines(page);
  await setEditorCode(page, 'console.log("new draft");');
  await expect(page.getByText('Code or language changed.', { exact: false })).toBeVisible();
  await expect(page.locator('.as-active-line')).toHaveCount(0);
  await page.getByRole('button', { name: 'View executed code' }).click();
  await expect(page.getByRole('group', { name: 'Executed code (read-only)' })).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveText(original, { useInnerText: true });
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await page.getByRole('button', { name: /Restart/ }).click();
  await page.getByRole('slider', { name: 'Playback position' }).press('End');
  expect(await consoleLines(page)).toEqual(output);
  await page.getByRole('button', { name: 'Back to edits' }).click();
  await expect(page.locator('.cm-content')).toHaveText('console.log("new draft");');
  await expect(page.locator('.as-active-line')).toHaveCount(0);
  await runAndWait(page);
  expect(await consoleLines(page)).toEqual(['new draft']);
  await expect(page.getByRole('button', { name: 'View executed code' })).toHaveCount(0);
});

test('language and example changes are distinguished from the recorded execution', async ({
  page,
}) => {
  await page.goto('/');
  await setEditorCode(page, 'console.log("original");');
  await runAndWait(page);
  await page.getByLabel('Language', { exact: true }).selectOption('typescript');
  await expect(page.getByRole('button', { name: 'View executed code' })).toBeVisible();
  await page.getByLabel('Language', { exact: true }).selectOption('javascript');
  await expect(page.getByRole('button', { name: 'View executed code' })).toHaveCount(0);
  await selectExample(page, 'setTimeout');
  await expect(page.getByRole('button', { name: 'View executed code' })).toBeVisible();
  await page.getByRole('button', { name: /Stop/ }).click();
  await expect(page.getByRole('button', { name: 'View executed code' })).toHaveCount(0);
  expect(await consoleLines(page)).toEqual([]);
});

test('theme uses system preference and preserves an explicit choice across reload', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Toggle light and dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Toggle light and dark theme' }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('theme remains usable when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('Storage unavailable');
    };
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable');
    };
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Toggle light and dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.cm-content')).toBeVisible();
});

test('favicon is linked and included in the production build', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  const icon = await request.get('/favicon.svg');
  expect(icon.ok()).toBe(true);
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
  expect(await icon.text()).toContain('<title>AsyncScope</title>');
});
