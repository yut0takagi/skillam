# skillam Phase 3b（ドリフト検知・エクスポート/インポート）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 適用したあとにプロジェクトの設定が書き換えられていないかを検出し、CI から `skillam check` として実行できるようにする。あわせてロール定義を JSON で持ち出し・取り込みできるようにする。

**Architecture:** ドリフト判定は純関数に切り出し、HTTP ルート・CLI・UI バッジの3つがそれを共有する。判定に使うのは `apply_history.managed_json`（skillam が書いた対象の記録）と、プロジェクトの現ファイル。ロジックを1箇所に持つことで、CLI と画面で結果が食い違わない。

**Tech Stack:** 既存構成のまま（TypeScript / Fastify / better-sqlite3 / Vitest / React）。新規依存なし。

---

## 判定の定義 — ここを曖昧にしない

**ドリフトとは「skillam が書いたはずのものが、今そこに無い、または違う」状態。**

`apply_history` の最後の成功記録にある `managed_json` を正とし、プロジェクトの現ファイルと照合する。

| 記録にある | 現ファイル | 判定 |
|---|---|---|
| `Read(*)` | ある | 一致 |
| `Read(*)` | 無い | **ドリフト**（消された） |
| `.claude/skills/drawio` | リンク先が違う | **ドリフト** |
| `.claude/skills/drawio` | 実ディレクトリになっている | **ドリフト** |
| （記録に無い）`my-local` | ある | **無視**（ユーザーの手動追加） |

**手動追加をドリフトとして報告しない。** これは本ツールの「自分が書いたものしか触らない」という約束の裏返しで、ここを間違えると、ユーザーが自分で足した設定を毎回警告されることになる。

**ロール側の変更はドリフトではない。** ロールを編集したが未適用、という状態は「ドリフト」ではなく「未適用」。この計画では扱わない（混同すると、ロールを編集しただけで CI が落ちる）。

**一度も適用していないプロジェクトはドリフトなし。** 記録が無いので比較対象が無い。「不明」ではなく「ドリフトなし」として扱う。

---

## CLI の終了コード — CI での使われ方を決める

```bash
npx skillam check              # 全プロジェクト
npx skillam check <path>       # 1つのプロジェクト
npx skillam check --json       # 機械可読な出力
```

| コード | 意味 |
|---|---|
| `0` | ドリフトなし |
| `1` | ドリフトあり |
| `2` | 実行できなかった（DB が無い、パスが存在しない、`settings.json`/`.mcp.json` が JSON として読めない等） |

**1 と 2 を分けるのが要点。** CI で「ドリフトを検出した」と「skillam 自体が動かなかった」を区別できないと、設定ミスを緑のまま見逃す。

---

## エクスポート/インポートの約束

**シークレットの値は絶対に出さない。** `role_mcp_servers.env_json` に入っているのは `secret_ref:mcp:<server>:<key>` という参照キーだけなので、そのまま出力すれば値は漏れない。`secrets` テーブルには一切触れない。

**インポート時に未解決の参照はそのまま取り込む。** 参照先のシークレットが無くても失敗させず、ロールとしては作る。適用しようとした時点で「シークレット参照が解決できません」と失敗するので、その時に登録すればよい（設計書 §10）。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `apps/server/src/apply/project-state.ts` | 新規。プロジェクトの現ファイルを読む処理（プランナーから切り出して共有） |
| `apps/server/src/apply/detect-drift.ts` | 新規。純関数。managed 記録と現状を突き合わせてドリフト項目を返す |
| `apps/server/src/apply/apply-planner.ts` | 読み取り処理を `project-state.ts` から使うよう変更 |
| `apps/server/src/apply/drift.routes.ts` | 新規。`GET /projects/:id/drift`、`GET /drift` |
| `apps/server/src/roles/role-export.ts` | 新規。純関数。RoleDetail ↔ エクスポート JSON の変換 |
| `apps/server/src/roles/roles.routes.ts` | エクスポート/インポートのルート追加 |
| `apps/server/src/cli.ts` | 新規。`skillam check` のエントリポイント |
| `apps/web/src/pages/Dashboard.tsx` | ドリフトバッジ |
| `apps/web/src/pages/Roles.tsx` | エクスポート/インポートのボタン |

---

### Task 1: プロジェクトの現状読み取りを共有部品にする

ドリフト検知はプランナーと同じ読み取りを必要とする。二重に持つと必ずズレるので先に切り出す。

**Files:**
- Create: `apps/server/src/apply/project-state.ts`
- Create: `apps/server/src/apply/project-state.test.ts`
- Modify: `apps/server/src/apply/apply-planner.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/apply/project-state.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileOrNull, readJsonObject, readCurrentEntry, UnreadableConfigError } from './project-state.js'

describe('project-state', () => {
  let root: string

  beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-state-test-')))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('returns null for a file that does not exist', () => {
    expect(readFileOrNull(path.join(root, 'nope.json'))).toBeNull()
  })

  it('reads an existing file', () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'hi')
    expect(readFileOrNull(path.join(root, 'a.txt'))).toBe('hi')
  })

  it('treats a missing file as an empty object', () => {
    expect(readJsonObject(null, '/x.json')).toEqual({})
  })

  it('refuses to interpret a file that is not valid json', () => {
    expect(() => readJsonObject('{ broken', '/x.json')).toThrow(UnreadableConfigError)
  })

  it('refuses to interpret json that is not an object', () => {
    expect(() => readJsonObject('[1,2]', '/x.json')).toThrow(UnreadableConfigError)
  })

  it('reports a symlink with its target', () => {
    const target = path.join(root, 'target')
    fs.mkdirSync(target)
    fs.symlinkSync(target, path.join(root, 'link'))

    expect(readCurrentEntry(root, 'link')).toEqual({ kind: 'link', target })
  })

  it('reports a regular file with its content', () => {
    fs.writeFileSync(path.join(root, 'f.md'), '# hi')

    expect(readCurrentEntry(root, 'f.md')).toEqual({ kind: 'file', content: '# hi' })
  })

  it('reports a real directory as other, not as an empty file', () => {
    fs.mkdirSync(path.join(root, 'dir'))

    expect(readCurrentEntry(root, 'dir')).toEqual({ kind: 'other' })
  })

  it('returns undefined for a path that does not exist', () => {
    expect(readCurrentEntry(root, 'gone')).toBeUndefined()
  })
})
```

最後から3番目のテストが重要。ディレクトリを「空のファイル」と偽ると、Phase 3a で見つけた「ユーザーの実ディレクトリを削除する」バグが再発する。

- [ ] **Step 2: 失敗を確認 → 実装**

`apply-planner.ts` から `readFileOrNull` / `parseJsonObject` / `readCurrentEntry` を `project-state.ts` へ移し、export する。`UnsupportedSettingsError` は `plan-settings.ts` にあるが、読み取り専用の文脈でも使うので、`project-state.ts` に `UnreadableConfigError` として置き直すか、既存を re-export するかを決める。**既存の呼び出し側が壊れないことを確認すること。**

`apply-planner.ts` は移した関数を import して使う。**プランナーの振る舞いは1ミリも変えない** — 既存の 358 テストが全て通ることが、正しく切り出せた証拠になる。

- [ ] **Step 3: 確認してコミット**

```bash
npm run test -w @skillam/server
npx tsc --noEmit -p apps/server/tsconfig.json
git add apps/server/src/apply/project-state.ts apps/server/src/apply/project-state.test.ts apps/server/src/apply/apply-planner.ts
git commit -m "refactor(server): share the project state reader with drift detection"
```

---

### Task 2: ドリフト判定の純関数

**Files:**
- Create: `apps/server/src/apply/detect-drift.ts`
- Create: `apps/server/src/apply/detect-drift.test.ts`

- [ ] **Step 1: 型を決める**

```ts
export type DriftKind =
  | 'permission-missing'      // allow/deny のエントリが消えた
  | 'mcp-server-missing'      // サーバー定義が消えた
  | 'materialized-missing'    // symlink/ファイルが消えた
  | 'materialized-changed'    // リンク先が変わった、実体に置き換わった

export interface DriftItem {
  kind: DriftKind
  target: string              // 'Read(*)' / 'github' / '.claude/skills/drawio'
  detail: string              // 人が読む説明
}

export interface DriftReport {
  projectId: number
  projectPath: string
  hasDrift: boolean
  items: DriftItem[]
  checkedAt: string
  lastAppliedAt: string | null
}
```

- [ ] **Step 2: 失敗するテストを書く**

純関数なのでファイルシステムを使わない。現状はすべて引数で渡す。

```ts
import { describe, expect, it } from 'vitest'
import { detectDrift } from './detect-drift.js'
import { EMPTY_MANAGED_STATE } from './managed-state.js'

const base = {
  managed: EMPTY_MANAGED_STATE,
  settings: {} as Record<string, unknown>,
  mcpJson: {} as Record<string, unknown>,
  current: {} as Record<string, { kind: 'link'; target: string } | { kind: 'file'; content: string } | { kind: 'other' }>
}

describe('detectDrift', () => {
  it('reports nothing when there is no managed state', () => {
    expect(detectDrift(base).hasDrift).toBe(false)
  })

  it('reports a permission entry that was removed', () => {
    const r = detectDrift({
      ...base,
      managed: { ...EMPTY_MANAGED_STATE, permissionAllow: ['Read(*)'] },
      settings: { permissions: { allow: [] } }
    })

    expect(r.hasDrift).toBe(true)
    expect(r.items).toEqual([
      expect.objectContaining({ kind: 'permission-missing', target: 'Read(*)' })
    ])
  })

  it('ignores a permission entry the user added by hand', () => {
    const r = detectDrift({
      ...base,
      managed: { ...EMPTY_MANAGED_STATE, permissionAllow: ['Read(*)'] },
      settings: { permissions: { allow: ['Read(*)', 'Bash(git:*)'] } }
    })

    expect(r.hasDrift).toBe(false)
  })

  it('reports an mcp server that was removed', () => {
    const r = detectDrift({
      ...base,
      managed: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] },
      mcpJson: { mcpServers: {} }
    })

    expect(r.items).toEqual([expect.objectContaining({ kind: 'mcp-server-missing', target: 'github' })])
  })

  it('ignores an mcp server the user added by hand', () => {
    const r = detectDrift({
      ...base,
      managed: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] },
      mcpJson: { mcpServers: { github: { command: 'npx' }, mine: { command: 'node' } } }
    })

    expect(r.hasDrift).toBe(false)
  })

  it('reports a symlink that was removed', () => {
    const r = detectDrift({
      ...base,
      managed: { ...EMPTY_MANAGED_STATE, materialized: ['.claude/skills/drawio'] },
      current: {}
    })

    expect(r.items).toEqual([
      expect.objectContaining({ kind: 'materialized-missing', target: '.claude/skills/drawio' })
    ])
  })

  it('reports a symlink that was replaced by a real directory', () => {
    const r = detectDrift({
      ...base,
      managed: { ...EMPTY_MANAGED_STATE, materialized: ['.claude/skills/drawio'] },
      current: { '.claude/skills/drawio': { kind: 'other' } }
    })

    expect(r.items).toEqual([
      expect.objectContaining({ kind: 'materialized-changed', target: '.claude/skills/drawio' })
    ])
  })

  it('accepts a symlink that is still a symlink', () => {
    const r = detectDrift({
      ...base,
      managed: { ...EMPTY_MANAGED_STATE, materialized: ['.claude/skills/drawio'] },
      current: { '.claude/skills/drawio': { kind: 'link', target: '/home/u/.claude/skills/drawio' } }
    })

    expect(r.hasDrift).toBe(false)
  })

  it('collects every drift, not just the first', () => {
    const r = detectDrift({
      ...base,
      managed: {
        mcpServers: ['github'],
        materialized: ['.claude/skills/drawio'],
        permissionAllow: ['Read(*)'],
        permissionDeny: []
      },
      settings: { permissions: { allow: [] } },
      mcpJson: { mcpServers: {} },
      current: {}
    })

    expect(r.items).toHaveLength(3)
  })
})
```

**`mcp-server-changed` は作らない — 判定できないことを確認済み。** `managed.mcpServers` は `string[]`（サーバー名のみ）で、`command` や `env` の中身は記録されていない。よって「github の定義が書き換えられた」は現在の記録からは検出できず、検出できるのは「github が消えた」だけ。

これを検出したいなら `managed_json` にサーバー定義のハッシュを追加する必要があるが、それは記録形式の変更（マイグレーション）を伴う。**この計画では扱わない。** 消えたことだけを報告し、中身の書き換えは検出対象外と README に明記する。

同じ理由で、permissions も「エントリが消えた」だけを見る。エントリは文字列そのものが `managed` に入っているので、消失は正確に判定できる。

- [ ] **Step 3: 実装 → コミット**

```bash
git commit -m "feat(server): detect drift from the recorded managed state"
```

---

### Task 3: ドリフトの HTTP ルート

**Files:**
- Create: `apps/server/src/apply/drift.routes.ts` と `.test.ts`
- Modify: `apps/server/src/app.ts`

- [ ] エンドポイント: `GET /projects/:id/drift` → `DriftReport`、`GET /drift` → `DriftReport[]`（登録済み全プロジェクト、excluded は除く）
- [ ] 一度も適用していないプロジェクトは `hasDrift: false`、`items: []`、`lastAppliedAt: null`
- [ ] 設定ファイルが壊れている場合は 409（`UnreadableConfigError`）。**500 にしないこと** — 適用ルートと同じ扱いに揃える
- [ ] 存在しないプロジェクトは 404
- [ ] テスト: ドリフトあり／なし／未適用／壊れたファイル／不明なID／全件取得

コミット: `feat(server): add drift endpoints`

---

### Task 4: `skillam check` CLI

**Files:**
- Create: `apps/server/src/cli.ts` と `cli.test.ts`
- Modify: `apps/server/package.json`（`bin` と `build`）

- [ ] **Step 1: 終了コードを決めたとおりに実装する**

`0` ドリフトなし / `1` ドリフトあり / `2` 実行できなかった。

CLI は HTTP サーバーを立てない。DB を直接開き、Task 2 の純関数を使う。サーバーが起動していなくても動くこと（CI で使うため）。

- [ ] **Step 2: テスト**

`process.exit` を直接呼ぶとテストしづらい。`runCheck(argv): Promise<{ code: number; output: string }>` のような形にして、`cli.ts` の末尾だけが `process.exit(result.code)` を呼ぶ構造にする。テストは `runCheck` を呼ぶ。

```ts
  it('exits 0 when nothing has drifted', async () => { ... })
  it('exits 1 when a managed entry is gone', async () => { ... })
  it('exits 2 when the database does not exist', async () => { ... })
  it('exits 2 when the given path is not a registered project', async () => { ... })
  it('prints machine readable output with --json', async () => { ... })
  it('checks every project when no path is given', async () => { ... })
  it('names each drifted item in the human readable output', async () => { ... })
```

- [ ] **Step 3: `bin` を追加**

```json
  "bin": { "skillam": "dist/cli.js" }
```

`dist/cli.js` の先頭に `#!/usr/bin/env node` が必要。`tsc` は shebang を消さないので、ソースの先頭に書けばよい。**ビルドして実際に `node dist/cli.js` が動くか確認すること。**

- [ ] **Step 4: 実際に走らせる**

使い捨ての DB とプロジェクトを作り、適用してからファイルを手で壊し、`check` が 1 を返すことを確認する。実 `~/.skillam` は使わないこと。

コミット: `feat(server): add a skillam check command`

---

### Task 5: ロール定義のエクスポート/インポート

**Files:**
- Create: `apps/server/src/roles/role-export.ts` と `.test.ts`
- Modify: `apps/server/src/roles/roles.routes.ts` と `.test.ts`

- [ ] **形式を決める**

```json
{
  "skillamRoleVersion": 1,
  "name": "frontend-dev",
  "description": "React/Vite 系プロジェクト用",
  "skills": [{ "skillSource": "user", "skillPath": "/Users/x/.claude/skills/drawio" }],
  "mcpServers": [{ "name": "github", "command": {...}, "env": { "TOKEN": "secret_ref:mcp:github:TOKEN" } }],
  "agents": [{ "name": "reviewer", "source": "reference", "sourcePath": "...", "markdownBody": "" }],
  "permissions": { "allow": ["Read(*)"], "deny": [] }
}
```

`skillamRoleVersion` を入れるのは、後で形式を変えたときに古いファイルを判別するため。

**`skillPath` と `sourcePath` は絶対パスで、別マシンでは通用しない。** これは避けられない（Skill の実体は各マシンにある）。インポート時にパスの存在確認はしない — 存在しないパスのまま取り込み、適用時に「リンク先が存在しません」で弾かれる。この挙動をエクスポート JSON のコメントではなく、**README とインポート後の UI メッセージで伝える**こと。

- [ ] **Step 2: テスト（純関数）**

```ts
  it('includes every part of the role', () => { ... })
  it('keeps secret references as references, never values', () => { ... })
  it('round-trips through export and import', () => { ... })
  it('rejects a payload with an unknown version', () => { ... })
  it('rejects a payload that is not an object', () => { ... })
  it('imports a role whose secret reference does not resolve', () => { ... })
```

3番目と最後が要。**エクスポートした JSON に平文シークレットが含まれないことを、テストで固定すること。**

- [ ] **Step 3: ルート**

`GET /roles/:id/export` → JSON、`POST /roles/import` → 作成したロール。名前が衝突したら 409（既存を上書きしない）。

コミット: `feat(server): export and import role definitions`

---

### Task 6: UI — ドリフトバッジと入出力ボタン

**Files:** `apps/web/src/api/*.ts`、`apps/web/src/pages/Dashboard.tsx`、`Roles.tsx`、各テスト

- [ ] Dashboard のプロジェクト一覧に、ドリフトがあれば `.pill-warn` のバッジを出す。件数も出す（「3件のズレ」）
- [ ] バッジをクリックすると Project 詳細へ飛び、そこで内訳を見せる
- [ ] ドリフトの取得は一覧の描画をブロックしない（`GET /drift` は全プロジェクトのファイルを読むので遅い可能性がある）。**実際に何ミリ秒かかるか測ってから、非同期にするか決めること**
- [ ] Roles にエクスポートボタン（JSON をダウンロード）とインポートボタン（ファイル選択）
- [ ] インポート後、パスが解決できない可能性があることをメッセージで伝える

コミット: `feat(web): show drift badges and role import export`

---

### Task 7: 実環境E2Eと README 更新

- [ ] 使い捨てプロジェクトで、適用 → ファイルを手で壊す → `skillam check` が 1 を返す → UI にバッジが出る、を通しで確認する
- [ ] 手動追加した設定がドリフトとして報告されないことを確認する（本機能の中核）
- [ ] エクスポートした JSON に平文シークレットが無いことを目で確認する
- [ ] README に `skillam check` の使い方と終了コード、エクスポート/インポートの制約（絶対パス）を書く
- [ ] 実 `~/.skillam` と `~/.claude` に触れていないことを確認する

---

## Phase 3b Definition of Done

- `npx skillam check` が動き、ドリフトなし 0 / あり 1 / 実行不能 2 を返す
- 手動追加した設定はドリフトとして報告されない
- Dashboard にドリフトバッジが出て、内訳が見られる
- ロール定義を JSON で出し入れでき、**平文シークレットは決して含まれない**
- server / web のテストが全件パスする
- README に CLI と入出力の使い方・制約が書かれている

## 次（この計画には含まない）

- 配布（`.app` / `.dmg`、署名・公証）
- 複数ロールの合成適用
- 定期的な自動ドリフトチェック（cron 等）— 設計書 §3 で対象外
