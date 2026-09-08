import { expect, test } from '@playwright/test';
import { setEditorCode } from './helpers';

const desktopViewports = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  // CSS-pixel equivalents of 1440x900 at 125% and 150% browser zoom.
  { width: 1152, height: 720 },
  { width: 960, height: 600 },
];

test('long traces render bounded rows, allow full access and reconstruct restart', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await setEditorCode(
    page,
    'for (let i = 0; i < 250; i++) console.log("row", i, "detail\\n".repeat(i % 4));',
  );
  await page.getByRole('button', { name: 'Run (Ctrl+Enter)' }).click();
  const slider = page.getByRole('slider', { name: 'Playback position' });
  await expect(slider).toBeEnabled();
  await slider.press('End');
  const output = page.getByRole('region', { name: 'Console output' });
  await expect(output.locator('.as-console-line').last()).toContainText('row 249');
  expect(await output.locator('.as-console-line').count()).toBeLessThan(100);
  const timeline = page.getByRole('region', { name: 'Execution timeline' });
  expect(await timeline.locator('.as-tl-item').count()).toBeLessThan(100);
  await output.locator('.as-panel-scroll').hover();
  await page.mouse.wheel(0, -100000);
  await expect(output.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
  await expect(output.locator('.as-console-line').first()).toContainText('row 0');
  await output.getByRole('button', { name: 'Show all rows' }).click();
  await expect(output.locator('.as-console-line')).toHaveCount(250);
  await expect(output.locator('.as-console-line').first()).toContainText('row 0');
  await page.getByRole('button', { name: '↺ Restart' }).click();
  await expect(output.locator('.as-console-line')).toHaveCount(0);
  await expect(page.getByRole('status', { name: /event loop/i })).toHaveAttribute(
    'data-loop-state',
    'waiting',
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1))
    .toBe(true);
});

for (const viewport of desktopViewports) {
  test(`desktop workbench fits ${viewport.width}x${viewport.height} without page scroll`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    await expect(
      page.getByRole('separator', { name: 'Resize code editor and runtime' }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: /execution timeline/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /console output/i })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1))
      .toBe(true);

    const editor = await page.locator('.as-desktop-split > .as-editor-frame').boundingBox();
    const runtime = await page.locator('.as-runtime-grid').boundingBox();
    expect(editor).not.toBeNull();
    expect(runtime).not.toBeNull();
    expect(editor!.width / (editor!.width + runtime!.width)).toBeGreaterThan(0.37);
    expect(editor!.width / (editor!.width + runtime!.width)).toBeLessThan(0.43);
  });
}

test('editor splitter is keyboard accessible and persists its limit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const splitter = page.getByRole('separator', { name: 'Resize code editor and runtime' });

  await splitter.focus();
  await splitter.press('End');
  await expect(splitter).toHaveAttribute('aria-valuenow', '58');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('asyncscope:editor-percent')))
    .toBe('58');

  await page.reload();
  await expect(
    page.getByRole('separator', { name: 'Resize code editor and runtime' }),
  ).toHaveAttribute('aria-valuenow', '58');
});

test('mobile uses focused views and a collapsible console', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('separator', { name: 'Resize code editor and runtime' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('tabpanel', { name: 'Editor' })).toBeVisible();
  await expect(page.locator('.as-editor-host .cm-content')).toBeVisible();
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await expect(page.getByRole('tab', { name: 'Runtime' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Call Stack' })).toBeVisible();
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByRole('region', { name: /execution timeline/i })).toBeVisible();

  await expect(page.getByRole('region', { name: /console output/i })).toHaveCount(0);
  // The Astro dev toolbar overlaps this bottom-edge control when tests reuse `pnpm dev`.
  await page.getByRole('button', { name: /expand console/i }).click({ force: true });
  await expect(page.getByRole('region', { name: /console output/i })).toBeVisible();
  await page.getByRole('button', { name: /collapse console/i }).click();
  await expect(page.getByRole('region', { name: /console output/i })).toHaveCount(0);
});

test('tablet keeps every runtime section reachable without document scroll', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await expect(page.locator('.as-editor-host .cm-content')).toBeVisible();
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await expect(page.getByRole('region', { name: 'Task Queue', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1))
    .toBe(true);
});

test('manual editor navigation disables follow and survives the next snapshot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const code = Array.from({ length: 60 }, (_, index) => `console.log("line ${index + 1}");`).join(
    '\n',
  );
  await setEditorCode(page, code);
  await page.getByLabel('Speed').selectOption('4');
  await page.getByRole('button', { name: 'Run (Ctrl+Enter)' }).click();
  await expect(page.getByRole('button', { name: /pause/i })).toBeEnabled();
  await page.getByRole('button', { name: /pause/i }).click();

  const editor = page.locator('.as-editor-host .cm-content');
  await editor.click();
  await editor.press('Control+Home');
  const follow = page.locator('.as-editor-shell .as-follow-toggle');
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  const before = await page.locator('.cm-scroller').evaluate((element) => element.scrollTop);

  await page.getByRole('button', { name: /next/i }).click();
  await expect
    .poll(() => page.locator('.cm-scroller').evaluate((element) => element.scrollTop))
    .toBeLessThanOrEqual(before + 1);
});

test('following can be disabled and enabled explicitly', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.as-editor-host .cm-content')).toBeVisible();
  const follow = page.locator('.as-editor-shell .as-follow-toggle');
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
});

test('Space activates a focused button instead of the global playback shortcut', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.as-editor-host .cm-content')).toBeVisible();
  const follow = page.locator('.as-editor-shell .as-follow-toggle');
  await follow.focus();
  await follow.press('Space');
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.as-status')).toContainText(/ready/i);
});

test('reduced motion freezes the event-loop indicator without losing state', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const badge = page.getByRole('status', { name: /event loop/i });
  await expect(badge).toHaveAttribute('data-loop-state', 'waiting');
  const motion = await badge.locator('svg').evaluate((element) => {
    const style = getComputedStyle(element);
    const duration = style.animationDuration;
    const milliseconds = duration.endsWith('ms')
      ? Number.parseFloat(duration)
      : Number.parseFloat(duration) * 1_000;
    return { milliseconds, iterations: style.animationIterationCount };
  });
  expect(motion.milliseconds).toBeLessThanOrEqual(0.01);
  expect(motion.iterations).toBe('1');
});
