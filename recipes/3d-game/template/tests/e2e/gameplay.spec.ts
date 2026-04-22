import { expect, test } from '@playwright/test';

/**
 * Gameplay contract: the pristine scaffold does NOT satisfy this test by design.
 * The Programmer agent must implement a player that:
 *   - exposes `data-testid="player"` with a numeric `data-x` attribute
 *   - moves left when ArrowLeft is held
 *   - moves right when ArrowRight is held
 *
 * See recipes/3d-game/prompts/programmer.md for the full contract.
 */
test('ArrowLeft and ArrowRight move the player horizontally', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>)['__uafSeed'] = 42;
  });

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  const player = page.locator('[data-testid="player"]');
  await expect(player, 'Programmer must expose data-testid="player"').toBeAttached({
    timeout: 3000,
  });

  const readX = async (): Promise<number> => {
    const raw = await player.getAttribute('data-x');
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`player data-x is not numeric: ${raw}`);
    return n;
  };

  await expect(page.locator('canvas')).toBeVisible();
  const x0 = await readX();

  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowLeft');
  const x1 = await readX();
  expect(x1, 'ArrowLeft should decrease player x').toBeLessThan(x0);

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowRight');
  const x2 = await readX();
  expect(x2, 'ArrowRight should increase player x past its ArrowLeft position').toBeGreaterThan(x1);
});
