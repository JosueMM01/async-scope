/** Shared helpers for AsyncScope E2E tests. */
import { expect, type Page } from '@playwright/test';

const EDITOR = '.as-editor-host .cm-content';

/** Replaces the editor content with the given source. */
export async function setEditorCode(page: Page, code: string): Promise<void> {
  const editor = page.locator(EDITOR);
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(code, { delay: 0 });
}

/** Clicks Run, sets the given speed and waits for the run to finish. */
export async function runAndWait(page: Page, speed = '4'): Promise<void> {
  await expect(page.locator(EDITOR)).toBeVisible();
  await page.getByLabel('Speed').selectOption(speed);
  await page.getByRole('button', { name: 'Run (Ctrl+Enter)' }).click();
  await expect(page.locator('.as-status')).toContainText(/Finished|Paused at start|Error/, {
    timeout: 30_000,
  });
}

/** Returns the console line texts in order. */
export async function consoleLines(page: Page): Promise<string[]> {
  return page.locator('.as-console-line .as-console-text').allTextContents();
}

/** Selects a preset by its option label. */
export async function selectExample(page: Page, name: string): Promise<void> {
  await expect(page.locator(EDITOR)).toBeVisible();
  await page.getByLabel('Examples').selectOption({ label: name });
}
