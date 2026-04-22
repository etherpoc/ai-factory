# Next.js App Router 実装規約（programmer 向け差し込み）

- ルートは `app/<segment>/page.tsx` に配置する。`pages/` ディレクトリは使わない。
- **Server Components を既定**にする。以下の場合だけファイル先頭に `'use client'` を付ける:
  - `useState` / `useEffect` / `useRef` / `useMemo` など React hooks
  - `onClick` / `onChange` 等のブラウザイベントハンドラ
  - `window` / `document` 直接アクセス
- フォーム送信は Server Actions (`'use server'` directive + action prop) を優先する。API を作る必要があるときだけ `app/api/<route>/route.ts` に Route Handler を置き、`GET` / `POST` 等を named export する。
- ストア・永続化が必要なら SQLite (better-sqlite3) か Vercel KV を使う。ローカルストレージは避ける（SSR とぶつかる）。
- スタイルは Tailwind のユーティリティクラスを優先する。凝った CSS は `@layer components` でカプセル化し、CSS Modules は最後の手段。
- Tailwind クラスの並びは `clsx` でまとめてから classes prop に渡す。長い文字列のインラインは避ける。
- アクセシビリティ:
  - インタラクティブ要素に `aria-label` / `role` を適切に
  - フォーカス可能要素は `tab-index` を壊さない
  - 重要な要素には `data-testid` を付ける（テスト安定性）
- メタデータは `app/layout.tsx` or `app/<route>/layout.tsx` の `export const metadata: Metadata = {...}` で宣言
- `next/image` を使う。`<img>` は使わない。

## Todo アプリ等の対話 UI における必須コントラクト

interaction.spec.ts の要求に合わせ、ユーザー操作を伴う UI を作る場合は次の `data-testid` を付けること:

- `todo-input` — テキスト入力
- `todo-add` — 追加ボタン
- `todo-item` — 追加されたアイテム 1 つ 1 つ（複数回レンダされる）
- `todo-delete` — 各 `todo-item` 内の削除ボタン

ドメインが Todo でない場合はこれに準じた命名（例: `note-input` / `note-add` / `note-item` / `note-delete`）にしてテストも整合を取る。
