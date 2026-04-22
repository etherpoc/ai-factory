# Three.js 実装規約（programmer 向け差し込み）

## ファイル配置

```
src/
  main.ts              # エントリ: Renderer / Camera / resize / アニメーションループ
  scenes/
    MainScene.ts       # メインシーン（ゲーム本体）
    <Name>Scene.ts     # 追加シーンがあれば同様
  utils/
    rng.ts             # シード付き乱数
    dom.ts             # DOM プロキシ更新ヘルパー
public/
  assets/              # テクスチャ・モデルなど静的アセット
tests/
  e2e/
    smoke.spec.ts
    gameplay.spec.ts
```

## シーンの構造

```typescript
export class MainScene {
  private scene: THREE.Scene;
  private objects: THREE.Object3D[] = [];

  init(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void { ... }
  update(delta: number): void { ... }  // delta は秒単位
  dispose(): void { ... }
}
```

- `init()` で THREE.Mesh / Light などを scene に add する
- `update(delta)` でゲームロジックを進める（物理、衝突、スコアなど）
- `dispose()` で geometry / material を解放する

## Renderer / Camera（main.ts）

- `THREE.WebGLRenderer({ antialias: true })` を作り、`document.getElementById('game')!.appendChild(renderer.domElement)` でマウント
- `renderer.setAnimationLoop((time) => { ... })` で描画ループを回す
- resize 対応:
  ```typescript
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  ```

## 入力管理

```typescript
const keys = new Set<string>();
document.addEventListener('keydown', (e) => keys.add(e.code));
document.addEventListener('keyup', (e) => keys.delete(e.code));
```

`keys.has('ArrowLeft')` のようにフレームごとに参照する。`document.addEventListener` で直接 velocity を変えない。

## 乱数（src/utils/rng.ts）

```typescript
export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}
```

`Math.random()` を直接使わない。シードは `(window as unknown as Record<string, unknown>).__uafSeed ?? 42` から取る。

## DOM プロキシ（テスト観測性）

Three.js の canvas 内部はテストから直接観測できない。以下を必ず実装すること:

### 必須コントラクト 1: player プロキシ

```typescript
// update() の末尾で毎フレーム更新
let playerProxy = document.querySelector<HTMLElement>('[data-testid="player"]');
if (!playerProxy) {
  playerProxy = document.createElement('div');
  playerProxy.setAttribute('data-testid', 'player');
  playerProxy.style.display = 'none';
  document.body.appendChild(playerProxy);
}
playerProxy.setAttribute('data-x', String(Math.round(playerMesh.position.x)));
```

### 必須コントラクト 2: scene-ready マーカー

```typescript
// MainScene.init() の末尾で 1 回だけ
const marker = document.createElement('div');
marker.setAttribute('data-testid', 'scene-ready');
marker.style.display = 'none';
document.body.appendChild(marker);
```

### 必須コントラクト 3: game-over マーカー

```typescript
// ゲームオーバー / クリア条件達成時
const el = document.createElement('div');
el.setAttribute('data-testid', 'game-over');
el.style.display = 'none';
document.body.appendChild(el);
```

## 禁止事項

- `any` 型の使用（`unknown` + narrowing を使う）
- `requestAnimationFrame` の直接呼び出し（`renderer.setAnimationLoop` で統一）
- `Math.random()` の直接呼び出し（シード付き `rng.ts` を使う）
- グローバル変数への `window.xxx = ...` 直接代入（テスト用シードは例外）
- 1 ファイルに複数のシーンを書く

## エラー処理

- アセットロード失敗は `console.error` で記録し、代替 `MeshBasicMaterial` で続行する
- 非同期処理は `try/catch` を必ず入れる
