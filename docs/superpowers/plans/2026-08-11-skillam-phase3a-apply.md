# skillam Phase 3a（apply/diff エンジン）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登録済みプロジェクトにロールを割り当て、diffプレビューで確認してから `.claude/settings.json` / `.mcp.json` / `.claude/skills/` / `.claude/agents/` へマージ適用し、適用内容を履歴に記録できるようにする。

**Architecture:** 「計画生成（純関数）」と「実書き込み（副作用）」を分離する。`plan-settings` / `plan-mcp` / `plan-materialize` は現在の状態とロール定義を受け取って次の状態を返すだけの純関数で、ファイルシステムに触れない。`apply-planner` がファイル読み取りと純関数の合成を担い、`ApplyPlan` を返す。`apply-executor` だけが書き込みとシークレット復号を行う。この分離により、diffロジックの大半がファイルシステムなしでテストできる。

**Tech Stack:** TypeScript / Fastify / better-sqlite3 / Vitest（既存構成のまま。新規依存パッケージなし）

---

## 設計上の決定（設計書 §7 で確定済み）

- **実体化はシンボリックリンク**。Skills と `source='reference'` の Agents はリンク、`source='authored'` の Agents のみ実ファイル書き出し
- **削除は「前回適用分だけ」**。`apply_history.managed_json` に「skillamが書いた対象」を記録し、次回適用時に「前回記録にあるが今回のロールにない」ものだけ削除する。記録にない＝手動追加分は温存
- **管理対象キー**は `.claude/settings.json` の `permissions.allow` / `permissions.deny` と、`.mcp.json` の `mcpServers` のみ

### enabledPlugins を Phase 3a では扱わない理由

設計書 §7 は管理対象キーに `enabledPlugins` を挙げているが、現在のデータモデルにはロールが「どのプラグインを有効化するか」を表す列がない（`role_skills` はプラグイン提供Skillへのパスを持つだけで、`<plugin>@<marketplace>` を復元するにはプラグインキャッシュのディレクトリ構造をパースする必要があり、バージョンセグメントの有無で壊れやすい）。またSkillをプロジェクトへsymlinkする方式ではプラグインが有効化されている必要がない。よって Phase 3a では `enabledPlugins` を読み書きせず、素通しする。ロールに「プラグイン」概念を追加する場合は別フェーズで扱う。この訂正は設計書 §7 にも反映済み。

### スキーマの追加理由: `role_agents.source_path`

`source='reference'` の Agent はシンボリックリンクで実体化するが、既存の `role_agents` テーブルにはリンク先パスを持つ列がない（`name` / `markdown_body` / `source` のみ）。Task 1 のマイグレーションで `source_path` 列を追加する。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `apps/server/src/db/migrations/0004_apply.sql` | `project_roles` / `apply_history` テーブル、`projects.last_applied_*`、`role_agents.source_path` |
| `apps/server/src/projects/project-roles.repository.ts` | プロジェクトへのロール割当の読み書き |
| `apps/server/src/projects/project-roles.routes.ts` | `GET/PUT /projects/:id/roles` |
| `apps/server/src/apply/managed-state.ts` | 「skillamが管理している集合」の型・直列化・差分ヘルパー |
| `apps/server/src/apply/plan-settings.ts` | `.claude/settings.json` の `permissions` マージ（純関数） |
| `apps/server/src/apply/plan-mcp.ts` | `.mcp.json` の `mcpServers` マージ（純関数） |
| `apps/server/src/apply/plan-materialize.ts` | symlink / 実ファイルの差分計算（純関数） |
| `apps/server/src/apply/apply-history.repository.ts` | `apply_history` の記録と取得 |
| `apps/server/src/apply/apply-planner.ts` | ファイル読み取り + 純関数合成 → `ApplyPlan` |
| `apps/server/src/apply/apply-executor.ts` | `ApplyPlan` の実書き込みとシークレット復号 |
| `apps/server/src/apply/apply.routes.ts` | `POST /projects/:id/apply/preview` / `POST /projects/:id/apply` / `GET /projects/:id/apply-history` |

---

### Task 1: マイグレーション 0004（適用まわりのスキーマ）

**Files:**
- Create: `apps/server/src/db/migrations/0004_apply.sql`
- Modify: `apps/server/src/db/migrate.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/db/migrate.test.ts` の先頭ヘルパーの下に `columnNames` を追加する:

```ts
function columnNames(db: ReturnType<typeof openDb>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name)
}
```

既存の `it('is idempotent when run twice')` 内の期待値を `3` から `4` に変更する（マイグレーションファイルが1つ増えるため）:

```ts
    expect(count).toBe(4)
```

そのうえで、`describe('runMigrations', ...)` の中に次のテストを追加する:

```ts
  it('creates the apply tables and columns', () => {
    const db = openDb(':memory:')

    runMigrations(db)

    expect(tableNames(db)).toEqual(expect.arrayContaining(['project_roles', 'apply_history']))
    expect(columnNames(db, 'projects')).toEqual(
      expect.arrayContaining(['last_applied_role_id', 'last_applied_at'])
    )
    expect(columnNames(db, 'role_agents')).toContain('source_path')

    db.close()
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/db/migrate.test.ts`
Expected: FAIL — `project_roles` / `apply_history` が存在せず arrayContaining が不一致、および `_migrations` の件数が 3 のまま

- [ ] **Step 3: マイグレーションを追加**

`apps/server/src/db/migrations/0004_apply.sql` を新規作成:

```sql
CREATE TABLE project_roles (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, role_id)
);

CREATE TABLE apply_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  diff_json TEXT NOT NULL DEFAULT '{}',
  managed_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT NOT NULL DEFAULT '',
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE projects ADD COLUMN last_applied_role_id INTEGER REFERENCES roles(id);
ALTER TABLE projects ADD COLUMN last_applied_at TEXT;

ALTER TABLE role_agents ADD COLUMN source_path TEXT NOT NULL DEFAULT '';
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @skillam/server -- src/db/migrate.test.ts`
Expected: PASS（3テストすべて）

- [ ] **Step 5: フルスイートを流す**

Run: `npm run test -w @skillam/server`
Expected: PASS（リグレッションなし）

- [ ] **Step 6: コミット**

```bash
git add apps/server/src/db/migrations/0004_apply.sql apps/server/src/db/migrate.test.ts
git commit -m "feat(server): add apply schema (project_roles, apply_history, agent source_path)"
```

---

### Task 2: `role_agents.sourcePath` を型・リポジトリ・ルートに通す

reference な Agent のリンク先パスを保存・取得できるようにする。

**Files:**
- Modify: `apps/server/src/roles/role-agents.types.ts`
- Modify: `apps/server/src/roles/role-agents.repository.ts`
- Modify: `apps/server/src/roles/roles.routes.ts`
- Modify: `apps/server/src/roles/role-agents.repository.test.ts`
- Modify: `apps/server/src/roles/roles.routes.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/roles/role-agents.repository.test.ts` の `describe` 内に追加:

```ts
  it('round-trips sourcePath for a reference agent', () => {
    const role = new RolesRepository(db).create({ name: 'linked' })
    const repo = new RoleAgentsRepository(db)

    const saved = repo.replaceForRole(role.id, [
      {
        name: 'reviewer',
        markdownBody: '',
        source: 'reference',
        sourcePath: '/Users/someone/.claude/agents/reviewer.md'
      }
    ])

    expect(saved).toEqual([
      expect.objectContaining({
        name: 'reviewer',
        source: 'reference',
        sourcePath: '/Users/someone/.claude/agents/reviewer.md'
      })
    ])
  })

  it('defaults sourcePath to an empty string when omitted', () => {
    const role = new RolesRepository(db).create({ name: 'authored-only' })
    const repo = new RoleAgentsRepository(db)

    const saved = repo.replaceForRole(role.id, [
      { name: 'writer', markdownBody: '# Writer', source: 'authored' }
    ])

    expect(saved[0].sourcePath).toBe('')
  })
```

（このファイルが `RolesRepository` をまだ import していない場合は `import { RolesRepository } from './roles.repository.js'` を追加する。）

`apps/server/src/roles/roles.routes.test.ts` に追加:

```ts
  it('rejects a reference agent without a sourcePath', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'needs-path' } })
    const roleId = created.json().id

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/agents`,
      payload: { agents: [{ name: 'reviewer', markdownBody: '', source: 'reference' }] }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('sourcePath')
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/roles`
Expected: FAIL — `sourcePath` が返らず undefined、ルートは 400 ではなく 200 を返す

- [ ] **Step 3: 型を更新**

`apps/server/src/roles/role-agents.types.ts` を次の内容に置き換える:

```ts
export interface RoleAgent {
  id: number
  name: string
  markdownBody: string
  source: 'reference' | 'authored'
  sourcePath: string
}

export interface RoleAgentInput {
  name: string
  markdownBody: string
  source: 'reference' | 'authored'
  sourcePath?: string
}
```

- [ ] **Step 4: リポジトリを更新**

`apps/server/src/roles/role-agents.repository.ts` を次の内容に置き換える:

```ts
import type Database from 'better-sqlite3'
import type { RoleAgent, RoleAgentInput } from './role-agents.types.js'

interface RoleAgentRow {
  id: number
  name: string
  markdown_body: string
  source: string
  source_path: string
}

function toRoleAgent(row: RoleAgentRow): RoleAgent {
  return {
    id: row.id,
    name: row.name,
    markdownBody: row.markdown_body,
    source: row.source as RoleAgent['source'],
    sourcePath: row.source_path
  }
}

export class RoleAgentsRepository {
  constructor(private readonly db: Database.Database) {}

  listForRole(roleId: number): RoleAgent[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, markdown_body, source, source_path FROM role_agents WHERE role_id = ? ORDER BY id'
      )
      .all(roleId) as RoleAgentRow[]
    return rows.map(toRoleAgent)
  }

  replaceForRole(roleId: number, items: RoleAgentInput[]): RoleAgent[] {
    const replace = this.db.transaction((entries: RoleAgentInput[]) => {
      this.db.prepare('DELETE FROM role_agents WHERE role_id = ?').run(roleId)
      const insert = this.db.prepare(
        'INSERT INTO role_agents (role_id, name, markdown_body, source, source_path) VALUES (?, ?, ?, ?, ?)'
      )
      for (const entry of entries) {
        insert.run(roleId, entry.name, entry.markdownBody, entry.source, entry.sourcePath ?? '')
      }
    })
    replace(items)
    return this.listForRole(roleId)
  }
}
```

- [ ] **Step 5: ルートのバリデーションを更新**

`apps/server/src/roles/roles.routes.ts` の `PUT /roles/:id/agents` ハンドラ内、`hasInvalidAgent` の判定の直後（`const id = Number(request.params.id)` の直前）に次を挿入する:

```ts
      const hasInvalidSourcePath = request.body.agents.some(
        (agent) =>
          (agent.sourcePath !== undefined && typeof agent.sourcePath !== 'string') ||
          (agent.source === 'reference' && (agent.sourcePath ?? '').trim() === '')
      )
      if (hasInvalidSourcePath) {
        return reply
          .status(400)
          .send({ error: 'an agent with source "reference" requires a non-empty sourcePath' })
      }
```

- [ ] **Step 6: テストが通ることを確認**

Run: `npm run test -w @skillam/server -- src/roles`
Expected: PASS

- [ ] **Step 7: フルスイートを流してコミット**

```bash
npm run test -w @skillam/server
git add apps/server/src/roles
git commit -m "feat(server): store a source path for reference agents"
```

---

### Task 3: プロジェクトへのロール割当（リポジトリ）

**Files:**
- Create: `apps/server/src/projects/project-roles.types.ts`
- Create: `apps/server/src/projects/project-roles.repository.ts`
- Create: `apps/server/src/projects/project-roles.repository.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/projects/project-roles.repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from '../roles/roles.repository.js'
import { ProjectsRepository } from './projects.repository.js'
import { ProjectRolesRepository } from './project-roles.repository.js'

describe('ProjectRolesRepository', () => {
  let db: Database.Database
  let projectId: number
  let roleIds: number[]

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    projectId = new ProjectsRepository(db).create({ path: '/tmp/p', name: 'p' }).id
    const roles = new RolesRepository(db)
    roleIds = [roles.create({ name: 'a' }).id, roles.create({ name: 'b' }).id]
  })

  it('returns an empty list for a project with no roles', () => {
    expect(new ProjectRolesRepository(db).listForProject(projectId)).toEqual([])
  })

  it('stores assignments with priority following the given order', () => {
    const repo = new ProjectRolesRepository(db)

    const saved = repo.replaceForProject(projectId, [roleIds[1], roleIds[0]])

    expect(saved).toEqual([
      { roleId: roleIds[1], priority: 0 },
      { roleId: roleIds[0], priority: 1 }
    ])
  })

  it('replaces previous assignments instead of appending', () => {
    const repo = new ProjectRolesRepository(db)
    repo.replaceForProject(projectId, [roleIds[0], roleIds[1]])

    const saved = repo.replaceForProject(projectId, [roleIds[1]])

    expect(saved).toEqual([{ roleId: roleIds[1], priority: 0 }])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/projects/project-roles.repository.test.ts`
Expected: FAIL — `Cannot find module './project-roles.repository.js'`

- [ ] **Step 3: 型を作成**

`apps/server/src/projects/project-roles.types.ts`:

```ts
export interface ProjectRole {
  roleId: number
  priority: number
}
```

- [ ] **Step 4: リポジトリを実装**

`apps/server/src/projects/project-roles.repository.ts`:

```ts
import type Database from 'better-sqlite3'
import type { ProjectRole } from './project-roles.types.js'

interface ProjectRoleRow {
  role_id: number
  priority: number
}

export class ProjectRolesRepository {
  constructor(private readonly db: Database.Database) {}

  listForProject(projectId: number): ProjectRole[] {
    const rows = this.db
      .prepare('SELECT role_id, priority FROM project_roles WHERE project_id = ? ORDER BY priority')
      .all(projectId) as ProjectRoleRow[]
    return rows.map((row) => ({ roleId: row.role_id, priority: row.priority }))
  }

  replaceForProject(projectId: number, roleIds: number[]): ProjectRole[] {
    const replace = this.db.transaction((ids: number[]) => {
      this.db.prepare('DELETE FROM project_roles WHERE project_id = ?').run(projectId)
      const insert = this.db.prepare(
        'INSERT INTO project_roles (project_id, role_id, priority) VALUES (?, ?, ?)'
      )
      ids.forEach((roleId, index) => {
        insert.run(projectId, roleId, index)
      })
    })
    replace(roleIds)
    return this.listForProject(projectId)
  }
}
```

- [ ] **Step 5: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/server -- src/projects/project-roles.repository.test.ts`
Expected: PASS

```bash
git add apps/server/src/projects/project-roles.repository.ts apps/server/src/projects/project-roles.types.ts apps/server/src/projects/project-roles.repository.test.ts
git commit -m "feat(server): add project roles repository"
```

---

### Task 4: ロール割当のHTTPルート

**Files:**
- Create: `apps/server/src/projects/project-roles.routes.ts`
- Create: `apps/server/src/projects/project-roles.routes.test.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/projects/project-roles.routes.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'
import { InMemoryKeychainClient } from '../secrets/in-memory-keychain-client.js'

describe('project roles routes', () => {
  let db: Database.Database
  let app: FastifyInstance
  let projectId: number
  let roleId: number

  beforeEach(async () => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db, new InMemoryKeychainClient())

    const project = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: { path: '/tmp/project-roles-test', name: 'p' }
    })
    projectId = project.json().id

    const role = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dev' } })
    roleId = role.json().id
  })

  it('returns an empty list before any role is assigned', async () => {
    const response = await app.inject({ method: 'GET', url: `/projects/${projectId}/roles` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })

  it('assigns roles to a project', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [roleId] }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([{ roleId, priority: 0 }])
  })

  it('returns 404 for an unknown project', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/projects/9999/roles',
      payload: { roleIds: [roleId] }
    })

    expect(response.statusCode).toBe(404)
  })

  it('returns 400 when a role id does not exist', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [9999] }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('9999')
  })

  it('returns 400 when roleIds is not an array', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: 'dev' }
    })

    expect(response.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/projects/project-roles.routes.test.ts`
Expected: FAIL — すべて 404（ルート未登録）

- [ ] **Step 3: ルートを実装**

`apps/server/src/projects/project-roles.routes.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import type { ProjectsRepository } from './projects.repository.js'
import type { ProjectRolesRepository } from './project-roles.repository.js'
import type { RolesRepository } from '../roles/roles.repository.js'

export interface ProjectRolesRouteDeps {
  projects: ProjectsRepository
  projectRoles: ProjectRolesRepository
  roles: RolesRepository
}

export const projectRolesRoutes: FastifyPluginAsync<ProjectRolesRouteDeps> = async (app, deps) => {
  app.get<{ Params: { id: string } }>('/projects/:id/roles', async (request, reply) => {
    const projectId = Number(request.params.id)
    if (!deps.projects.getById(projectId)) {
      return reply.status(404).send({ error: 'project not found' })
    }
    return deps.projectRoles.listForProject(projectId)
  })

  app.put<{ Params: { id: string }; Body: { roleIds: number[] } }>(
    '/projects/:id/roles',
    async (request, reply) => {
      const body = request.body
      if (typeof body !== 'object' || body === null || !Array.isArray(body.roleIds)) {
        return reply.status(400).send({ error: 'roleIds must be an array' })
      }
      const projectId = Number(request.params.id)
      if (!deps.projects.getById(projectId)) {
        return reply.status(404).send({ error: 'project not found' })
      }
      for (const roleId of body.roleIds) {
        if (typeof roleId !== 'number' || !deps.roles.getById(roleId)) {
          return reply.status(400).send({ error: `role ${roleId} not found` })
        }
      }
      return deps.projectRoles.replaceForProject(projectId, body.roleIds)
    }
  )
}
```

- [ ] **Step 4: `app.ts` に登録**

`apps/server/src/app.ts` の import 群に追加:

```ts
import { ProjectRolesRepository } from './projects/project-roles.repository.js'
import { projectRolesRoutes } from './projects/project-roles.routes.js'
```

`app.register(projectsRoutes, {...})` の直後に追加:

```ts
  app.register(projectRolesRoutes, {
    projects: new ProjectsRepository(db),
    projectRoles: new ProjectRolesRepository(db),
    roles: new RolesRepository(db)
  })
```

- [ ] **Step 5: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/server`
Expected: PASS

```bash
git add apps/server/src/projects/project-roles.routes.ts apps/server/src/projects/project-roles.routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add project roles http routes"
```

---

### Task 5: 管理状態（ManagedState）

「前回skillamが書いた対象」を表す値オブジェクトと、その直列化・復元。

**Files:**
- Create: `apps/server/src/apply/managed-state.ts`
- Create: `apps/server/src/apply/managed-state.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/apply/managed-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  EMPTY_MANAGED_STATE,
  parseManagedState,
  serializeManagedState,
  staleEntries
} from './managed-state.js'

describe('parseManagedState', () => {
  it('returns the empty state for null', () => {
    expect(parseManagedState(null)).toEqual(EMPTY_MANAGED_STATE)
  })

  it('returns the empty state for malformed JSON', () => {
    expect(parseManagedState('{not json')).toEqual(EMPTY_MANAGED_STATE)
  })

  it('fills missing keys with empty arrays', () => {
    expect(parseManagedState('{"mcpServers":["github"]}')).toEqual({
      mcpServers: ['github'],
      materialized: [],
      permissionAllow: [],
      permissionDeny: []
    })
  })

  it('drops non-string entries', () => {
    expect(parseManagedState('{"mcpServers":["github",42,null]}').mcpServers).toEqual(['github'])
  })
})

describe('serializeManagedState', () => {
  it('round-trips through parseManagedState', () => {
    const state = {
      mcpServers: ['github'],
      materialized: ['.claude/skills/drawio'],
      permissionAllow: ['Edit'],
      permissionDeny: ['Bash(rm:*)']
    }

    expect(parseManagedState(serializeManagedState(state))).toEqual(state)
  })
})

describe('staleEntries', () => {
  it('returns entries that were managed before but are not desired now', () => {
    expect(staleEntries(['github', 'playwright'], ['github'])).toEqual(['playwright'])
  })

  it('returns an empty array when everything is still desired', () => {
    expect(staleEntries(['github'], ['github', 'memory'])).toEqual([])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/apply/managed-state.test.ts`
Expected: FAIL — `Cannot find module './managed-state.js'`

- [ ] **Step 3: 実装**

`apps/server/src/apply/managed-state.ts`:

```ts
export interface ManagedState {
  mcpServers: string[]
  materialized: string[]
  permissionAllow: string[]
  permissionDeny: string[]
}

export const EMPTY_MANAGED_STATE: ManagedState = {
  mcpServers: [],
  materialized: [],
  permissionAllow: [],
  permissionDeny: []
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

export function parseManagedState(json: string | null | undefined): ManagedState {
  if (!json) {
    return { ...EMPTY_MANAGED_STATE }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ...EMPTY_MANAGED_STATE }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ...EMPTY_MANAGED_STATE }
  }
  const source = parsed as Record<string, unknown>
  return {
    mcpServers: readStringArray(source.mcpServers),
    materialized: readStringArray(source.materialized),
    permissionAllow: readStringArray(source.permissionAllow),
    permissionDeny: readStringArray(source.permissionDeny)
  }
}

export function serializeManagedState(state: ManagedState): string {
  return JSON.stringify(state)
}

export function staleEntries(previouslyManaged: string[], desired: string[]): string[] {
  return previouslyManaged.filter((entry) => !desired.includes(entry))
}
```

- [ ] **Step 4: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/server -- src/apply/managed-state.test.ts`
Expected: PASS

```bash
git add apps/server/src/apply/managed-state.ts apps/server/src/apply/managed-state.test.ts
git commit -m "feat(server): add managed state value object for apply"
```

---

### Task 6: settings.json の permissions マージ（純関数）

**Files:**
- Create: `apps/server/src/apply/plan-settings.ts`
- Create: `apps/server/src/apply/plan-settings.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/apply/plan-settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EMPTY_MANAGED_STATE } from './managed-state.js'
import { planSettings } from './plan-settings.js'

describe('planSettings', () => {
  it('adds the role entries to an empty settings file', () => {
    const result = planSettings({
      currentSettings: {},
      rolePermissions: { allow: ['Edit', 'Read'] },
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.settings).toEqual({ permissions: { allow: ['Edit', 'Read'] } })
    expect(result.managedAllow).toEqual(['Edit', 'Read'])
  })

  it('keeps manually added entries that skillam never managed', () => {
    const result = planSettings({
      currentSettings: { permissions: { allow: ['Bash(git:*)'] } },
      rolePermissions: { allow: ['Edit'] },
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.settings.permissions).toEqual({ allow: ['Bash(git:*)', 'Edit'] })
  })

  it('removes an entry that skillam applied last time but the role no longer has', () => {
    const result = planSettings({
      currentSettings: { permissions: { allow: ['Bash(git:*)', 'Edit', 'WebSearch'] } },
      rolePermissions: { allow: ['Edit'] },
      previous: { ...EMPTY_MANAGED_STATE, permissionAllow: ['Edit', 'WebSearch'] }
    })

    expect(result.settings.permissions).toEqual({ allow: ['Bash(git:*)', 'Edit'] })
  })

  it('does not duplicate an entry that is already present', () => {
    const result = planSettings({
      currentSettings: { permissions: { allow: ['Edit'] } },
      rolePermissions: { allow: ['Edit'] },
      previous: { ...EMPTY_MANAGED_STATE, permissionAllow: ['Edit'] }
    })

    expect(result.settings.permissions).toEqual({ allow: ['Edit'] })
  })

  it('merges deny independently of allow', () => {
    const result = planSettings({
      currentSettings: { permissions: { allow: ['Edit'], deny: ['Bash(rm:*)'] } },
      rolePermissions: { deny: ['Bash(curl:*)'] },
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.settings.permissions).toEqual({
      allow: ['Edit'],
      deny: ['Bash(rm:*)', 'Bash(curl:*)']
    })
  })

  it('passes through unmanaged keys untouched', () => {
    const result = planSettings({
      currentSettings: {
        hooks: { PreToolUse: [{ matcher: 'Bash' }] },
        enabledPlugins: { 'example@market': true },
        permissions: { defaultMode: 'acceptEdits' }
      },
      rolePermissions: { allow: ['Edit'] },
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.settings.hooks).toEqual({ PreToolUse: [{ matcher: 'Bash' }] })
    expect(result.settings.enabledPlugins).toEqual({ 'example@market': true })
    expect((result.settings.permissions as Record<string, unknown>).defaultMode).toBe('acceptEdits')
  })

  it('leaves settings without permissions unchanged when the role has none', () => {
    const result = planSettings({
      currentSettings: { hooks: {} },
      rolePermissions: {},
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.settings).toEqual({ hooks: {} })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/apply/plan-settings.test.ts`
Expected: FAIL — `Cannot find module './plan-settings.js'`

- [ ] **Step 3: 実装**

`apps/server/src/apply/plan-settings.ts`:

```ts
import { staleEntries, type ManagedState } from './managed-state.js'

export interface RolePermissionsShape {
  allow?: string[]
  deny?: string[]
}

export interface PlanSettingsInput {
  currentSettings: Record<string, unknown>
  rolePermissions: RolePermissionsShape
  previous: ManagedState
}

export interface PlanSettingsResult {
  settings: Record<string, unknown>
  managedAllow: string[]
  managedDeny: string[]
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function mergeList(current: string[], roleEntries: string[], previouslyManaged: string[]): string[] {
  const stale = staleEntries(previouslyManaged, roleEntries)
  const merged = current.filter((entry) => !stale.includes(entry))
  for (const entry of roleEntries) {
    if (!merged.includes(entry)) {
      merged.push(entry)
    }
  }
  return merged
}

export function planSettings(input: PlanSettingsInput): PlanSettingsResult {
  const currentPermissions =
    typeof input.currentSettings.permissions === 'object' && input.currentSettings.permissions !== null
      ? (input.currentSettings.permissions as Record<string, unknown>)
      : {}

  const roleAllow = input.rolePermissions.allow ?? []
  const roleDeny = input.rolePermissions.deny ?? []

  const allow = mergeList(readStringArray(currentPermissions.allow), roleAllow, input.previous.permissionAllow)
  const deny = mergeList(readStringArray(currentPermissions.deny), roleDeny, input.previous.permissionDeny)

  const permissions: Record<string, unknown> = { ...currentPermissions }
  if (allow.length > 0 || 'allow' in currentPermissions) {
    permissions.allow = allow
  }
  if (deny.length > 0 || 'deny' in currentPermissions) {
    permissions.deny = deny
  }

  const settings: Record<string, unknown> = { ...input.currentSettings }
  if (Object.keys(permissions).length > 0) {
    settings.permissions = permissions
  }

  return { settings, managedAllow: roleAllow, managedDeny: roleDeny }
}
```

- [ ] **Step 4: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/server -- src/apply/plan-settings.test.ts`
Expected: PASS（7テスト）

```bash
git add apps/server/src/apply/plan-settings.ts apps/server/src/apply/plan-settings.test.ts
git commit -m "feat(server): add settings permissions merge planner"
```

---

### Task 7: .mcp.json の mcpServers マージ（純関数）

**Files:**
- Create: `apps/server/src/apply/plan-mcp.ts`
- Create: `apps/server/src/apply/plan-mcp.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/apply/plan-mcp.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EMPTY_MANAGED_STATE } from './managed-state.js'
import { planMcp } from './plan-mcp.js'

describe('planMcp', () => {
  it('writes a role server into an empty file', () => {
    const result = planMcp({
      currentMcpJson: {},
      roleServers: [{ name: 'github', command: { command: 'npx', args: ['-y', 'server'] }, env: {} }],
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.mcpJson).toEqual({
      mcpServers: { github: { command: 'npx', args: ['-y', 'server'] } }
    })
    expect(result.managedServers).toEqual(['github'])
  })

  it('attaches env when the role server has one', () => {
    const result = planMcp({
      currentMcpJson: {},
      roleServers: [
        { name: 'github', command: { command: 'npx' }, env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } }
      ],
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.mcpJson.mcpServers).toEqual({
      github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } }
    })
  })

  it('keeps a manually added server that skillam never managed', () => {
    const result = planMcp({
      currentMcpJson: { mcpServers: { mine: { command: 'node' } } },
      roleServers: [{ name: 'github', command: { command: 'npx' }, env: {} }],
      previous: EMPTY_MANAGED_STATE
    })

    expect(Object.keys(result.mcpJson.mcpServers as object).sort()).toEqual(['github', 'mine'])
  })

  it('removes a server that skillam applied last time but the role no longer has', () => {
    const result = planMcp({
      currentMcpJson: { mcpServers: { github: { command: 'npx' }, playwright: { command: 'npx' } } },
      roleServers: [{ name: 'github', command: { command: 'npx' }, env: {} }],
      previous: { ...EMPTY_MANAGED_STATE, mcpServers: ['github', 'playwright'] }
    })

    expect(result.mcpJson.mcpServers).toEqual({ github: { command: 'npx' } })
  })

  it('overwrites an existing server definition with the role definition', () => {
    const result = planMcp({
      currentMcpJson: { mcpServers: { github: { command: 'old', args: ['stale'] } } },
      roleServers: [{ name: 'github', command: { command: 'npx' }, env: {} }],
      previous: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] }
    })

    expect(result.mcpJson.mcpServers).toEqual({ github: { command: 'npx' } })
  })

  it('passes through unmanaged top-level keys', () => {
    const result = planMcp({
      currentMcpJson: { $schema: 'https://example.com/schema.json', mcpServers: {} },
      roleServers: [],
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.mcpJson.$schema).toBe('https://example.com/schema.json')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/apply/plan-mcp.test.ts`
Expected: FAIL — `Cannot find module './plan-mcp.js'`

- [ ] **Step 3: 実装**

`apps/server/src/apply/plan-mcp.ts`:

```ts
import { staleEntries, type ManagedState } from './managed-state.js'

export interface RoleMcpServerLike {
  name: string
  command: unknown
  env: Record<string, string>
}

export interface PlanMcpInput {
  currentMcpJson: Record<string, unknown>
  roleServers: RoleMcpServerLike[]
  previous: ManagedState
}

export interface PlanMcpResult {
  mcpJson: Record<string, unknown>
  managedServers: string[]
}

export function planMcp(input: PlanMcpInput): PlanMcpResult {
  const currentServers =
    typeof input.currentMcpJson.mcpServers === 'object' && input.currentMcpJson.mcpServers !== null
      ? { ...(input.currentMcpJson.mcpServers as Record<string, unknown>) }
      : {}

  const roleNames = input.roleServers.map((server) => server.name)

  for (const name of staleEntries(input.previous.mcpServers, roleNames)) {
    delete currentServers[name]
  }

  for (const server of input.roleServers) {
    const base =
      typeof server.command === 'object' && server.command !== null
        ? { ...(server.command as Record<string, unknown>) }
        : {}
    currentServers[server.name] =
      Object.keys(server.env).length > 0 ? { ...base, env: server.env } : base
  }

  return {
    mcpJson: { ...input.currentMcpJson, mcpServers: currentServers },
    managedServers: roleNames
  }
}
```

- [ ] **Step 4: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/server -- src/apply/plan-mcp.test.ts`
Expected: PASS（6テスト）

```bash
git add apps/server/src/apply/plan-mcp.ts apps/server/src/apply/plan-mcp.test.ts
git commit -m "feat(server): add mcp servers merge planner"
```

---

### Task 8: symlink / 実ファイルの差分計算（純関数）

**Files:**
- Create: `apps/server/src/apply/plan-materialize.ts`
- Create: `apps/server/src/apply/plan-materialize.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/apply/plan-materialize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { planMaterialize } from './plan-materialize.js'

describe('planMaterialize', () => {
  it('creates a link that does not exist yet', () => {
    const result = planMaterialize({
      desired: [{ kind: 'link', path: '.claude/skills/drawio', target: '/home/u/.claude/skills/drawio' }],
      current: {},
      previouslyManaged: []
    })

    expect(result.operations).toEqual([
      { type: 'create-link', path: '.claude/skills/drawio', target: '/home/u/.claude/skills/drawio' }
    ])
    expect(result.managed).toEqual(['.claude/skills/drawio'])
  })

  it('emits no operation when the link already points at the target', () => {
    const result = planMaterialize({
      desired: [{ kind: 'link', path: '.claude/skills/drawio', target: '/home/u/.claude/skills/drawio' }],
      current: { '.claude/skills/drawio': { kind: 'link', target: '/home/u/.claude/skills/drawio' } },
      previouslyManaged: ['.claude/skills/drawio']
    })

    expect(result.operations).toEqual([])
  })

  it('recreates a link that points somewhere else', () => {
    const result = planMaterialize({
      desired: [{ kind: 'link', path: '.claude/skills/drawio', target: '/new/drawio' }],
      current: { '.claude/skills/drawio': { kind: 'link', target: '/old/drawio' } },
      previouslyManaged: ['.claude/skills/drawio']
    })

    expect(result.operations).toEqual([
      { type: 'create-link', path: '.claude/skills/drawio', target: '/new/drawio' }
    ])
  })

  it('writes an authored agent file whose content differs', () => {
    const result = planMaterialize({
      desired: [{ kind: 'file', path: '.claude/agents/writer.md', content: '# new' }],
      current: { '.claude/agents/writer.md': { kind: 'file', content: '# old' } },
      previouslyManaged: ['.claude/agents/writer.md']
    })

    expect(result.operations).toEqual([
      { type: 'write-file', path: '.claude/agents/writer.md', content: '# new' }
    ])
  })

  it('emits no operation when the authored file content already matches', () => {
    const result = planMaterialize({
      desired: [{ kind: 'file', path: '.claude/agents/writer.md', content: '# same' }],
      current: { '.claude/agents/writer.md': { kind: 'file', content: '# same' } },
      previouslyManaged: ['.claude/agents/writer.md']
    })

    expect(result.operations).toEqual([])
  })

  it('removes an entry that skillam applied last time but the role no longer has', () => {
    const result = planMaterialize({
      desired: [],
      current: { '.claude/skills/drawio': { kind: 'link', target: '/home/u/.claude/skills/drawio' } },
      previouslyManaged: ['.claude/skills/drawio']
    })

    expect(result.operations).toEqual([{ type: 'remove', path: '.claude/skills/drawio' }])
    expect(result.managed).toEqual([])
  })

  it('does not remove a path that skillam never managed', () => {
    const result = planMaterialize({
      desired: [],
      current: { '.claude/skills/manual': { kind: 'link', target: '/somewhere' } },
      previouslyManaged: []
    })

    expect(result.operations).toEqual([])
  })

  it('orders removals before creations', () => {
    const result = planMaterialize({
      desired: [{ kind: 'link', path: '.claude/skills/new', target: '/new' }],
      current: { '.claude/skills/old': { kind: 'link', target: '/old' } },
      previouslyManaged: ['.claude/skills/old']
    })

    expect(result.operations.map((operation) => operation.type)).toEqual(['remove', 'create-link'])
  })

  it('replaces a real file that sits where a link should go', () => {
    const result = planMaterialize({
      desired: [{ kind: 'link', path: '.claude/skills/drawio', target: '/home/u/drawio' }],
      current: { '.claude/skills/drawio': { kind: 'file', content: 'oops' } },
      previouslyManaged: []
    })

    expect(result.operations).toEqual([
      { type: 'create-link', path: '.claude/skills/drawio', target: '/home/u/drawio' }
    ])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/apply/plan-materialize.test.ts`
Expected: FAIL — `Cannot find module './plan-materialize.js'`

- [ ] **Step 3: 実装**

`apps/server/src/apply/plan-materialize.ts`:

```ts
import { staleEntries } from './managed-state.js'

export interface DesiredLink {
  kind: 'link'
  path: string
  target: string
}

export interface DesiredFile {
  kind: 'file'
  path: string
  content: string
}

export type DesiredEntry = DesiredLink | DesiredFile

export type CurrentEntry = { kind: 'link'; target: string } | { kind: 'file'; content: string }

export type MaterializeOperation =
  | { type: 'create-link'; path: string; target: string }
  | { type: 'write-file'; path: string; content: string }
  | { type: 'remove'; path: string }

export interface PlanMaterializeInput {
  desired: DesiredEntry[]
  current: Record<string, CurrentEntry>
  previouslyManaged: string[]
}

export interface PlanMaterializeResult {
  operations: MaterializeOperation[]
  managed: string[]
}

export function planMaterialize(input: PlanMaterializeInput): PlanMaterializeResult {
  const desiredPaths = input.desired.map((entry) => entry.path)
  const operations: MaterializeOperation[] = []

  for (const path of staleEntries(input.previouslyManaged, desiredPaths)) {
    operations.push({ type: 'remove', path })
  }

  for (const entry of input.desired) {
    const current = input.current[entry.path]
    if (entry.kind === 'link') {
      if (current?.kind === 'link' && current.target === entry.target) {
        continue
      }
      operations.push({ type: 'create-link', path: entry.path, target: entry.target })
      continue
    }
    if (current?.kind === 'file' && current.content === entry.content) {
      continue
    }
    operations.push({ type: 'write-file', path: entry.path, content: entry.content })
  }

  return { operations, managed: desiredPaths }
}
```

- [ ] **Step 4: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/server -- src/apply/plan-materialize.test.ts`
Expected: PASS（9テスト）

```bash
git add apps/server/src/apply/plan-materialize.ts apps/server/src/apply/plan-materialize.test.ts
git commit -m "feat(server): add symlink and authored-file materialization planner"
```

---

### Task 9: 適用履歴リポジトリと `projects.markApplied`

**Files:**
- Create: `apps/server/src/apply/apply-history.types.ts`
- Create: `apps/server/src/apply/apply-history.repository.ts`
- Create: `apps/server/src/apply/apply-history.repository.test.ts`
- Modify: `apps/server/src/projects/projects.types.ts`
- Modify: `apps/server/src/projects/projects.repository.ts`
- Modify: `apps/server/src/projects/projects.repository.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/apply/apply-history.repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from '../roles/roles.repository.js'
import { ProjectsRepository } from '../projects/projects.repository.js'
import { ApplyHistoryRepository } from './apply-history.repository.js'
import { EMPTY_MANAGED_STATE } from './managed-state.js'

describe('ApplyHistoryRepository', () => {
  let db: Database.Database
  let projectId: number
  let roleId: number

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    projectId = new ProjectsRepository(db).create({ path: '/tmp/h', name: 'h' }).id
    roleId = new RolesRepository(db).create({ name: 'dev' }).id
  })

  it('returns an empty list for a project with no history', () => {
    expect(new ApplyHistoryRepository(db).listForProject(projectId)).toEqual([])
  })

  it('records a successful apply with its managed state', () => {
    const repo = new ApplyHistoryRepository(db)

    const entry = repo.record({
      projectId,
      roleId,
      diff: { files: ['settings.json'] },
      managed: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] },
      status: 'success'
    })

    expect(entry).toEqual(
      expect.objectContaining({
        projectId,
        roleId,
        status: 'success',
        errorMessage: '',
        diff: { files: ['settings.json'] },
        managed: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] }
      })
    )
  })

  it('records a failed apply with its error message', () => {
    const repo = new ApplyHistoryRepository(db)

    const entry = repo.record({
      projectId,
      roleId,
      diff: {},
      managed: EMPTY_MANAGED_STATE,
      status: 'failed',
      errorMessage: 'EACCES: permission denied'
    })

    expect(entry.status).toBe('failed')
    expect(entry.errorMessage).toBe('EACCES: permission denied')
  })

  it('lists history newest first', () => {
    const repo = new ApplyHistoryRepository(db)
    const first = repo.record({ projectId, roleId, diff: {}, managed: EMPTY_MANAGED_STATE, status: 'success' })
    const second = repo.record({ projectId, roleId, diff: {}, managed: EMPTY_MANAGED_STATE, status: 'success' })

    expect(repo.listForProject(projectId).map((entry) => entry.id)).toEqual([second.id, first.id])
  })

  it('returns the most recent successful entry, ignoring failures', () => {
    const repo = new ApplyHistoryRepository(db)
    const success = repo.record({
      projectId,
      roleId,
      diff: {},
      managed: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] },
      status: 'success'
    })
    repo.record({ projectId, roleId, diff: {}, managed: EMPTY_MANAGED_STATE, status: 'failed' })

    expect(repo.lastSuccessful(projectId)?.id).toBe(success.id)
  })

  it('returns undefined when a project has no successful apply', () => {
    expect(new ApplyHistoryRepository(db).lastSuccessful(projectId)).toBeUndefined()
  })
})
```

`apps/server/src/projects/projects.repository.test.ts` に追加:

```ts
  it('records the last applied role', () => {
    const repo = new ProjectsRepository(db)
    const project = repo.create({ path: '/tmp/marked', name: 'marked' })
    const roleId = new RolesRepository(db).create({ name: 'applied-role' }).id

    const updated = repo.markApplied(project.id, roleId)

    expect(updated?.lastAppliedRoleId).toBe(roleId)
    expect(updated?.lastAppliedAt).toEqual(expect.any(String))
  })
```

（このファイルが `RolesRepository` を import していない場合は `import { RolesRepository } from '../roles/roles.repository.js'` を追加する。）

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/apply/apply-history.repository.test.ts src/projects/projects.repository.test.ts`
Expected: FAIL — `Cannot find module './apply-history.repository.js'`、`repo.markApplied is not a function`

- [ ] **Step 3: 型を作成**

`apps/server/src/apply/apply-history.types.ts`:

```ts
import type { ManagedState } from './managed-state.js'

export type ApplyStatus = 'success' | 'failed'

export interface ApplyHistoryEntry {
  id: number
  projectId: number
  roleId: number
  diff: unknown
  managed: ManagedState
  status: ApplyStatus
  errorMessage: string
  appliedAt: string
}

export interface RecordApplyInput {
  projectId: number
  roleId: number
  diff: unknown
  managed: ManagedState
  status: ApplyStatus
  errorMessage?: string
}
```

- [ ] **Step 4: 履歴リポジトリを実装**

`apps/server/src/apply/apply-history.repository.ts`:

```ts
import type Database from 'better-sqlite3'
import { parseManagedState, serializeManagedState } from './managed-state.js'
import type { ApplyHistoryEntry, ApplyStatus, RecordApplyInput } from './apply-history.types.js'

interface ApplyHistoryRow {
  id: number
  project_id: number
  role_id: number
  diff_json: string
  managed_json: string
  status: string
  error_message: string
  applied_at: string
}

function toEntry(row: ApplyHistoryRow): ApplyHistoryEntry {
  let diff: unknown = {}
  try {
    diff = JSON.parse(row.diff_json)
  } catch {
    diff = {}
  }
  return {
    id: row.id,
    projectId: row.project_id,
    roleId: row.role_id,
    diff,
    managed: parseManagedState(row.managed_json),
    status: row.status as ApplyStatus,
    errorMessage: row.error_message,
    appliedAt: row.applied_at
  }
}

export class ApplyHistoryRepository {
  constructor(private readonly db: Database.Database) {}

  record(input: RecordApplyInput): ApplyHistoryEntry {
    const row = this.db
      .prepare(
        `INSERT INTO apply_history (project_id, role_id, diff_json, managed_json, status, error_message)
         VALUES (@projectId, @roleId, @diffJson, @managedJson, @status, @errorMessage)
         RETURNING *`
      )
      .get({
        projectId: input.projectId,
        roleId: input.roleId,
        diffJson: JSON.stringify(input.diff ?? {}),
        managedJson: serializeManagedState(input.managed),
        status: input.status,
        errorMessage: input.errorMessage ?? ''
      }) as ApplyHistoryRow
    return toEntry(row)
  }

  listForProject(projectId: number): ApplyHistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM apply_history WHERE project_id = ? ORDER BY id DESC')
      .all(projectId) as ApplyHistoryRow[]
    return rows.map(toEntry)
  }

  lastSuccessful(projectId: number): ApplyHistoryEntry | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM apply_history WHERE project_id = ? AND status = 'success' ORDER BY id DESC LIMIT 1"
      )
      .get(projectId) as ApplyHistoryRow | undefined
    return row ? toEntry(row) : undefined
  }
}
```

- [ ] **Step 5: `Project` 型と `ProjectsRepository` を更新**

`apps/server/src/projects/projects.types.ts` の `Project` に2つのフィールドを追加する:

```ts
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
```

`apps/server/src/projects/projects.repository.ts` の `ProjectRow` に列を追加:

```ts
interface ProjectRow {
  id: number
  path: string
  name: string
  auto_detected: number
  excluded: number
  last_applied_role_id: number | null
  last_applied_at: string | null
  created_at: string
  updated_at: string
}
```

`toProject` に2行追加:

```ts
    lastAppliedRoleId: row.last_applied_role_id,
    lastAppliedAt: row.last_applied_at,
```

`delete` メソッドの直前に `markApplied` を追加:

```ts
  markApplied(id: number, roleId: number): Project | undefined {
    const row = this.db
      .prepare(
        `UPDATE projects
         SET last_applied_role_id = @roleId, last_applied_at = datetime('now'), updated_at = datetime('now')
         WHERE id = @id
         RETURNING *`
      )
      .get({ id, roleId }) as ProjectRow | undefined
    return row ? toProject(row) : undefined
  }
```

- [ ] **Step 6: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/server`
Expected: PASS（`create` の `RETURNING *` により新列は null で返るため、既存テストは壊れない）

```bash
git add apps/server/src/apply apps/server/src/projects
git commit -m "feat(server): add apply history repository and last-applied tracking"
```

---

### Task 10: ApplyPlan を組み立てるプランナー

**Files:**
- Create: `apps/server/src/apply/apply-planner.ts`
- Create: `apps/server/src/apply/apply-planner.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/apply/apply-planner.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from '../roles/roles.repository.js'
import { RoleSkillsRepository } from '../roles/role-skills.repository.js'
import { RoleAgentsRepository } from '../roles/role-agents.repository.js'
import { RoleMcpServersRepository } from '../roles/role-mcp-servers.repository.js'
import { RolePermissionsRepository } from '../roles/role-permissions.repository.js'
import { ProjectsRepository } from '../projects/projects.repository.js'
import { ApplyHistoryRepository } from './apply-history.repository.js'
import { buildApplyPlan } from './apply-planner.js'
import type { ApplyPlannerDeps } from './apply-planner.js'

describe('buildApplyPlan', () => {
  let db: Database.Database
  let deps: ApplyPlannerDeps
  let scratchRoot: string
  let projectPath: string
  let roleId: number

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-planner-test-')))
    projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })

    deps = {
      skills: new RoleSkillsRepository(db),
      agents: new RoleAgentsRepository(db),
      mcpServers: new RoleMcpServersRepository(db),
      permissions: new RolePermissionsRepository(db),
      history: new ApplyHistoryRepository(db)
    }

    roleId = new RolesRepository(db).create({ name: 'dev' }).id
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  function project() {
    return new ProjectsRepository(db).create({ path: projectPath, name: 'project' })
  }

  it('plans settings.json from scratch when the project has no .claude directory', () => {
    new RolePermissionsRepository(db).setForRole(roleId, { permissions: { allow: ['Edit'] } })

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(plan.settingsFile.path).toBe(path.join(projectPath, '.claude', 'settings.json'))
    expect(plan.settingsFile.before).toBeNull()
    expect(JSON.parse(plan.settingsFile.after)).toEqual({ permissions: { allow: ['Edit'] } })
  })

  it('preserves the existing settings.json content it does not manage', () => {
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ language: 'ja', permissions: { allow: ['Bash(git:*)'] } })
    )
    new RolePermissionsRepository(db).setForRole(roleId, { permissions: { allow: ['Edit'] } })

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(JSON.parse(plan.settingsFile.after)).toEqual({
      language: 'ja',
      permissions: { allow: ['Bash(git:*)', 'Edit'] }
    })
  })

  it('plans a skill symlink named after the skill directory', () => {
    const skillPath = path.join(scratchRoot, 'user-skills', 'drawio')
    fs.mkdirSync(skillPath, { recursive: true })
    new RoleSkillsRepository(db).replaceForRole(roleId, [{ skillSource: 'user', skillPath }])

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(plan.operations).toEqual([
      {
        type: 'create-link',
        path: path.join(projectPath, '.claude', 'skills', 'drawio'),
        target: skillPath
      }
    ])
    expect(plan.managed.materialized).toEqual(['.claude/skills/drawio'])
  })

  it('plans a link for a reference agent and a file write for an authored agent', () => {
    const agentPath = path.join(scratchRoot, 'user-agents', 'reviewer.md')
    fs.mkdirSync(path.dirname(agentPath), { recursive: true })
    fs.writeFileSync(agentPath, '# reviewer')
    new RoleAgentsRepository(db).replaceForRole(roleId, [
      { name: 'reviewer', markdownBody: '', source: 'reference', sourcePath: agentPath },
      { name: 'writer', markdownBody: '# writer', source: 'authored' }
    ])

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(plan.operations).toEqual([
      {
        type: 'create-link',
        path: path.join(projectPath, '.claude', 'agents', 'reviewer.md'),
        target: agentPath
      },
      {
        type: 'write-file',
        path: path.join(projectPath, '.claude', 'agents', 'writer.md'),
        content: '# writer'
      }
    ])
  })

  it('keeps secret_ref placeholders in the previewed .mcp.json', () => {
    new RoleMcpServersRepository(db).replaceForRole(roleId, [
      { name: 'github', command: { command: 'npx' }, env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } }
    ])

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(plan.mcpFile.after).toContain('secret_ref:mcp:github:TOKEN')
    expect(plan.mcpAfterObject.mcpServers).toEqual({
      github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } }
    })
  })

  it('uses the managed state of the last successful apply to plan removals', () => {
    const createdProject = project()
    deps.history.record({
      projectId: createdProject.id,
      roleId,
      diff: {},
      managed: {
        mcpServers: ['playwright'],
        materialized: [],
        permissionAllow: [],
        permissionDeny: []
      },
      status: 'success'
    })
    fs.writeFileSync(
      path.join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { playwright: { command: 'npx' } } })
    )

    const plan = buildApplyPlan(deps, createdProject, roleId)

    expect(plan.mcpAfterObject.mcpServers).toEqual({})
  })

  it('produces an unchanged plan when the project already matches the role', () => {
    fs.writeFileSync(
      path.join(projectPath, '.mcp.json'),
      `${JSON.stringify({ mcpServers: { github: { command: 'npx' } } }, null, 2)}\n`
    )
    new RoleMcpServersRepository(db).replaceForRole(roleId, [
      { name: 'github', command: { command: 'npx' }, env: {} }
    ])

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(plan.mcpFile.after).toBe(plan.mcpFile.before)
    expect(plan.operations).toEqual([])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/apply/apply-planner.test.ts`
Expected: FAIL — `Cannot find module './apply-planner.js'`

- [ ] **Step 3: 実装**

`apps/server/src/apply/apply-planner.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { Project } from '../projects/projects.types.js'
import type { RoleSkillsRepository } from '../roles/role-skills.repository.js'
import type { RoleAgentsRepository } from '../roles/role-agents.repository.js'
import type { RoleMcpServersRepository } from '../roles/role-mcp-servers.repository.js'
import type { RolePermissionsRepository } from '../roles/role-permissions.repository.js'
import type { ApplyHistoryRepository } from './apply-history.repository.js'
import { EMPTY_MANAGED_STATE, type ManagedState } from './managed-state.js'
import { planSettings, type RolePermissionsShape } from './plan-settings.js'
import { planMcp } from './plan-mcp.js'
import {
  planMaterialize,
  type CurrentEntry,
  type DesiredEntry,
  type MaterializeOperation
} from './plan-materialize.js'

export interface ApplyPlannerDeps {
  skills: RoleSkillsRepository
  agents: RoleAgentsRepository
  mcpServers: RoleMcpServersRepository
  permissions: RolePermissionsRepository
  history: ApplyHistoryRepository
}

export interface FileChange {
  path: string
  before: string | null
  after: string
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

function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (raw === null) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function readCurrentEntry(projectPath: string, relativePath: string): CurrentEntry | undefined {
  const absolutePath = path.join(projectPath, relativePath)
  let stats: fs.Stats
  try {
    stats = fs.lstatSync(absolutePath)
  } catch {
    return undefined
  }
  if (stats.isSymbolicLink()) {
    return { kind: 'link', target: fs.readlinkSync(absolutePath) }
  }
  if (stats.isFile()) {
    return { kind: 'file', content: fs.readFileSync(absolutePath, 'utf-8') }
  }
  return { kind: 'file', content: '' }
}

function toRolePermissions(value: unknown): RolePermissionsShape {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const source = value as Record<string, unknown>
  return {
    allow: Array.isArray(source.allow) ? (source.allow as string[]) : undefined,
    deny: Array.isArray(source.deny) ? (source.deny as string[]) : undefined
  }
}

export function buildApplyPlan(deps: ApplyPlannerDeps, project: Project, roleId: number): ApplyPlan {
  const previous = deps.history.lastSuccessful(project.id)?.managed ?? EMPTY_MANAGED_STATE

  const settingsPath = path.join(project.path, '.claude', 'settings.json')
  const settingsBefore = readFileOrNull(settingsPath)
  const settingsResult = planSettings({
    currentSettings: parseJsonObject(settingsBefore),
    rolePermissions: toRolePermissions(deps.permissions.getForRole(roleId)?.permissions),
    previous
  })

  const mcpPath = path.join(project.path, '.mcp.json')
  const mcpBefore = readFileOrNull(mcpPath)
  const mcpResult = planMcp({
    currentMcpJson: parseJsonObject(mcpBefore),
    roleServers: deps.mcpServers.listForRole(roleId).map((server) => ({
      name: server.name,
      command: server.command,
      env: server.env
    })),
    previous
  })

  const desired: DesiredEntry[] = []
  for (const skill of deps.skills.listForRole(roleId)) {
    desired.push({
      kind: 'link',
      path: `.claude/skills/${path.basename(skill.skillPath)}`,
      target: skill.skillPath
    })
  }
  for (const agent of deps.agents.listForRole(roleId)) {
    if (agent.source === 'reference') {
      desired.push({ kind: 'link', path: `.claude/agents/${agent.name}.md`, target: agent.sourcePath })
      continue
    }
    desired.push({ kind: 'file', path: `.claude/agents/${agent.name}.md`, content: agent.markdownBody })
  }

  const current: Record<string, CurrentEntry> = {}
  for (const relativePath of [...desired.map((entry) => entry.path), ...previous.materialized]) {
    const entry = readCurrentEntry(project.path, relativePath)
    if (entry) {
      current[relativePath] = entry
    }
  }

  const materializeResult = planMaterialize({
    desired,
    current,
    previouslyManaged: previous.materialized
  })

  return {
    projectId: project.id,
    projectPath: project.path,
    roleId,
    settingsFile: {
      path: settingsPath,
      before: settingsBefore,
      after: formatJson(settingsResult.settings)
    },
    mcpFile: {
      path: mcpPath,
      before: mcpBefore,
      after: formatJson(mcpResult.mcpJson)
    },
    mcpAfterObject: mcpResult.mcpJson,
    operations: materializeResult.operations.map((operation) => ({
      ...operation,
      path: path.join(project.path, operation.path)
    })),
    managed: {
      mcpServers: mcpResult.managedServers,
      materialized: materializeResult.managed,
      permissionAllow: settingsResult.managedAllow,
      permissionDeny: settingsResult.managedDeny
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/server -- src/apply/apply-planner.test.ts`
Expected: PASS（7テスト）

```bash
git add apps/server/src/apply/apply-planner.ts apps/server/src/apply/apply-planner.test.ts
git commit -m "feat(server): add apply plan builder"
```

---

### Task 11: 適用実行（シークレット復号つき）

**Files:**
- Create: `apps/server/src/apply/apply-executor.ts`
- Create: `apps/server/src/apply/apply-executor.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/apply/apply-executor.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { SecretsRepository } from '../secrets/secrets.repository.js'
import { MasterKeyProvider } from '../secrets/master-key-provider.js'
import { InMemoryKeychainClient } from '../secrets/in-memory-keychain-client.js'
import { encrypt } from '../secrets/secrets-cipher.js'
import { EMPTY_MANAGED_STATE } from './managed-state.js'
import { ApplyError, executeApplyPlan } from './apply-executor.js'
import type { ApplyPlan } from './apply-planner.js'
import type { ApplyExecutorDeps } from './apply-executor.js'

describe('executeApplyPlan', () => {
  let db: Database.Database
  let deps: ApplyExecutorDeps
  let scratchRoot: string
  let projectPath: string

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-executor-test-')))
    projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })
    deps = {
      secrets: new SecretsRepository(db),
      masterKeyProvider: new MasterKeyProvider(new InMemoryKeychainClient())
    }
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  function planWith(overrides: Partial<ApplyPlan>): ApplyPlan {
    return {
      projectId: 1,
      projectPath,
      roleId: 1,
      settingsFile: {
        path: path.join(projectPath, '.claude', 'settings.json'),
        before: null,
        after: '{}\n'
      },
      mcpFile: { path: path.join(projectPath, '.mcp.json'), before: null, after: '{}\n' },
      mcpAfterObject: {},
      operations: [],
      managed: EMPTY_MANAGED_STATE,
      ...overrides
    }
  }

  it('creates .claude and writes settings.json', () => {
    executeApplyPlan(planWith({}), deps)

    expect(fs.readFileSync(path.join(projectPath, '.claude', 'settings.json'), 'utf-8')).toBe('{}\n')
  })

  it('injects the decrypted secret value into the written .mcp.json', () => {
    const key = deps.masterKeyProvider.getOrCreateKey()
    deps.secrets.create({
      refName: 'mcp:github:TOKEN',
      encryptedValue: encrypt('ghp_real_value', key)
    })

    executeApplyPlan(
      planWith({
        mcpAfterObject: {
          mcpServers: { github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } } }
        }
      }),
      deps
    )

    const written = JSON.parse(fs.readFileSync(path.join(projectPath, '.mcp.json'), 'utf-8'))
    expect(written.mcpServers.github.env.TOKEN).toBe('ghp_real_value')
  })

  it('throws ApplyError naming the missing secret reference', () => {
    expect(() =>
      executeApplyPlan(
        planWith({
          mcpAfterObject: {
            mcpServers: { github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:MISSING' } } }
          }
        }),
        deps
      )
    ).toThrow(/mcp:github:MISSING/)
  })

  it('does not touch the keychain when no secret reference is present', () => {
    const keychain = new InMemoryKeychainClient()
    executeApplyPlan(planWith({ mcpAfterObject: { mcpServers: {} } }), {
      secrets: new SecretsRepository(db),
      masterKeyProvider: new MasterKeyProvider(keychain)
    })

    expect(keychain.getPassword('skillam', 'master-key')).toBeUndefined()
  })

  it('creates a symlink pointing at the target', () => {
    const target = path.join(scratchRoot, 'skills', 'drawio')
    fs.mkdirSync(target, { recursive: true })
    const linkPath = path.join(projectPath, '.claude', 'skills', 'drawio')

    executeApplyPlan(planWith({ operations: [{ type: 'create-link', path: linkPath, target }] }), deps)

    expect(fs.readlinkSync(linkPath)).toBe(target)
  })

  it('replaces an existing symlink that points elsewhere', () => {
    const oldTarget = path.join(scratchRoot, 'old')
    const newTarget = path.join(scratchRoot, 'new')
    fs.mkdirSync(oldTarget, { recursive: true })
    fs.mkdirSync(newTarget, { recursive: true })
    const linkPath = path.join(projectPath, '.claude', 'skills', 'thing')
    fs.mkdirSync(path.dirname(linkPath), { recursive: true })
    fs.symlinkSync(oldTarget, linkPath)

    executeApplyPlan(
      planWith({ operations: [{ type: 'create-link', path: linkPath, target: newTarget }] }),
      deps
    )

    expect(fs.readlinkSync(linkPath)).toBe(newTarget)
  })

  it('writes an authored agent file', () => {
    const filePath = path.join(projectPath, '.claude', 'agents', 'writer.md')

    executeApplyPlan(
      planWith({ operations: [{ type: 'write-file', path: filePath, content: '# writer' }] }),
      deps
    )

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('# writer')
  })

  it('removes a managed symlink without touching its target', () => {
    const target = path.join(scratchRoot, 'skills', 'drawio')
    fs.mkdirSync(target, { recursive: true })
    const linkPath = path.join(projectPath, '.claude', 'skills', 'drawio')
    fs.mkdirSync(path.dirname(linkPath), { recursive: true })
    fs.symlinkSync(target, linkPath)

    executeApplyPlan(planWith({ operations: [{ type: 'remove', path: linkPath }] }), deps)

    expect(fs.existsSync(linkPath)).toBe(false)
    expect(fs.existsSync(target)).toBe(true)
  })

  it('tolerates removing a path that is already gone', () => {
    const linkPath = path.join(projectPath, '.claude', 'skills', 'never-existed')

    expect(() =>
      executeApplyPlan(planWith({ operations: [{ type: 'remove', path: linkPath }] }), deps)
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/apply/apply-executor.test.ts`
Expected: FAIL — `Cannot find module './apply-executor.js'`

- [ ] **Step 3: 実装**

`apps/server/src/apply/apply-executor.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { SecretsRepository } from '../secrets/secrets.repository.js'
import type { MasterKeyProvider } from '../secrets/master-key-provider.js'
import { decrypt } from '../secrets/secrets-cipher.js'
import type { ApplyPlan } from './apply-planner.js'

const SECRET_REF_PREFIX = 'secret_ref:'

export class ApplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApplyError'
  }
}

export interface ApplyExecutorDeps {
  secrets: SecretsRepository
  masterKeyProvider: MasterKeyProvider
}

export function resolveSecretRefs(
  mcpJson: Record<string, unknown>,
  deps: ApplyExecutorDeps
): Record<string, unknown> {
  const servers = mcpJson.mcpServers
  if (typeof servers !== 'object' || servers === null) {
    return mcpJson
  }

  let key: Buffer | undefined
  const resolvedServers: Record<string, unknown> = {}

  for (const [name, definition] of Object.entries(servers as Record<string, unknown>)) {
    if (typeof definition !== 'object' || definition === null) {
      resolvedServers[name] = definition
      continue
    }
    const entry = { ...(definition as Record<string, unknown>) }
    const env = entry.env
    if (typeof env === 'object' && env !== null) {
      const resolvedEnv: Record<string, string> = {}
      for (const [envKey, value] of Object.entries(env as Record<string, unknown>)) {
        if (typeof value !== 'string' || !value.startsWith(SECRET_REF_PREFIX)) {
          resolvedEnv[envKey] = String(value)
          continue
        }
        const refName = value.slice(SECRET_REF_PREFIX.length)
        const secret = deps.secrets.getByRefName(refName)
        if (!secret) {
          throw new ApplyError(`シークレット参照が解決できません: ${refName}`)
        }
        key = key ?? deps.masterKeyProvider.getOrCreateKey()
        resolvedEnv[envKey] = decrypt(secret.encryptedValue, key)
      }
      entry.env = resolvedEnv
    }
    resolvedServers[name] = entry
  }

  return { ...mcpJson, mcpServers: resolvedServers }
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

export function executeApplyPlan(plan: ApplyPlan, deps: ApplyExecutorDeps): void {
  const resolvedMcp = resolveSecretRefs(plan.mcpAfterObject, deps)

  writeFile(plan.settingsFile.path, plan.settingsFile.after)
  writeFile(plan.mcpFile.path, `${JSON.stringify(resolvedMcp, null, 2)}\n`)

  for (const operation of plan.operations) {
    if (operation.type === 'remove') {
      fs.rmSync(operation.path, { force: true, recursive: true })
      continue
    }
    if (operation.type === 'write-file') {
      writeFile(operation.path, operation.content)
      continue
    }
    fs.mkdirSync(path.dirname(operation.path), { recursive: true })
    fs.rmSync(operation.path, { force: true, recursive: true })
    fs.symlinkSync(operation.target, operation.path)
  }
}
```

シークレット復号を書き込みの前に行うのは、参照が解決できない場合にファイルを一切書かずに失敗させるため。

- [ ] **Step 4: テストが通ることを確認してコミット**

Run: `npm run test -w @skillam/server -- src/apply/apply-executor.test.ts`
Expected: PASS（9テスト）

```bash
git add apps/server/src/apply/apply-executor.ts apps/server/src/apply/apply-executor.test.ts
git commit -m "feat(server): add apply executor with secret injection"
```

---

### Task 12: 適用ルート（preview / apply / history）

**Files:**
- Create: `apps/server/src/apply/apply.routes.ts`
- Create: `apps/server/src/apply/apply.routes.test.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/apply/apply.routes.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'
import { InMemoryKeychainClient } from '../secrets/in-memory-keychain-client.js'

describe('apply routes', () => {
  let db: Database.Database
  let app: FastifyInstance
  let scratchRoot: string
  let projectPath: string
  let projectId: number
  let roleId: number

  beforeEach(async () => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-apply-routes-test-')))
    projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })
    app = buildApp(db, new InMemoryKeychainClient())

    projectId = (
      await app.inject({ method: 'POST', url: '/projects', payload: { path: projectPath, name: 'p' } })
    ).json().id
    roleId = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dev' } })).json().id
    await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/permissions`,
      payload: { permissions: { allow: ['Edit'] } }
    })
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  it('previews without writing anything to disk', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: { roleId }
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.json().settingsFile.after)).toEqual({ permissions: { allow: ['Edit'] } })
    expect(fs.existsSync(path.join(projectPath, '.claude', 'settings.json'))).toBe(false)
  })

  it('returns 404 when previewing an unknown project', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/projects/9999/apply/preview',
      payload: { roleId }
    })

    expect(response.statusCode).toBe(404)
  })

  it('returns 400 when roleId is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  it('writes the files on apply and records a successful history entry', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply`,
      payload: { roleId }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('success')
    expect(
      JSON.parse(fs.readFileSync(path.join(projectPath, '.claude', 'settings.json'), 'utf-8'))
    ).toEqual({ permissions: { allow: ['Edit'] } })

    const history = await app.inject({ method: 'GET', url: `/projects/${projectId}/apply-history` })
    expect(history.json()).toEqual([
      expect.objectContaining({ status: 'success', roleId, errorMessage: '' })
    ])
  })

  it('records the applied role on the project', async () => {
    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })

    const project = await app.inject({ method: 'GET', url: `/projects/${projectId}` })
    expect(project.json().lastAppliedRoleId).toBe(roleId)
  })

  it('removes on re-apply only what the previous apply added', async () => {
    await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/mcp-servers`,
      payload: { servers: [{ name: 'playwright', command: { command: 'npx' } }] }
    })
    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })

    const mcpPath = path.join(projectPath, '.mcp.json')
    const withManual = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'))
    withManual.mcpServers.mine = { command: 'node' }
    fs.writeFileSync(mcpPath, JSON.stringify(withManual, null, 2))

    await app.inject({ method: 'PUT', url: `/roles/${roleId}/mcp-servers`, payload: { servers: [] } })
    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })

    expect(JSON.parse(fs.readFileSync(mcpPath, 'utf-8')).mcpServers).toEqual({ mine: { command: 'node' } })
  })

  it('records a failed history entry when a secret reference cannot be resolved', async () => {
    await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/mcp-servers`,
      payload: {
        servers: [
          { name: 'github', command: { command: 'npx' }, env: { TOKEN: 'secret_ref:mcp:github:GONE' } }
        ]
      }
    })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply`,
      payload: { roleId }
    })

    expect(response.statusCode).toBe(500)
    expect(response.json().error).toContain('mcp:github:GONE')

    const history = await app.inject({ method: 'GET', url: `/projects/${projectId}/apply-history` })
    expect(history.json()[0]).toEqual(
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('mcp:github:GONE') })
    )
  })

  it('returns an empty history for a project that was never applied', async () => {
    const response = await app.inject({ method: 'GET', url: `/projects/${projectId}/apply-history` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @skillam/server -- src/apply/apply.routes.test.ts`
Expected: FAIL — すべて 404（ルート未登録）

- [ ] **Step 3: ルートを実装**

`apps/server/src/apply/apply.routes.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import type { ProjectsRepository } from '../projects/projects.repository.js'
import type { RolesRepository } from '../roles/roles.repository.js'
import { buildApplyPlan, type ApplyPlannerDeps } from './apply-planner.js'
import { executeApplyPlan, type ApplyExecutorDeps } from './apply-executor.js'
import type { ApplyHistoryRepository } from './apply-history.repository.js'

export interface ApplyRouteDeps extends ApplyPlannerDeps, ApplyExecutorDeps {
  projects: ProjectsRepository
  roles: RolesRepository
  history: ApplyHistoryRepository
}

function readRoleId(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }
  const roleId = (body as { roleId?: unknown }).roleId
  return typeof roleId === 'number' ? roleId : undefined
}

export const applyRoutes: FastifyPluginAsync<ApplyRouteDeps> = async (app, deps) => {
  app.post<{ Params: { id: string }; Body: { roleId: number } }>(
    '/projects/:id/apply/preview',
    async (request, reply) => {
      const roleId = readRoleId(request.body)
      if (roleId === undefined) {
        return reply.status(400).send({ error: 'roleId is required' })
      }
      const project = deps.projects.getById(Number(request.params.id))
      if (!project) {
        return reply.status(404).send({ error: 'project not found' })
      }
      if (!deps.roles.getById(roleId)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return buildApplyPlan(deps, project, roleId)
    }
  )

  app.post<{ Params: { id: string }; Body: { roleId: number } }>(
    '/projects/:id/apply',
    async (request, reply) => {
      const roleId = readRoleId(request.body)
      if (roleId === undefined) {
        return reply.status(400).send({ error: 'roleId is required' })
      }
      const project = deps.projects.getById(Number(request.params.id))
      if (!project) {
        return reply.status(404).send({ error: 'project not found' })
      }
      if (!deps.roles.getById(roleId)) {
        return reply.status(404).send({ error: 'role not found' })
      }

      const plan = buildApplyPlan(deps, project, roleId)
      const diff = {
        settingsFile: plan.settingsFile,
        mcpFile: plan.mcpFile,
        operations: plan.operations
      }

      try {
        executeApplyPlan(plan, deps)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const entry = deps.history.record({
          projectId: project.id,
          roleId,
          diff,
          managed: plan.managed,
          status: 'failed',
          errorMessage: message
        })
        return reply.status(500).send({ error: message, historyId: entry.id })
      }

      const entry = deps.history.record({
        projectId: project.id,
        roleId,
        diff,
        managed: plan.managed,
        status: 'success'
      })
      deps.projects.markApplied(project.id, roleId)
      return { status: 'success', historyId: entry.id, plan }
    }
  )

  app.get<{ Params: { id: string } }>('/projects/:id/apply-history', async (request, reply) => {
    const projectId = Number(request.params.id)
    if (!deps.projects.getById(projectId)) {
      return reply.status(404).send({ error: 'project not found' })
    }
    return deps.history.listForProject(projectId)
  })
}
```

失敗時にロールバックしないのは設計書 §12 の方針どおり。部分書き込みは `failed` として履歴に残り、次回のdiffで実態と比較できる。

- [ ] **Step 4: `app.ts` に登録**

import 群に追加:

```ts
import { ApplyHistoryRepository } from './apply/apply-history.repository.js'
import { applyRoutes } from './apply/apply.routes.js'
```

`app.register(catalogRoutes, {...})` の直後に追加:

```ts
  app.register(applyRoutes, {
    projects: new ProjectsRepository(db),
    roles: new RolesRepository(db),
    skills: new RoleSkillsRepository(db),
    agents: new RoleAgentsRepository(db),
    mcpServers: new RoleMcpServersRepository(db),
    permissions: new RolePermissionsRepository(db),
    history: new ApplyHistoryRepository(db),
    secrets: new SecretsRepository(db),
    masterKeyProvider: new MasterKeyProvider(keychainClient)
  })
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm run test -w @skillam/server -- src/apply/apply.routes.test.ts`
Expected: PASS（9テスト）

- [ ] **Step 6: フルスイートと型チェックを流してコミット**

```bash
npm run test -w @skillam/server
npx tsc --noEmit -p apps/server/tsconfig.json
git add apps/server/src/apply/apply.routes.ts apps/server/src/apply/apply.routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add apply preview, apply, and history http routes"
```

---

### Task 13: 実環境に対する手動E2E検証

**Files:** なし（検証のみ）

このタスクは**実際にファイルを書き換える**唯一のタスク。書き換え先は `/tmp` 配下に作った使い捨てプロジェクトに限定し、`~/Develop` の実プロジェクトには適用しないこと。DBも Phase 2c の検証と同様にスクラッチパスを使う。

- [ ] **Step 1: ポート 4317 の残留プロセスを確認**

```bash
lsof -i :4317 -sTCP:LISTEN
```

- [ ] **Step 2: スクラッチDBでサーバーを起動**

```bash
mkdir -p /tmp/skillam-phase3a-verify/project
SKILLAM_DB_PATH=/tmp/skillam-phase3a-verify/skillam.db npm run dev -w @skillam/server &> /tmp/skillam-phase3a-verify.log &
```

`/health` が応答するまでポーリングして待つ。

- [ ] **Step 3: 使い捨てプロジェクトと、実Skillを1つ含むロールを作る**

```bash
curl -s -X POST http://127.0.0.1:4317/projects -H 'content-type: application/json' \
  -d '{"path":"/tmp/skillam-phase3a-verify/project","name":"verify"}'

curl -s -X POST http://127.0.0.1:4317/roles -H 'content-type: application/json' \
  -d '{"name":"verify-role"}'

# カタログから実在するuser Skillのパスをひとつだけコピーしてロールにひもづける
curl -s http://127.0.0.1:4317/catalog/skills | python3 -c "
import json,sys
skills=[s for s in json.load(sys.stdin) if s['source']=='user']
print(json.dumps({'skills':[{'skillSource':'user','skillPath':skills[0]['path']}]}))
" > /tmp/skillam-phase3a-verify/skills.json

curl -s -X PUT http://127.0.0.1:4317/roles/1/skills -H 'content-type: application/json' \
  -d @/tmp/skillam-phase3a-verify/skills.json

curl -s -X PUT http://127.0.0.1:4317/roles/1/permissions -H 'content-type: application/json' \
  -d '{"permissions":{"allow":["Read(*)"]}}'
```

- [ ] **Step 4: プレビューが何も書き込まないことを確認**

```bash
curl -s -X POST http://127.0.0.1:4317/projects/1/apply/preview \
  -H 'content-type: application/json' -d '{"roleId":1}' | python3 -m json.tool | head -40
ls -la /tmp/skillam-phase3a-verify/project
# Expected: プレビュー後もプロジェクトは空（.claude が存在しない）
```

- [ ] **Step 5: 適用して実ファイルを確認**

```bash
curl -s -X POST http://127.0.0.1:4317/projects/1/apply \
  -H 'content-type: application/json' -d '{"roleId":1}' | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])"

cat /tmp/skillam-phase3a-verify/project/.claude/settings.json
ls -la /tmp/skillam-phase3a-verify/project/.claude/skills/
# Expected: settings.json に permissions.allow が入り、skills/ 配下に symlink が1つできている
readlink /tmp/skillam-phase3a-verify/project/.claude/skills/*
# Expected: ~/.claude/skills/<name> を指している
```

- [ ] **Step 6: 手動追加分が温存され、ロールから外した分だけ消えることを確認**

```bash
python3 - <<'PY'
import json
p='/tmp/skillam-phase3a-verify/project/.claude/settings.json'
d=json.load(open(p))
d['permissions']['allow'].append('Bash(git:*)')
d['language']='ja'
json.dump(d, open(p,'w'), indent=2)
PY

curl -s -X PUT http://127.0.0.1:4317/roles/1/permissions -H 'content-type: application/json' \
  -d '{"permissions":{"allow":[]}}'
curl -s -X POST http://127.0.0.1:4317/projects/1/apply -H 'content-type: application/json' -d '{"roleId":1}' > /dev/null

cat /tmp/skillam-phase3a-verify/project/.claude/settings.json
# Expected: "Read(*)" は消え、手動追加した "Bash(git:*)" と "language":"ja" は残っている
```

- [ ] **Step 7: symlink削除が元ファイルを消さないことを確認**

```bash
curl -s -X PUT http://127.0.0.1:4317/roles/1/skills -H 'content-type: application/json' -d '{"skills":[]}'
curl -s -X POST http://127.0.0.1:4317/projects/1/apply -H 'content-type: application/json' -d '{"roleId":1}' > /dev/null

ls -la /tmp/skillam-phase3a-verify/project/.claude/skills/
ls -la ~/.claude/skills/
# Expected: プロジェクト側のsymlinkは消え、~/.claude/skills/ の実体はすべて無傷
```

- [ ] **Step 8: 履歴を確認**

```bash
curl -s http://127.0.0.1:4317/projects/1/apply-history | python3 -c "
import json,sys
for e in json.load(sys.stdin):
    print(e['id'], e['status'], e['managed'])
"
# Expected: 3件が新しい順に並び、各 managed が「その時点でskillamが書いた対象」を表している
```

- [ ] **Step 9: 後片付け**

```bash
lsof -ti:4317 -sTCP:LISTEN | xargs kill
rm -rf /tmp/skillam-phase3a-verify /tmp/skillam-phase3a-verify.log
ls -la ~/.skillam
# Expected: 実DBの mtime が変わっていない（検証は SKILLAM_DB_PATH のみを使った）
```

- [ ] **Step 10: フルスイートを最終実行**

Run: `npm run test -w @skillam/server`
Expected: PASS

- [ ] **Step 11: このタスクはコミットしない**（検証のみ）

---

## Phase 3a Definition of Done

- `PUT /projects/:id/roles` でロールを割り当てられる
- `POST /projects/:id/apply/preview` が、ファイルを一切書き換えずに「現在の内容」と「適用後の内容」を返す
- `POST /projects/:id/apply` が `.claude/settings.json` の `permissions`、`.mcp.json` の `mcpServers`、`.claude/skills/` と `.claude/agents/` の symlink / 実ファイルをマージ適用する
- 手動で追加された設定は適用によって消えず、前回skillamが書いた項目のうち今回のロールにないものだけが消える
- MCPサーバーのenvに含まれる `secret_ref:...` は書き込み直前に復号され、プレビューのレスポンスには平文が現れない
- 解決できないシークレット参照があった場合、ファイルを一切書かずに失敗し、`apply_history` に `failed` として記録される
- 適用の成否が `apply_history` に残り、成功時は `projects.last_applied_role_id` / `last_applied_at` が更新される
- 自動テストはすべて一時ディレクトリとインメモリDBを使い、実 `~/.claude` や実 `~/.skillam` に触れない
- `npm test` がリポジトリルートから全件パスする

## 次フェーズ（この計画には含まない）

- **Phase 3b:** ドリフト検知（実ファイルと最終適用ロールの差分表示）、ロール定義のJSONエクスポート/インポート
- **Phase 4:** `apps/web` の React SPA
