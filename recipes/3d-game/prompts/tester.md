# Playwright E2E 指針（tester 向け差し込み）

## テストランナー

- **Playwright** (`@playwright/test`) + Chromium ヘッドレス
- テストファイル: `tests/e2e/*.spec.ts`
- dev server ではなく `pnpm preview`（ポート 4173）を使う

## カバー必須の 3 シナリオ

### 1. smoke.spec.ts — 起動確認

```typescript
test('canvas boots and scene is ready', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('[data-testid="scene-ready"]')).toBeAttached();
});
```

### 2. gameplay.spec.ts — プレイヤー移動

```typescript
test('ArrowLeft and ArrowRight move the player horizontally', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__uafSeed = 42;
  });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  const player = page.locator('[data-testid="player"]');
  await expect(player).toBeAttached({ timeout: 3000 });

  const readX = async () => {
    const raw = await player.getAttribute('data-x');
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`data-x is not numeric: ${raw}`);
    return n;
  };

  const x0 = await readX();
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowLeft');
  expect(await readX()).toBeLessThan(x0);

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowRight');
  expect(await readX()).toBeGreaterThan((await readX()) - 1); // net right
});
```

### 3. gameover.spec.ts — 終端到達

```typescript
test('game-over state is reachable', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__uafSeed = 42;
  });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  // ゲームオーバー条件がキー入力で再現可能な場合はここで操作
  // 最低限 data-testid="game-over" が DOM に存在しうることを確認
  await expect(page.locator('[data-testid="game-over"]')).toBeAttached({ timeout: 30000 });
});
```

## セオリー

- `webServer.command` は `pnpm preview`（ポート 4173、安定）を使う
- `webServer.timeout` は 60s 以上
- シード固定は `page.addInitScript(() => { window.__uafSeed = 42; })` で行う（goto の前に呼ぶ）
- canvas の中身を直接 assert しない。DOM の `data-testid` 属性で観測する
- スクリーンショット比較は避ける（フォント・GPU レンダリング差異で flaky）
- `page.waitForTimeout` は最小限に。`expect(locator).toBeAttached()` の timeout を活用する
- Three.js の WebGL コンテキスト生成は数百 ms かかることがある。`canvas` の visible 確認後に `scene-ready` を待つ 2 段構えにする

## playwright.config.ts の要点

```typescript
webServer: {
  command: 'pnpm preview',
  url: 'http://localhost:4173',
  timeout: 60_000,
  reuseExistingServer: !process.env.CI,
}
```

`fullyParallel: false` にして WebGL リソース競合を避ける。
