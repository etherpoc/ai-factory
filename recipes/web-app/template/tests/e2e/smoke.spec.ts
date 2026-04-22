import { expect, test } from '@playwright/test';

test('home page renders title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title')).toHaveText(/UAF Web App/);
});
