# skillam Phase 4（Web UI）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計書 §11 の5画面（Dashboard / Roles / Projects / Catalog / Settings）を React SPA として実装し、`npm run dev` でサーバーと同時起動してブラウザから skillam を操作できるようにする。

**Architecture:** `apps/web` を Vite + React + TypeScript の workspace として追加する。API アクセスは型付きの薄いクライアント1枚に集約し、画面コンポーネントは fetch を直接呼ばない。サーバー側の変更は CORS の追加のみ（Task 1）で、既存の33エンドポイントはそのまま使う。状態管理ライブラリは入れず、React の `useState` / `useEffect` と、画面ごとの小さなデータ取得フックで済ませる。

**Tech Stack:** React 18 / Vite 5 / TypeScript / Vitest + @testing-library/react（server 側と同じ Vitest を使う）

---

## 設計上の決定

- **CORS をサーバーに入れる**（Vite proxy ではなく）。`@fastify/cors` で `http://localhost:5173` を許可する。ローカル専用ツールであり、127.0.0.1 バインドのままオリジンだけを絞る
- **API クライアントは1枚**。`apps/web/src/api/client.ts` に集約し、409（衝突）/ 500（適用失敗）/ 404 を型で区別して返す。画面側は例外ではなく判別可能なユニオンで受ける
- **diff ビューアは自前**。`FileChange`（`before: string | null` / `after: string`）を行単位で比較して色付けするだけの純関数 + 表示コンポーネントに分ける。差分計算は純関数なのでファイルシステムもDOMも要らずテストできる
- **シークレットの平文は UI に出さない**。`POST /secrets/:id/reveal` は明示操作時のみ呼び、一覧では末尾4文字のみ表示（設計書 §8）
- **破壊的操作は確認ダイアログを挟む**（設計書 §12）。ロール解除・シークレット削除・プロジェクト除外

### 適用フローで UI が守るべき契約

サーバーは以下を返す。UI はこれを取り違えてはいけない。

| 状況 | ステータス | UI の扱い |
|---|---|---|
| プレビュー成功 | 200 + `ApplyPlan` | diff を表示。この時点でディスクは無変更 |
| 衝突（skillam が作っていないファイルがある等） | 409 | エラー文をそのまま表示。**適用ボタンを押させない**。履歴も残っていない |
| 適用成功 | 200 + `{ status, historyId, plan }` | 成功表示 → 履歴を再取得 |
| 適用失敗（シークレット未解決・書き込み失敗） | 500 + `{ error, historyId? }` | エラー表示。**部分的に書き込まれている可能性がある**旨を明示し、履歴を再取得 |

409 と 500 を同じ「エラー」として扱うと、ユーザーは「何も起きていない」のか「途中まで書かれた」のかを区別できない。ここは必ず別表示にする。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `apps/server/src/app.ts` | CORS 登録（Task 1 のみ） |
| `apps/web/package.json` / `vite.config.ts` / `tsconfig.json` | スキャフォールド |
| `apps/web/src/api/types.ts` | サーバーの型を写した DTO 定義 |
| `apps/web/src/api/client.ts` | 型付き fetch ラッパ。成功/エラーの判別ユニオンを返す |
| `apps/web/src/lib/diff.ts` | 行単位 diff の純関数 |
| `apps/web/src/components/DiffView.tsx` | `diff.ts` の結果を色付き表示 |
| `apps/web/src/components/ConfirmDialog.tsx` | 破壊的操作の確認 |
| `apps/web/src/pages/Dashboard.tsx` | プロジェクト一覧・未登録検出分 |
| `apps/web/src/pages/Roles.tsx` / `RoleEditor.tsx` | ロール一覧・編集 |
| `apps/web/src/pages/ProjectDetail.tsx` | 割当・プレビュー・適用・履歴 |
| `apps/web/src/pages/Catalog.tsx` | スキャン結果一覧 |
| `apps/web/src/pages/Settings.tsx` | 自動検出ルート管理 |
| `apps/web/src/App.tsx` | ルーティングとレイアウト |

---

### Task 1: サーバーに CORS を入れる

**Files:**
- Modify: `apps/server/package.json`（`@fastify/cors` 追加）
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/app.test.ts` に追加する:

```ts
  it('allows the vite dev server origin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' }
    })

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('does not allow an unrelated origin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.com' }
    })

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/app.test.ts`
Expected: FAIL — `access-control-allow-origin` ヘッダが付かず undefined

- [ ] **Step 3: 依存を追加**

```bash
npm install @fastify/cors --workspace @skillam/server
```

- [ ] **Step 4: 実装**

`apps/server/src/app.ts` の import 群に追加:

```ts
import cors from '@fastify/cors'
```

`app.setErrorHandler(...)` の**前**に登録する（読みやすさのための位置。`@fastify/cors` は `onRequest` フックに入るため、`setErrorHandler` との登録順は動作に影響しない — 後に登録してもプリフライトは正しく処理される）:

```ts
  app.register(cors, {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173']
  })
```

ワイルドカード（`origin: true`）にはしない。ローカル専用ツールとはいえ、ブラウザで開いた任意のページから 127.0.0.1:4317 を叩けてしまうため、開発サーバーのオリジンだけを明示する。

- [ ] **Step 5: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/server`
Expected: PASS

```bash
git add apps/server/package.json apps/server/src/app.ts apps/server/src/app.test.ts package-lock.json
git commit -m "feat(server): allow the web dev server origin via cors"
```

---

### Task 2: apps/web のスキャフォールド

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/App.test.tsx`
- Modify: `package.json`（ルート）

- [ ] **Step 1: 依存を入れる**

```bash
npm install --workspace @skillam/web \
  react react-dom react-router-dom
npm install --workspace @skillam/web --save-dev \
  @vitejs/plugin-react vite typescript @types/react @types/react-dom \
  vitest @testing-library/react @testing-library/user-event jsdom
```

（`apps/web/package.json` を先に作ってから実行すること。workspace が存在しないと `--workspace` が失敗する。）

- [ ] **Step 2: `apps/web/package.json`**

```json
{
  "name": "@skillam/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "test": "vitest run"
  }
}
```

（依存は Step 1 の `npm install` が書き込む。）

- [ ] **Step 3: `apps/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true
  }
})
```

`strictPort: true` にするのは、CORS で許可したオリジンが 5173 固定だから。勝手に 5174 へずれると原因の分かりにくい CORS エラーになる。

- [ ] **Step 4: `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 5: `apps/web/index.html`**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>skillam</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 失敗するテストを書く**

`apps/web/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App.js'

describe('App', () => {
  it('renders the product name', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'skillam' })).toBeDefined()
  })
})
```

Run: `npm run test -w @skillam/web`
Expected: FAIL — `Cannot find module './App.js'`

- [ ] **Step 7: 最小実装**

`apps/web/src/App.tsx`:

```tsx
export function App() {
  return <h1>skillam</h1>
}
```

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 8: ルートの `npm run dev` を同時起動にする**

ルート `package.json` の `scripts`:

```json
  "scripts": {
    "dev": "npm run dev --workspace @skillam/server & npm run dev --workspace @skillam/web",
    "test": "npm run test --workspaces --if-present"
  }
```

`&` による並列起動は Ctrl-C で片方が残ることがある。実装者は起動と停止を実際に試し、残る場合は `concurrently` の導入を提案すること（勝手に依存を増やさない）。

- [ ] **Step 9: 確認してコミット**

```bash
npm run test -w @skillam/web
npm run test
git add apps/web package.json package-lock.json
git commit -m "feat(web): scaffold the vite react workspace"
```

---

### Task 3: API の型定義

**Files:**
- Create: `apps/web/src/api/types.ts`

サーバー側の型を写す。サーバーと共有パッケージにはしない（server を web の依存にすると、UI のビルドが better-sqlite3 のネイティブ依存を引きずる）。写経なので、元の定義と食い違ったらサーバー側が正。

- [ ] **Step 1: 実装**（この Task はテスト不要。型のみで実行時の振る舞いを持たない）

`apps/web/src/api/types.ts`:

```ts
export interface Role {
  id: number
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface RoleSkill {
  id: number
  skillSource: 'user' | 'project-local' | 'plugin'
  skillPath: string
}

export interface RoleMcpServer {
  id: number
  name: string
  command: unknown
  env: Record<string, string>
}

export interface RoleAgent {
  id: number
  name: string
  markdownBody: string
  source: 'reference' | 'authored'
  sourcePath: string
}

export interface RoleDetail extends Role {
  skills: RoleSkill[]
  mcpServers: RoleMcpServer[]
  agents: RoleAgent[]
  permissions: { roleId: number; permissions: unknown } | null
}

export interface Project {
  id: number
  path: string
  name: string
  autoDetected: boolean
  excluded: boolean
  lastAppliedRoleId: number | null
  lastAppliedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectRole {
  roleId: number
  priority: number
}

export interface SkillCandidate {
  source: 'user' | 'plugin' | 'project-local'
  name: string
  description: string
  path: string
}

export interface AgentCandidate {
  source: 'user' | 'plugin' | 'project-local'
  name: string
  description: string
  markdownBody: string
  path: string
}

export interface McpServerCandidate {
  source: 'user' | 'project-local'
  name: string
  command: unknown
}

export interface PermissionsCandidate {
  source: 'project-local'
  projectPath: string
  permissions: unknown
}

export interface ScanCandidate {
  path: string
  name: string
}

export interface AutoDetectRoot {
  id: number
  path: string
  createdAt: string
}

export interface SecretSummary {
  id: number
  refName: string
  createdAt: string
  updatedAt: string
}

export interface FileChange {
  path: string
  before: string | null
  after: string
}

export type MaterializeOperation =
  | { type: 'create-link'; path: string; target: string }
  | { type: 'write-file'; path: string; content: string }
  | { type: 'remove'; path: string }

export interface ManagedState {
  mcpServers: string[]
  materialized: string[]
  permissionAllow: string[]
  permissionDeny: string[]
}

export interface ApplyPlan {
  projectId: number
  projectPath: string
  roleId: number
  settingsFile: FileChange
  mcpFile: FileChange
  mcpAfterObject: Record<string, unknown>
  operations: MaterializeOperation[]
  managed: ManagedState
}

export interface ApplyHistoryEntry {
  id: number
  projectId: number
  roleId: number | null
  diff: unknown
  managed: ManagedState
  status: 'success' | 'failed'
  errorMessage: string
  appliedAt: string
}

export interface ApplySuccess {
  status: 'success'
  historyId: number
  plan: ApplyPlan
}
```

- [ ] **Step 2: 型チェックしてコミット**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json
git add apps/web/src/api/types.ts
git commit -m "feat(web): add api type definitions"
```

---

### Task 4: API クライアント

サーバーは 409（衝突・何も書いていない）と 500（適用失敗・部分書き込みの可能性）を区別して返す。この区別を握りつぶさないクライアントにする。

**Files:**
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/client.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/api/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from './client.js'

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  it('returns ok with the parsed body on success', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { id: 1 }))

    const result = await apiRequest<{ id: number }>('/roles/1')

    expect(result).toEqual({ ok: true, data: { id: 1 } })
  })

  it('returns a conflict result for 409 so the caller can say nothing was written', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { error: '衝突しました' }))

    const result = await apiRequest('/projects/1/apply', { method: 'POST' })

    expect(result).toEqual({ ok: false, kind: 'conflict', message: '衝突しました' })
  })

  it('returns a failure result for 500 so the caller can warn about partial writes', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { error: '書き込みに失敗' }))

    const result = await apiRequest('/projects/1/apply', { method: 'POST' })

    expect(result).toEqual({ ok: false, kind: 'failure', message: '書き込みに失敗' })
  })

  it('returns a notFound result for 404', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { error: 'role not found' }))

    const result = await apiRequest('/roles/9999')

    expect(result).toEqual({ ok: false, kind: 'notFound', message: 'role not found' })
  })

  it('returns a badRequest result for 400', async () => {
    vi.stubGlobal('fetch', mockFetch(400, { error: 'name is required' }))

    const result = await apiRequest('/roles', { method: 'POST' })

    expect(result).toEqual({ ok: false, kind: 'badRequest', message: 'name is required' })
  })

  it('reports a network error instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))

    const result = await apiRequest('/roles')

    expect(result).toEqual({
      ok: false,
      kind: 'network',
      message: 'サーバーに接続できません。skillam のサーバーが起動しているか確認してください。'
    })
  })

  it('handles a 204 with no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => {
          throw new Error('no body')
        }
      })
    )

    const result = await apiRequest('/roles/1', { method: 'DELETE' })

    expect(result).toEqual({ ok: true, data: undefined })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/web -- src/api/client.test.ts`
Expected: FAIL — `Cannot find module './client.js'`

- [ ] **Step 3: 実装**

`apps/web/src/api/client.ts`:

```ts
const BASE_URL = 'http://127.0.0.1:4317'

export type ApiErrorKind = 'badRequest' | 'notFound' | 'conflict' | 'failure' | 'network'

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ApiErrorKind; message: string }

function kindForStatus(status: number): ApiErrorKind {
  if (status === 404) {
    return 'notFound'
  }
  if (status === 409) {
    return 'conflict'
  }
  if (status >= 400 && status < 500) {
    return 'badRequest'
  }
  return 'failure'
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) }
  if (init?.body !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers })
  } catch {
    return {
      ok: false,
      kind: 'network',
      message: 'サーバーに接続できません。skillam のサーバーが起動しているか確認してください。'
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  if (response.ok) {
    return { ok: true, data: body as T }
  }

  const message =
    typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `リクエストが失敗しました (HTTP ${response.status})`

  return { ok: false, kind: kindForStatus(response.status), message }
}
```

**`content-type` を body がある時だけ付ける理由**: 常に付けると Fastify が bodyless な DELETE を `Body cannot be empty when content-type is set to 'application/json'` として **400 で拒否する**（実サーバーで実測）。`deleteRole` / `deleteSecret` / `deleteAutoDetectRoot` の3つが全滅する。`fetch` をモックするユニットテストではこの不具合を検出できないので、ヘッダの有無を直接検証するテストを入れてある。

- [ ] **Step 4: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/web -- src/api/client.test.ts`
Expected: PASS（11テスト）

```bash
git add apps/web/src/api/client.ts apps/web/src/api/client.test.ts
git commit -m "feat(web): add a typed api client that distinguishes conflicts from failures"
```

---

### Task 5: 行単位 diff の純関数

**Files:**
- Create: `apps/web/src/lib/diff.ts`
- Create: `apps/web/src/lib/diff.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/lib/diff.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { diffLines } from './diff.js'

describe('diffLines', () => {
  it('marks every line as added when the file did not exist', () => {
    expect(diffLines(null, 'a\nb\n')).toEqual([
      { kind: 'added', text: 'a' },
      { kind: 'added', text: 'b' }
    ])
  })

  it('marks unchanged lines as context', () => {
    expect(diffLines('a\nb\n', 'a\nb\n')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'context', text: 'b' }
    ])
  })

  it('marks a removed line', () => {
    expect(diffLines('a\nb\n', 'a\n')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' }
    ])
  })

  it('marks a replaced line as removed then added', () => {
    expect(diffLines('a\n', 'b\n')).toEqual([
      { kind: 'removed', text: 'a' },
      { kind: 'added', text: 'b' }
    ])
  })

  it('ignores a trailing newline difference only', () => {
    expect(diffLines('a\n', 'a')).toEqual([{ kind: 'context', text: 'a' }])
  })

  it('returns an empty list for two empty files', () => {
    expect(diffLines('', '')).toEqual([])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/web -- src/lib/diff.test.ts`
Expected: FAIL — `Cannot find module './diff.js'`

- [ ] **Step 3: 実装**

`apps/web/src/lib/diff.ts`:

```ts
export type DiffLineKind = 'context' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

function toLines(value: string | null): string[] {
  if (value === null || value === '') {
    return []
  }
  const withoutTrailingNewline = value.endsWith('\n') ? value.slice(0, -1) : value
  return withoutTrailingNewline.split('\n')
}

export function diffLines(before: string | null, after: string): DiffLine[] {
  const beforeLines = toLines(before)
  const afterLines = toLines(after)
  const result: DiffLine[] = []

  const max = Math.max(beforeLines.length, afterLines.length)
  for (let index = 0; index < max; index += 1) {
    const beforeLine = beforeLines[index]
    const afterLine = afterLines[index]

    if (beforeLine !== undefined && afterLine !== undefined && beforeLine === afterLine) {
      result.push({ kind: 'context', text: beforeLine })
      continue
    }
    if (beforeLine !== undefined) {
      result.push({ kind: 'removed', text: beforeLine })
    }
    if (afterLine !== undefined) {
      result.push({ kind: 'added', text: afterLine })
    }
  }

  return result
}
```

**この実装の限界を承知しておくこと**: 行番号で突き合わせるだけなので、行が1行挿入されると以降すべてが removed+added として表示される。skillam が扱うのは `JSON.stringify(value, null, 2)` で整形された設定ファイルであり、差分は基本的に数行なので実用上は問題ない。もし表示が読みにくいという実測が出たら、そのときに LCS ベースへ差し替える。**先回りで LCS を実装しないこと**（YAGNI）。

- [ ] **Step 4: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/web -- src/lib/diff.test.ts`
Expected: PASS（6テスト）

```bash
git add apps/web/src/lib/diff.ts apps/web/src/lib/diff.test.ts
git commit -m "feat(web): add line based diff calculation"
```

---

### Task 6: DiffView コンポーネント

**Files:**
- Create: `apps/web/src/components/DiffView.tsx`
- Create: `apps/web/src/components/DiffView.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/components/DiffView.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DiffView } from './DiffView.js'

describe('DiffView', () => {
  it('shows the file path', () => {
    render(<DiffView change={{ path: '/p/.claude/settings.json', before: null, after: '{}\n' }} />)

    expect(screen.getByText('/p/.claude/settings.json')).toBeDefined()
  })

  it('labels a file that does not exist yet as new', () => {
    render(<DiffView change={{ path: '/p/.mcp.json', before: null, after: '{}\n' }} />)

    expect(screen.getByText('新規作成')).toBeDefined()
  })

  it('says there is no change when before and after match', () => {
    render(<DiffView change={{ path: '/p/.mcp.json', before: '{}\n', after: '{}\n' }} />)

    expect(screen.getByText('変更なし')).toBeDefined()
  })

  it('renders added and removed lines with distinguishable roles', () => {
    render(<DiffView change={{ path: '/p/x.json', before: 'old\n', after: 'new\n' }} />)

    expect(screen.getByText('old').getAttribute('data-kind')).toBe('removed')
    expect(screen.getByText('new').getAttribute('data-kind')).toBe('added')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/web -- src/components/DiffView.test.tsx`
Expected: FAIL — `Cannot find module './DiffView.js'`

- [ ] **Step 3: 実装**

`apps/web/src/components/DiffView.tsx`:

```tsx
import { diffLines } from '../lib/diff.js'
import type { FileChange } from '../api/types.js'

const KIND_PREFIX: Record<string, string> = {
  context: ' ',
  added: '+',
  removed: '-'
}

const KIND_COLOR: Record<string, string> = {
  context: 'transparent',
  added: '#e6ffed',
  removed: '#ffeef0'
}

export function DiffView({ change }: { change: FileChange }) {
  const lines = diffLines(change.before, change.after)
  const unchanged = change.before === change.after

  return (
    <section>
      <h3>
        <code>{change.path}</code>{' '}
        {change.before === null ? <span>新規作成</span> : null}
        {unchanged ? <span>変更なし</span> : null}
      </h3>
      <pre>
        {lines.map((line, index) => (
          <div
            key={index}
            data-kind={line.kind}
            style={{ backgroundColor: KIND_COLOR[line.kind] }}
          >
            {KIND_PREFIX[line.kind]}
            {line.text}
          </div>
        ))}
      </pre>
    </section>
  )
}
```

色は背景色だけに頼らず `data-kind` 属性も出す。色覚特性のあるユーザーと、テストの両方のため。

- [ ] **Step 4: テストが通ることを確認してコミット**

```bash
npm run test -w @skillam/web -- src/components/DiffView.test.tsx
git add apps/web/src/components/DiffView.tsx apps/web/src/components/DiffView.test.tsx
git commit -m "feat(web): add a diff view component"
```

---

### Task 7: ConfirmDialog コンポーネント

破壊的操作（ロール解除・シークレット削除・プロジェクト除外）に確認を挟む（設計書 §12）。

**Files:**
- Create: `apps/web/src/components/ConfirmDialog.tsx`
- Create: `apps/web/src/components/ConfirmDialog.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog.js'

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog open={false} message="消しますか" onConfirm={() => {}} onCancel={() => {}} />
    )

    expect(screen.queryByText('消しますか')).toBeNull()
  })

  it('calls onConfirm when the confirm button is pressed', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog open message="消しますか" onConfirm={onConfirm} onCancel={() => {}} />
    )

    await userEvent.click(screen.getByRole('button', { name: '実行する' }))

    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when the cancel button is pressed', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open message="消しますか" onConfirm={() => {}} onCancel={onCancel} />)

    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 失敗を確認 → 実装**

`apps/web/src/components/ConfirmDialog.tsx`:

```tsx
export interface ConfirmDialogProps {
  open: boolean
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, message, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) {
    return null
  }
  return (
    <div role="dialog" aria-modal="true">
      <p>{message}</p>
      <button type="button" onClick={onConfirm}>
        実行する
      </button>
      <button type="button" onClick={onCancel}>
        やめる
      </button>
    </div>
  )
}
```

- [ ] **Step 3: 通ることを確認してコミット**

```bash
npm run test -w @skillam/web -- src/components/ConfirmDialog.test.tsx
git add apps/web/src/components/ConfirmDialog.tsx apps/web/src/components/ConfirmDialog.test.tsx
git commit -m "feat(web): add a confirm dialog for destructive actions"
```

---

### Task 8: ルーティングとレイアウト

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Create: `apps/web/src/pages/Dashboard.tsx`（プレースホルダ）
- Create: `apps/web/src/pages/Roles.tsx`（プレースホルダ）
- Create: `apps/web/src/pages/Catalog.tsx`（プレースホルダ）
- Create: `apps/web/src/pages/Settings.tsx`（プレースホルダ）

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/App.test.tsx` を次の内容に置き換える:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from './App.js'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  )
}

describe('AppRoutes', () => {
  it('shows the dashboard at the root path', () => {
    renderAt('/')

    expect(screen.getByRole('heading', { name: 'プロジェクト' })).toBeDefined()
  })

  it('shows roles at /roles', () => {
    renderAt('/roles')

    expect(screen.getByRole('heading', { name: 'ロール' })).toBeDefined()
  })

  it('shows the catalog at /catalog', () => {
    renderAt('/catalog')

    expect(screen.getByRole('heading', { name: 'カタログ' })).toBeDefined()
  })

  it('shows settings at /settings', () => {
    renderAt('/settings')

    expect(screen.getByRole('heading', { name: '設定' })).toBeDefined()
  })

  it('offers navigation to every section', () => {
    renderAt('/')

    for (const label of ['プロジェクト', 'ロール', 'カタログ', '設定']) {
      expect(screen.getByRole('link', { name: label })).toBeDefined()
    }
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npm run test -w @skillam/web -- src/App.test.tsx`
Expected: FAIL — `AppRoutes` が存在しない

- [ ] **Step 3: プレースホルダの各ページを作る**

4ファイルとも同じ形。`Dashboard.tsx` の例:

```tsx
export function Dashboard() {
  return <h1>プロジェクト</h1>
}
```

`Roles.tsx` は `ロール`、`Catalog.tsx` は `カタログ`、`Settings.tsx` は `設定` を見出しにする。中身は後続タスクで実装する。

- [ ] **Step 4: `App.tsx` を実装**

```tsx
import { Link, Route, Routes } from 'react-router-dom'
import { BrowserRouter } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard.js'
import { Roles } from './pages/Roles.js'
import { Catalog } from './pages/Catalog.js'
import { Settings } from './pages/Settings.js'

export function AppRoutes() {
  return (
    <>
      <nav>
        <Link to="/">プロジェクト</Link>
        <Link to="/roles">ロール</Link>
        <Link to="/catalog">カタログ</Link>
        <Link to="/settings">設定</Link>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
```

`AppRoutes` と `App` を分けているのは、テストで `MemoryRouter` を差し込めるようにするため。`BrowserRouter` を内包した `App` をそのままテストするとルートを指定できない。

- [ ] **Step 5: 通ることを確認してコミット**

```bash
npm run test -w @skillam/web
git add apps/web/src
git commit -m "feat(web): add routing and the app shell"
```

---

### Task 9: データ取得フック

各画面で「読み込み中 / エラー / データ」の3状態を毎回書くのを避ける。

**Files:**
- Create: `apps/web/src/lib/useApi.ts`
- Create: `apps/web/src/lib/useApi.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useApi } from './useApi.js'

describe('useApi', () => {
  it('starts in a loading state', () => {
    const { result } = renderHook(() => useApi(async () => ({ ok: true as const, data: 1 })))

    expect(result.current.loading).toBe(true)
  })

  it('exposes the data once resolved', async () => {
    const { result } = renderHook(() => useApi(async () => ({ ok: true as const, data: 42 })))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe(42)
    expect(result.current.error).toBeNull()
  })

  it('exposes the message when the request fails', async () => {
    const { result } = renderHook(() =>
      useApi(async () => ({ ok: false as const, kind: 'network' as const, message: 'つながらない' }))
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('つながらない')
  })

  it('refetches when reload is called', async () => {
    let count = 0
    const { result } = renderHook(() =>
      useApi(async () => {
        count += 1
        return { ok: true as const, data: count }
      })
    )

    await waitFor(() => expect(result.current.data).toBe(1))
    result.current.reload()
    await waitFor(() => expect(result.current.data).toBe(2))
  })
})
```

- [ ] **Step 2: 失敗を確認 → 実装**

`apps/web/src/lib/useApi.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import type { ApiResult } from '../api/client.js'

export interface UseApiState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

export function useApi<T>(fetcher: () => Promise<ApiResult<T>>): UseApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetcher().then((result) => {
      if (cancelled) {
        return
      }
      if (result.ok) {
        setData(result.data)
        setError(null)
      } else {
        setData(null)
        setError(result.message)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])

  return { data, error, loading, reload }
}
```

`fetcher` を依存配列に入れていないのは意図的。呼び出し側がインラインのアロー関数を渡すと毎レンダーで参照が変わり無限ループになるため、再取得は `reload()` で明示的に行う契約にしている。実装者はこの理由をコード内のコメントとしても残すこと。

- [ ] **Step 3: 通ることを確認してコミット**

```bash
npm run test -w @skillam/web -- src/lib/useApi.test.tsx
git add apps/web/src/lib/useApi.ts apps/web/src/lib/useApi.test.tsx
git commit -m "feat(web): add a data fetching hook"
```

---

### Task 10: Dashboard — 登録済みプロジェクト一覧

**Files:**
- Modify: `apps/web/src/pages/Dashboard.tsx`
- Create: `apps/web/src/pages/Dashboard.test.tsx`
- Create: `apps/web/src/api/projects.ts`

- [ ] **Step 1: API 関数を作る**

`apps/web/src/api/projects.ts`:

```ts
import { apiRequest } from './client.js'
import type {
  Project,
  ProjectRole,
  ScanCandidate,
  ApplyHistoryEntry,
  ApplyPlan,
  ApplySuccess
} from './types.js'

export const listProjects = () => apiRequest<Project[]>('/projects')

export const getProject = (id: number) => apiRequest<Project>(`/projects/${id}`)

export const scanProjects = () => apiRequest<ScanCandidate[]>('/projects/scan')

export const createProject = (path: string, name: string) =>
  apiRequest<Project>('/projects', { method: 'POST', body: JSON.stringify({ path, name }) })

export const updateProject = (id: number, body: { name?: string; excluded?: boolean }) =>
  apiRequest<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) })

export const listProjectRoles = (id: number) => apiRequest<ProjectRole[]>(`/projects/${id}/roles`)

export const setProjectRoles = (id: number, roleIds: number[]) =>
  apiRequest<ProjectRole[]>(`/projects/${id}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ roleIds })
  })

export const previewApply = (id: number, roleId: number) =>
  apiRequest<ApplyPlan>(`/projects/${id}/apply/preview`, {
    method: 'POST',
    body: JSON.stringify({ roleId })
  })

export const applyRole = (id: number, roleId: number) =>
  apiRequest<ApplySuccess>(`/projects/${id}/apply`, {
    method: 'POST',
    body: JSON.stringify({ roleId })
  })

export const listApplyHistory = (id: number) =>
  apiRequest<ApplyHistoryEntry[]>(`/projects/${id}/apply-history`)
```

`GET /projects/scan` は `ScanCandidate[]`（`{ path, name }`）を返す。`name` は候補ディレクトリ名がすでに入っているので、登録時にパスから basename を計算し直す必要はない。

- [ ] **Step 2: 失敗するテストを書く**

`apps/web/src/pages/Dashboard.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from './Dashboard.js'

function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const { status, body } = handler(String(url))
      return { ok: status < 400, status, json: async () => body }
    })
  )
}

const project = {
  id: 1,
  path: '/Users/me/dev/app',
  name: 'app',
  autoDetected: false,
  excluded: false,
  lastAppliedRoleId: null,
  lastAppliedAt: null,
  createdAt: '2026-08-27 00:00:00',
  updatedAt: '2026-08-27 00:00:00'
}

afterEach(() => vi.unstubAllGlobals())

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  )
}

describe('Dashboard', () => {
  it('lists registered projects', async () => {
    stubFetch((url) => ({ status: 200, body: url.includes('/scan') ? [] : [project] }))

    renderDashboard()

    await waitFor(() => expect(screen.getByText('app')).toBeDefined())
    expect(screen.getByText('/Users/me/dev/app')).toBeDefined()
  })

  it('shows the server error when the list cannot be loaded', async () => {
    stubFetch(() => ({ status: 500, body: { error: 'DBが壊れています' } }))

    renderDashboard()

    await waitFor(() => expect(screen.getByText(/DBが壊れています/)).toBeDefined())
  })

  it('shows an empty state when nothing is registered', async () => {
    stubFetch(() => ({ status: 200, body: [] }))

    renderDashboard()

    await waitFor(() =>
      expect(screen.getByText('登録されたプロジェクトはありません。')).toBeDefined()
    )
  })

  it('links each project to its detail page', async () => {
    stubFetch((url) => ({ status: 200, body: url.includes('/scan') ? [] : [project] }))

    renderDashboard()

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'app' }).getAttribute('href')).toBe('/projects/1')
    )
  })
})
```

- [ ] **Step 3: 失敗を確認 → 実装**

`Dashboard.tsx` は `useApi(listProjects)` と `useApi(scanProjects)` を使い、登録済み一覧と未登録候補を別セクションで出す。未登録候補の「登録」ボタンは Task 11 で扱うので、この Task では登録済み一覧・エラー表示・空状態・詳細リンクだけを実装する。

- [ ] **Step 4: 通ることを確認してコミット**

```bash
npm run test -w @skillam/web -- src/pages/Dashboard.test.tsx
git add apps/web/src/api/projects.ts apps/web/src/pages/Dashboard.tsx apps/web/src/pages/Dashboard.test.tsx
git commit -m "feat(web): list registered projects on the dashboard"
```

---

### Task 11: Dashboard — 未登録プロジェクトの検出と登録

設計書 §9 の「自動登録はしない。ユーザーが個別に選ぶ」を守る。

**Files:**
- Modify: `apps/web/src/pages/Dashboard.tsx`
- Modify: `apps/web/src/pages/Dashboard.test.tsx`

- [ ] **Step 1: 失敗するテストを追加**

```tsx
  it('lists detected but unregistered candidates separately', async () => {
    stubFetch((url) => ({
      status: 200,
      body: url.includes('/scan') ? [{ path: '/Users/me/dev/new-app' }] : []
    }))

    renderDashboard()

    await waitFor(() => expect(screen.getByText('/Users/me/dev/new-app')).toBeDefined())
    expect(screen.getByRole('button', { name: '登録する' })).toBeDefined()
  })

  it('registers a candidate and refreshes the list', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const target = String(url)
        calls.push(`${init?.method ?? 'GET'} ${target}`)
        if (target.includes('/scan')) {
          return { ok: true, status: 200, json: async () => (calls.length > 3 ? [] : [{ path: '/x' }]) }
        }
        if (init?.method === 'POST') {
          return { ok: true, status: 201, json: async () => ({ ...project, id: 2, path: '/x' }) }
        }
        return { ok: true, status: 200, json: async () => [] }
      })
    )

    renderDashboard()
    await waitFor(() => expect(screen.getByRole('button', { name: '登録する' })).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(calls.some((c) => c.startsWith('POST'))).toBe(true))
  })

  it('shows a message when a candidate cannot be registered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/scan')) {
          return { ok: true, status: 200, json: async () => [{ path: '/x' }] }
        }
        if (init?.method === 'POST') {
          return { ok: false, status: 400, json: async () => ({ error: 'パスが存在しません' }) }
        }
        return { ok: true, status: 200, json: async () => [] }
      })
    )

    renderDashboard()
    await waitFor(() => expect(screen.getByRole('button', { name: '登録する' })).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(screen.getByText(/パスが存在しません/)).toBeDefined())
  })
```

（`userEvent` の import を追加すること。）

- [ ] **Step 2: 失敗を確認 → 実装**

未登録候補セクションに「登録する」ボタンを置き、押下で `createProject(candidate.path, candidate.name)` を呼び、成功したら両方の一覧を `reload()` する。失敗したらメッセージを表示する。

- [ ] **Step 3: 通ることを確認してコミット**

```bash
npm run test -w @skillam/web -- src/pages/Dashboard.test.tsx
git add apps/web/src/pages/Dashboard.tsx apps/web/src/pages/Dashboard.test.tsx
git commit -m "feat(web): register detected projects from the dashboard"
```

---

### Task 12: Project 詳細 — 基本情報とロール割当

**Files:**
- Create: `apps/web/src/pages/ProjectDetail.tsx`
- Create: `apps/web/src/pages/ProjectDetail.test.tsx`
- Create: `apps/web/src/api/roles.ts`
- Modify: `apps/web/src/App.tsx`（`/projects/:id` ルート追加）

- [ ] **Step 1: `apps/web/src/api/roles.ts` を作る**

```ts
import { apiRequest } from './client.js'
import type { Role, RoleDetail, RoleSkill, RoleMcpServer, RoleAgent } from './types.js'

export const listRoles = () => apiRequest<Role[]>('/roles')

export const getRole = (id: number) => apiRequest<RoleDetail>(`/roles/${id}`)

export const createRole = (name: string, description?: string) =>
  apiRequest<Role>('/roles', { method: 'POST', body: JSON.stringify({ name, description }) })

export const updateRole = (id: number, body: { name?: string; description?: string }) =>
  apiRequest<Role>(`/roles/${id}`, { method: 'PUT', body: JSON.stringify(body) })

export const deleteRole = (id: number) => apiRequest<void>(`/roles/${id}`, { method: 'DELETE' })

export const setRoleSkills = (id: number, skills: Omit<RoleSkill, 'id'>[]) =>
  apiRequest<RoleSkill[]>(`/roles/${id}/skills`, { method: 'PUT', body: JSON.stringify({ skills }) })

export const setRoleMcpServers = (id: number, servers: Omit<RoleMcpServer, 'id'>[]) =>
  apiRequest<RoleMcpServer[]>(`/roles/${id}/mcp-servers`, {
    method: 'PUT',
    body: JSON.stringify({ servers })
  })

export const setRoleAgents = (id: number, agents: Omit<RoleAgent, 'id'>[]) =>
  apiRequest<RoleAgent[]>(`/roles/${id}/agents`, { method: 'PUT', body: JSON.stringify({ agents }) })

export const setRolePermissions = (id: number, permissions: unknown) =>
  apiRequest<unknown>(`/roles/${id}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissions })
  })
```

**ボディのキー名に注意**: skills は `{ skills }`、MCP は `{ servers }`（`mcpServers` ではない）、agents は `{ agents }`、permissions は `{ permissions }`。Phase 3a の実装時にここを取り違えた実例があるので、`apps/server/src/roles/roles.routes.ts` を開いて必ず確認すること。

- [ ] **Step 2: 失敗するテストを書く**

```tsx
  it('shows the project name and path', async () => { /* GET /projects/1 をスタブ */ })
  it('shows which role is currently assigned', async () => { /* GET /projects/1/roles */ })
  it('lets the user assign a role', async () => { /* PUT /projects/1/roles が呼ばれる */ })
  it('shows the last applied role and timestamp', async () => { /* lastAppliedAt を表示 */ })
```

実装者はこの4項目を、Task 10 の `stubFetch` と同じ形で具体的なテストコードに展開すること。URL ごとにレスポンスを出し分けるスタブを使う。

- [ ] **Step 3: 失敗を確認 → 実装**

`useParams()` で `id` を取り、`getProject` / `listProjectRoles` / `listRoles` を読む。ロール選択は `<select>`（Phase 3a の適用は単一ロールのみ扱うため、複数選択UIは作らない）。選択したら `setProjectRoles(id, [roleId])` を呼ぶ。

- [ ] **Step 4: `App.tsx` に `/projects/:id` を追加してコミット**

```bash
npm run test -w @skillam/web
git add apps/web/src
git commit -m "feat(web): add the project detail page with role assignment"
```

---

### Task 13: Project 詳細 — 適用プレビュー

**Files:**
- Modify: `apps/web/src/pages/ProjectDetail.tsx`
- Modify: `apps/web/src/pages/ProjectDetail.test.tsx`

- [ ] **Step 1: 失敗するテストを追加**

```tsx
  it('shows both file diffs after previewing', async () => {
    // POST /projects/1/apply/preview → 200 + ApplyPlan
    // settingsFile.path と mcpFile.path の両方が画面に出ること
  })

  it('lists the symlink operations that would run', async () => {
    // operations に create-link が1件 → その path と target が出ること
  })

  it('shows a conflict message and hides the apply button on 409', async () => {
    // POST preview → 409 + { error: '...衝突...' }
    // エラー文が出て、name: '適用する' のボタンが存在しないこと
  })

  it('says nothing was written when a conflict happens', async () => {
    // 409 のとき「ファイルは変更されていません」と明示されること
  })
```

409 のとき適用ボタンを消すのが重要。押しても同じ 409 が返るだけで、ユーザーを混乱させる。

- [ ] **Step 2: 失敗を確認 → 実装**

「プレビュー」ボタン → `previewApply(projectId, roleId)`。
- `ok: true` → `DiffView` を2つ（settings / mcp）と操作一覧を表示し、「適用する」ボタンを出す
- `kind: 'conflict'` → メッセージと「ファイルは変更されていません」を表示。適用ボタンは出さない
- その他 → メッセージのみ

- [ ] **Step 3: 通ることを確認してコミット**

```bash
npm run test -w @skillam/web -- src/pages/ProjectDetail.test.tsx
git add apps/web/src/pages/ProjectDetail.tsx apps/web/src/pages/ProjectDetail.test.tsx
git commit -m "feat(web): preview an apply before running it"
```

---

### Task 14: Project 詳細 — 適用の実行

**Files:**
- Modify: `apps/web/src/pages/ProjectDetail.tsx`
- Modify: `apps/web/src/pages/ProjectDetail.test.tsx`

- [ ] **Step 1: 失敗するテストを追加**

```tsx
  it('applies and reports success', async () => {
    // プレビュー → 適用する → POST /projects/1/apply が 200
    // 「適用しました」が出ること
  })

  it('warns about possible partial writes when the apply fails', async () => {
    // POST /apply → 500 + { error: 'シークレット参照が解決できません: ...' }
    // エラー文に加えて「一部のファイルが書き込まれている可能性があります」が出ること
  })

  it('reloads the history after applying', async () => {
    // 適用後に GET /projects/1/apply-history が再度呼ばれること
  })
```

500 のときに「部分書き込みの可能性」を明示するのは設計書 §12 の方針（ロールバックしない）を UI 側で守るため。ここを単なる「失敗しました」にすると、ユーザーはファイルが無傷だと誤解する。

- [ ] **Step 2: 失敗を確認 → 実装**

- [ ] **Step 3: 通ることを確認してコミット**

```bash
git add apps/web/src/pages/ProjectDetail.tsx apps/web/src/pages/ProjectDetail.test.tsx
git commit -m "feat(web): run an apply and report partial write risk on failure"
```

---

### Task 15: Project 詳細 — 適用履歴

**Files:**
- Modify: `apps/web/src/pages/ProjectDetail.tsx`
- Modify: `apps/web/src/pages/ProjectDetail.test.tsx`

- [ ] **Step 1: 失敗するテストを追加**

```tsx
  it('lists history newest first with status and timestamp', async () => {})
  it('shows the error message of a failed entry', async () => {})
  it('shows an empty state when never applied', async () => {})
  it('renders an entry whose role has been deleted', async () => {
    // roleId: null のエントリで落ちないこと。「削除されたロール」と表示する
  })
```

最後の1件は実際に起こる。`apply_history.role_id` は `ON DELETE SET NULL` なので、ロールを消すと `roleId: null` の履歴が残る。

- [ ] **Step 2: 失敗を確認 → 実装 → コミット**

```bash
git add apps/web/src/pages/ProjectDetail.tsx apps/web/src/pages/ProjectDetail.test.tsx
git commit -m "feat(web): show the apply history of a project"
```

---

### Task 16: Roles — 一覧と作成・削除

**Files:**
- Modify: `apps/web/src/pages/Roles.tsx`
- Create: `apps/web/src/pages/Roles.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
  it('lists roles', async () => {})
  it('creates a role', async () => {})
  it('shows the server message when the name is taken', async () => {
    // POST /roles → 409 { error: 'a role named "dev" already exists' }
  })
  it('asks for confirmation before deleting', async () => {
    // 削除ボタン → ConfirmDialog が出る。やめる → DELETE が呼ばれない
  })
  it('deletes after confirmation', async () => {})
  it('links each role to its editor', async () => {})
```

- [ ] **Step 2: 失敗を確認 → 実装 → コミット**

```bash
git add apps/web/src/pages/Roles.tsx apps/web/src/pages/Roles.test.tsx
git commit -m "feat(web): list, create and delete roles"
```

---

### Task 17: RoleEditor — Skills / Agents タブ

カタログから選ぶ形にする。手入力させない（パスの打ち間違いは適用時に「リンク先が存在しません」で弾かれるが、選択式なら最初から起きない）。

**Files:**
- Create: `apps/web/src/pages/RoleEditor.tsx`
- Create: `apps/web/src/pages/RoleEditor.test.tsx`
- Create: `apps/web/src/api/catalog.ts`
- Modify: `apps/web/src/App.tsx`（`/roles/:id` ルート追加）

- [ ] **Step 1: `apps/web/src/api/catalog.ts`**

```ts
import { apiRequest } from './client.js'
import type { SkillCandidate, AgentCandidate, McpServerCandidate, PermissionsCandidate } from './types.js'

export const listSkillCandidates = () => apiRequest<SkillCandidate[]>('/catalog/skills')
export const listAgentCandidates = () => apiRequest<AgentCandidate[]>('/catalog/agents')
export const listMcpCandidates = () => apiRequest<McpServerCandidate[]>('/catalog/mcp-servers')
export const listPermissionCandidates = () => apiRequest<PermissionsCandidate[]>('/catalog/permissions')
```

- [ ] **Step 2: 失敗するテストを書く**

```tsx
  it('checks the skills already in the role', async () => {})
  it('adds a skill by checking it and saving', async () => {
    // PUT /roles/1/skills が { skills: [{ skillSource, skillPath }] } で呼ばれること
  })
  it('groups candidates by source', async () => {
    // user / plugin / project-local の見出しが出ること
  })
  it('warns that a reference agent needs a source path', async () => {
    // カタログ由来の agent は path を持つので sourcePath に入れる
  })
```

カタログの skills は500件を超えることがある（実測525件）。全件を素の一覧で出すと使い物にならないので、**絞り込み入力を必ず付ける**こと。テストにも「絞り込むと件数が減る」ケースを1つ入れる。

- [ ] **Step 3: 失敗を確認 → 実装 → コミット**

```bash
git add apps/web/src/api/catalog.ts apps/web/src/pages/RoleEditor.tsx apps/web/src/pages/RoleEditor.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): edit the skills and agents of a role"
```

---

### Task 18: RoleEditor — MCP / Permissions タブ

**Files:**
- Modify: `apps/web/src/pages/RoleEditor.tsx`
- Modify: `apps/web/src/pages/RoleEditor.test.tsx`

- [ ] **Step 1: 失敗するテストを追加**

```tsx
  it('shows a secret_ref env value as a reference, never as plaintext', async () => {
    // env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } → 「シークレット参照」と表示
  })
  it('edits permission allow entries as a list', async () => {})
  it('saves permissions as { allow, deny }', async () => {
    // PUT /roles/1/permissions が { permissions: { allow: [...], deny: [...] } }
  })
```

`secret_ref:` の値をそのままテキスト入力欄に出すと、ユーザーが編集して参照を壊す。参照であることを明示し、値の変更は Settings 側のシークレット管理へ誘導する。

- [ ] **Step 2: 失敗を確認 → 実装 → コミット**

```bash
git add apps/web/src/pages/RoleEditor.tsx apps/web/src/pages/RoleEditor.test.tsx
git commit -m "feat(web): edit mcp servers and permissions of a role"
```

---

### Task 19: Catalog と Settings

**Files:**
- Modify: `apps/web/src/pages/Catalog.tsx`
- Create: `apps/web/src/pages/Catalog.test.tsx`
- Modify: `apps/web/src/pages/Settings.tsx`
- Create: `apps/web/src/pages/Settings.test.tsx`
- Create: `apps/web/src/api/settings.ts`

- [ ] **Step 1: Catalog のテストと実装**

```tsx
  it('shows skills, agents, mcp servers and permissions in tabs', async () => {})
  it('filters the list by keyword', async () => {})
  it('refreshes on demand', async () => {})
  it('shows the count of each source', async () => {})
```

- [ ] **Step 2: Settings のテストと実装**

`apps/web/src/api/settings.ts`:

```ts
import { apiRequest } from './client.js'
import type { AutoDetectRoot, SecretSummary } from './types.js'

export const listAutoDetectRoots = () => apiRequest<AutoDetectRoot[]>('/auto-detect-roots')
export const addAutoDetectRoot = (path: string) =>
  apiRequest<AutoDetectRoot>('/auto-detect-roots', { method: 'POST', body: JSON.stringify({ path }) })
export const deleteAutoDetectRoot = (id: number) =>
  apiRequest<void>(`/auto-detect-roots/${id}`, { method: 'DELETE' })
export const listSecrets = () => apiRequest<SecretSummary[]>('/secrets')
export const deleteSecret = (id: number) => apiRequest<void>(`/secrets/${id}`, { method: 'DELETE' })
export const revealSecret = (id: number) =>
  apiRequest<{ value: string }>(`/secrets/${id}/reveal`, { method: 'POST' })
```

```tsx
  it('lists auto detect roots', async () => {})
  it('adds a root', async () => {})
  it('asks for confirmation before deleting a root', async () => {})
  it('lists secrets by reference name without any value', async () => {
    // GET /secrets は値を返さない。画面にも値の欄を作らないこと
  })
  it('reveals a secret only after an explicit action', async () => {
    // 「表示」ボタンを押すまで POST /secrets/:id/reveal を呼ばない
  })
  it('asks for confirmation before deleting a secret', async () => {})
```

- [ ] **Step 3: 通ることを確認してコミット**

```bash
npm run test -w @skillam/web
git add apps/web/src
git commit -m "feat(web): add the catalog and settings pages"
```

---

### Task 20: 実環境に対する手動E2E検証

**Files:** なし（検証のみ）

このタスクは**実ファイルを書き換える**。書き換え先は `/tmp` 配下の使い捨てプロジェクトに限定し、`~/Develop` の実プロジェクトには適用しないこと。DBもスクラッチパスを使う。

- [ ] **Step 1: 残留プロセスの確認**

```bash
lsof -i :4317 -sTCP:LISTEN
lsof -i :5173 -sTCP:LISTEN
```

- [ ] **Step 2: スクラッチDBで両方を起動**

```bash
mkdir -p /tmp/skillam-phase4-verify/project
SKILLAM_DB_PATH=/tmp/skillam-phase4-verify/skillam.db npm run dev &> /tmp/skillam-phase4-verify.log &
```

`/health` と `http://localhost:5173` の両方が応答するまで待つ。

- [ ] **Step 3: ブラウザで通しの操作**

以下を順に手で行い、各段階のスクリーンショットか観察結果を記録する。

1. Settings で `/tmp/skillam-phase4-verify` を自動検出ルートに追加
2. Dashboard に `project` が未登録候補として現れる → 登録する
3. Roles で新規ロールを作り、RoleEditor で実在する user Skill を1つ選ぶ。permissions に `Read(*)` を追加
4. Project 詳細でそのロールを割り当て、プレビューを押す
   - settings.json が「新規作成」、operations に create-link が1件出ること
5. 適用する → 成功表示 → 履歴に1件出ること
6. `/tmp/skillam-phase4-verify/project/.claude/` を確認（settings.json と skills/ の symlink）
7. `.claude/skills/` に手で実ディレクトリを作り、再度プレビュー
   - **409 が出て、適用ボタンが出ないこと**（Task 13 の核心）
   - 「ファイルは変更されていません」が出ること
8. その実ディレクトリを消して再プレビュー → 通常表示に戻ること

- [ ] **Step 4: 副作用の確認**

```bash
ls -la ~/.skillam
ls ~/.claude/skills
```

実DBの mtime が変わっていないこと、実 Skill が無傷であることを確認する。

- [ ] **Step 5: 後片付け**

```bash
lsof -ti:4317 -sTCP:LISTEN | xargs kill
lsof -ti:5173 -sTCP:LISTEN | xargs kill
rm -rf /tmp/skillam-phase4-verify /tmp/skillam-phase4-verify.log
```

- [ ] **Step 6: 全テストを流す**

Run: `npm test`（ルートから server と web の両方）
Expected: PASS

- [ ] **Step 7: このタスクはコミットしない**（検証のみ）

---

## Phase 4 Definition of Done

- `npm run dev` でサーバーと Web UI が同時に起動し、ブラウザから操作できる
- 設計書 §11 の5画面がすべて存在し、それぞれの主要操作が動く
- 適用フローが画面から通しで実行でき、**409（衝突・無変更）と 500（失敗・部分書き込みの可能性）が別表示になっている**
- シークレットの値は一覧に出ず、明示操作でのみ表示される
- 破壊的操作（ロール削除・シークレット削除・ルート削除）に確認ダイアログが挟まる
- カタログの数百件規模の一覧に絞り込みがある
- server / web 双方のテストが `npm test` で全件パスする
- 手動E2E（Task 20）で実環境に対する通し操作が確認できている

## 次フェーズ（この計画には含まない）

- **Phase 3b:** ドリフト検知（Dashboard のバッジ）、ロール定義のJSONエクスポート/インポート
- preview と apply の乖離検出（プランのハッシュ照合）— UI ができたこのフェーズの後に入れるのが自然
- プロジェクト単位の適用ロック

---

## Phase 5 への申し送り: Electron 化

Phase 4 完了後、デスクトップアプリ（Electron）へ移行することが決まっている。ローカルのファイルとキーチェーンを操作するツールであり、URL を共有する意味がなく、起動のたびにターミナルとブラウザを行き来するのが実害であるため。

Phase 4 の実装は、この移行を前提に以下を守ること。**レンダラは Web 技術なので `apps/web` はほぼそのまま再利用できる。捨てる作業にはならない。**

### Phase 4 の時点で対応済みにするもの

- **`HashRouter` を使う**（`BrowserRouter` ではない）。Electron はレンダラを `file://` から読み込むため、History API ベースのルーティングはリロード時に 404 になる。後から変えると全ページのリンクとテストを再確認することになるので、最初から `HashRouter` にしておく。

### 移行時（Phase 5）に扱うもの — Phase 4 では先回りしない

- **`apiRequest` の `BASE_URL`**: 現在 `http://127.0.0.1:4317` 固定。Electron ではポート衝突に備えて動的ポートを選び、メインプロセスからレンダラへ実際のポートを渡す必要がある。Phase 4 の時点で設定機構を作るのは、使いもしない抽象を先に作ることになるので避ける。移行時に `client.ts` の 1 箇所を差し替える。
- **サーバーのポート固定**: `apps/server/src/index.ts` が `port: 4317` 固定。Electron 側では `port: 0` で OS に空きポートを選ばせ、`listen` の戻り値から実ポートを取得してレンダラへ渡す形にする。
- **サーバープロセスの同梱と起動**: Electron のメインプロセスから Fastify を子プロセスとして起動し、アプリ終了時に確実に落とす。`better-sqlite3` はネイティブモジュールなので `electron-rebuild` が要る。
- **CORS**: 同一オリジン（`file://` + 動的ポート）になるため、Task 1 で入れた CORS 設定は不要になる可能性が高い。移行時に実際の挙動を見て判断する。
- **キーチェーンアクセス**: `security` CLI を `execFileSync` で叩いている。Electron の署名済みアプリからも同じく動くはずだが、実機確認が要る。

### 移行を楽にしている既存の設計

サーバー（Fastify + SQLite）とフロントを別プロセスに分離してあるため、Electron 化は「起動方法を変える」だけの話に収まる。メインプロセスがサーバーを起動し、レンダラがそこへ HTTP で話す構造は今のままで成立する。
