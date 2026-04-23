# 中断と再開ガイド (Phase 7.8.5)

25 分かけて生成するプロジェクトの途中で PC を再起動したら、最初からやり直し ― Phase 7.8 以前はそうだった。Phase 7.8.5 は state.json の checkpoint と `uaf resume` で、どのタイミングで止まっても **その続きから** 再開できるようにした。

## 中断ポイント

| 中断シナリオ | 検出方法 | 保存される情報 |
|-------------|---------|---------------|
| Ctrl+C (SIGINT) | `core/signal-handler.ts` が捕捉 | `phase='interrupted'`, `status='interrupted'`, `resumable=true` |
| PC 再起動 / 強制終了 | 最後の atomic checkpoint が残る | task の `status` が最新の完了状態まで |
| API エラー / budget 超過 | orchestrator の catch → 最終 state 更新 | `phase='failed'`, `resumable=true` |
| タスク完了時の正常書き込み | `writeTaskCheckpoint` | `completedTasks` + 個別タスクの `completedAt`/`costUsd`/`filesAdded`/`filesModified` |

すべて **atomic write** で書かれる (`core/utils/atomic-write.ts`)。`tmp → fsync → rename` に Windows EPERM/EBUSY リトライを重ねているので、書き込み中のクラッシュで state.json が破損することはない。

## SIGINT の二段階動作

```
1 度目の Ctrl+C:
  → signal-handler が active project の workspace に
    writeInterruptCheckpoint() を呼ぶ
  → state.json に phase='interrupted' を書く
  → "Checkpoint saved. Resume with: uaf resume <id>" を表示
  → exit 130

5 秒以内に 2 度目の Ctrl+C:
  → checkpoint 書き込みが hung していても強制終了
  → exit 130
```

`core/signal-handler.ts` の `installSigintHandler()` は `cli/index.ts` の `main()` 冒頭で 1 回だけ install される（idempotent）。

## uaf list --incomplete

中断中のプロジェクトだけを表示:

```bash
$ uaf list --incomplete
ID                          RECIPE    STATUS       PHASE         PROGRESS  AGE       REQUEST
202604231234-abc123         2d-game   in-progress  interrupted   3/12      12m ago   避けゲー
202604201856-def456         web-app   halted       failed        7/10      2d ago    Todo アプリ
```

| フラグ | 意味 |
|--------|------|
| `--incomplete` | resumable (`resumable=true`) のみ表示。legacy workspace は除外 |
| `--incomplete --all` | `--incomplete` に legacy 判定のみ外す。実際 legacy は resumable=false なので行は増えない。互換のためのフラグ |
| (なし) | 全プロジェクト表示 (完了・legacy 含む) |

legacy workspace (Phase 7.5/11.a までに作ったもの、phase と roadmap がない) は **`legacy` バッジ**付きで表示されるが resume 対象外（roadmap がないため）。

## uaf status <proj-id>

state.json の内容を人間向けに整形:

```
=== uaf status — 202604231234-abc123 ===
Workspace : /workspace/202604231234-abc123/
Recipe    : 2d-game
Request   : シンプルな避けゲー
Created   : 2026-04-23T12:34:56.789Z
Last run  : 2026-04-23T12:47:23.456Z  (5m ago)
Status    : interrupted
Phase     : interrupted
Resumable : yes
LLM cost  : $0.6821

Spec
  path: spec.md
  dialogTurns: 5
  approved: yes

Roadmap (3/12 done, est $1.50)
  ✓ task-001: Scaffold project structure
  ✓ task-002: Generate assets
  ✓ task-003: Initialize Phaser engine
  ⠋ task-004: Title scene
  · task-005: Game scene skeleton
  · task-006: Collision & gameover
  ...
```

`--json` で機械可読出力。CI からパースできる。

## uaf resume <proj-id>

再開ロジックは `core/resume.ts` の純粋関数 `planResume()` が決める。分岐は 5 つ:

| state.json の状態 | planResume の返す action | 実際の挙動 |
|-------------------|--------------------------|-----------|
| state.json なし / legacy | `not-resumable` | エラー。`RUNTIME_FAILURE` で終了 |
| `phase='complete'` or `resumable=false` | `already-complete` | `"Already complete — nothing to do."` |
| `phase='spec'` | `rerun-spec` | spec phase からやり直し |
| `phase='roadmap'` + spec.md あり | `rerun-roadmap` | roadmap-builder だけ再実行 |
| `phase='roadmap'` + spec.md なし | `rerun-spec` (+ warning) | spec phase に戻る（ファイル消失警告） |
| `phase='build'/'interrupted'/'failed'` + 全ファイル揃い | `continue-build` | orchestrator を existingWorkspace で起動。spec.md/design.md が既にあれば director/architect をスキップ |
| `phase='build'` + spec.md なし | `rerun-spec` (+ warning) | 安全側に倒す |
| `phase='build'` + roadmap.md なし | `rerun-roadmap` (+ warning) | 安全側に倒す |

起動時のプロンプト:

```
=== uaf resume — 202604231234-abc123 ===
Recipe   : 2d-game
Request  : シンプルな避けゲー
Progress : phase=interrupted · 3/12 tasks · status=interrupted
Last run : 2026-04-23T12:47:23.456Z (5m ago)
Action   : continue build phase (next: task-004)

続行しますか? (Y/n) ❯ _
```

`-y / --yes` で確認スキップ。

## 完了済みタスクの再実行防止

`core/checkpoint.ts` の `writeTaskCheckpoint()` は `task.status` を信頼する:

- `completed` / `skipped` のタスクは `uaf resume` が上書きしない
- orchestrator を再実行した際も、`spec.md` と `design.md` が既存ならそれぞれ director / architect をスキップ
- `skipScaffold` オプション（CLI 側は `node_modules` 存在で自動判定）で scaffold コピーをスキップし、workspace 破壊を防ぐ

## filesystem 変更検知（warning のみ）

`surveyWorkspaceFiles()` が `spec.md` / `roadmap.md` / `design.md` / `package.json` の存在を確認し、期待通りでなければ `planResume` が warning を出す。例:

```
! spec.md is missing — spec phase will be re-run before roadmap.
```

この時点で resume は abort せず、安全側（前のフェーズに戻る）に進む。ハッシュ比較による内容変化検知は現状未実装（Phase 8 候補）。

## uaf clean --incomplete

デフォルト `uaf clean` は resumable プロジェクトを保護する（`--older-than` に該当しても削除しない）。

```bash
uaf clean --incomplete           # resumable プロジェクトも age 無視で全部消す
uaf clean --incomplete --dry-run # 消える候補だけ確認
```

`proj!` バッジで「incomplete だから消される」ことが一目で分かるようにしてある。

## uaf resume の内部フロー

```
1. state.json を読む
2. surveyWorkspaceFiles() で filesystem 調査
3. planResume() で action を決定
4. action に応じて dispatch:
    - rerun-spec:    runSpecWizard → roadmap-builder → runOrchestrator
    - rerun-roadmap: roadmap-builder → runOrchestrator
    - continue-build: runOrchestrator (existingWorkspace, skipScaffold=files.packageJson)
5. orchestrator 完了 → 残りタスクを writeTaskCheckpoint で completed に
6. 最終 state.json を書く（phase='complete', resumable=false）
```

## よくある質問

**Q. resume 中にもう一度 Ctrl+C したらどうなる?**
A. SIGINT ハンドラが再度 `writeInterruptCheckpoint()` を呼び、resumable 状態を保つ。何度でも再開できる。

**Q. 別の PC で resume できる?**
A. workspace を丸ごと別マシンにコピーして `uaf resume <id>` を走らせれば可能。`.env` の API キーは新マシン側で設定しておくこと。

**Q. state.json を手で編集して resume を誘導できる?**
A. できる。例えば `phase='failed'` → `'build'` に書き換えて continue-build パスに飛ばすなど。ただし zod スキーマ違反になると `readWorkspaceState` が null を返して **legacy 扱いになる**（= 再開不可）ので注意。

**Q. 既に完了したプロジェクトを再実行したい**
A. `uaf iterate <proj-id> "追加要望"` で差分実行するのが正攻法。resume は「未完了プロジェクトの続き」専用。
