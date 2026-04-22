# Phaser 3 実装規約（programmer 向け差し込み）

- 各シーンは `src/scenes/<Name>Scene.ts` に `class extends Phaser.Scene` で配置。
- `init(data)` / `preload()` / `create(data)` / `update(time, delta)` を使い分ける。混ぜない。
- アセットは `public/` に置き、`this.load.image('key', '/assets/foo.png')` のような **絶対パス** で参照する（vite の public 配下は root 相対で配信される）。
- 物理エンジンは **arcade** を既定とする。配置は `this.physics.add.sprite(x, y, key)`。
- シーン遷移は `this.scene.start('SceneKey', data)`。`new` で直接生成しない。
- グローバル状態は Phaser の Scene 間共有の仕組み（registry / data manager）か、明示的な EventEmitter を使う。`window` を直接汚染しない。
- 入力は `this.input.keyboard.createCursorKeys()` で cursor オブジェクトを取る。`document.addEventListener` は最後の手段。
- テストから観測できるよう、重要な DOM 要素には `data-testid` を付ける（スコア表示、ゲームオーバーのテキストなど）。
- **必須コントラクト (gameplay.spec.ts が依存)**: プレイヤーに相当する存在を `<div data-testid="player" data-x="<X 座標>">` として DOM に出力し、ArrowLeft / ArrowRight の入力で `data-x` の数値が増減するように毎フレーム更新すること。Phaser の canvas はテストから直接観測できないので、DOM プロキシが必須。
- **必須コントラクト**: ゲームオーバー・クリア到達時は `<div data-testid="game-over">` を追加し、ユーザーが終端に辿り着けることをテスト可能にする。
- 乱数は `Phaser.Math.Between` / `RandomDataGenerator` を使い、seed は `this.registry.get('seed')` から取る（テストで固定するため）。
