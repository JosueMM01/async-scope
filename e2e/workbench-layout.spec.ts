import { expect, test } from '@playwright/test';

const desktopViewports = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

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
