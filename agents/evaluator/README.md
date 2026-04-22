# agents/evaluator/ — 完成度評価エージェント

## 責務

`recipe.evaluation.criteria` の各項目を、**ビルド/テスト結果などの決定論的エビデンス**と突き合わせて合否判定する。`required: true` がすべて達成されていればループ終了。

## 出力

```ts
interface CompletionScore {
  overall: number; // 0..100
  perCriterion: {
    id: string;
    passed: boolean;
    required: boolean;
    evidence: string;
  }[];
  done: boolean; // required が全 passed なら true
}
```

## 変更履歴

- 2026-04-21: 初版スタブ
