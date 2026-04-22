import { expect, test } from '@playwright/test';

/**
 * Interaction contract: the pristine scaffold does NOT satisfy this test by design.
 * The Programmer agent must implement a Todo-style UI with the following testids:
 *   - todo-input   — text input
 *   - todo-add     — submit / add button
 *   - todo-item    — each rendered todo (duplicates allowed)
 *   - todo-delete  — delete button inside each todo-item
 */
test('user can add a todo and delete it', async ({ page }) => {
  await page.goto('/');

  const input = page.getByTestId('todo-input');
  await expect(input, 'Programmer must expose data-testid="todo-input"').toBeVisible({
    timeout: 3000,
  });

  await input.fill('買い物に行く');
  await page.getByTestId('todo-add').click();

  const items = page.getByTestId('todo-item');
  const newItem = items.filter({ hasText: '買い物に行く' });
  await expect(newItem).toBeVisible();

  const beforeCount = await items.count();
  await newItem.getByTestId('todo-delete').click();
  await expect(items).toHaveCount(beforeCount - 1);
});
