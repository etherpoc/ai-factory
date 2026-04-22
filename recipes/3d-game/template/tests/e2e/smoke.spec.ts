import { expect, test } from '@playwright/test';

test('canvas boots and scene is ready', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('[data-testid="scene-ready"]')).toBeAttached();
});
