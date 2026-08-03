# skillam Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the skillam monorepo and build a fully tested Roles CRUD API (roles + their skills/MCP servers/agents/permissions sub-resources) that can be exercised end-to-end with `curl` against a running local server.

**Architecture:** npm workspaces monorepo with a single `apps/server` package for now (an `apps/web` package is added in a later phase). The server is a Fastify app backed by a local SQLite database (`better-sqlite3`) stored at `~/.skillam/skillam.db` (overridable via `SKILLAM_DB_PATH` for tests). A small hand-rolled migration runner applies versioned `.sql` files on startup. Each resource (roles, role_skills, role_mcp_servers, role_agents, role_permissions) has a repository class (SQL access) and is wired into HTTP routes via a Fastify plugin.

**Tech Stack:** Node.js 24, TypeScript (NodeNext ESM), Fastify 5, better-sqlite3, Vitest, npm workspaces.

**Out of scope for this phase** (see `docs/superpowers/specs/2026-08-04-skillam-design.md` sections 6–13, covered by later phases): catalog scanning, project registry, secrets encryption/keychain, apply/diff engine, export/import, web UI.

---

## File Structure

```
skillam/
├── package.json                  # root workspaces config
├── tsconfig.base.json
├── .gitignore
└── apps/
    └── server/
        ├── package.json
        ├── tsconfig.json
        ├── vitest.config.ts
        └── src/
            ├── app.ts             # buildApp(db) Fastify factory
            ├── app.test.ts
            ├── index.ts           # process entrypoint (opens db, migrates, listens)
            ├── db/
            │   ├── client.ts      # openDb/resolveDbPath
            │   ├── client.test.ts
            │   ├── migrate.ts     # runMigrations
            │   ├── migrate.test.ts
            │   └── migrations/
            │       └── 0001_init.sql
            └── roles/
                ├── roles.types.ts
                ├── roles.repository.ts
                ├── roles.repository.test.ts
                ├── role-skills.types.ts
                ├── role-skills.repository.ts
                ├── role-skills.repository.test.ts
                ├── role-mcp-servers.types.ts
                ├── role-mcp-servers.repository.ts
                ├── role-mcp-servers.repository.test.ts
                ├── role-agents.types.ts
                ├── role-agents.repository.ts
                ├── role-agents.repository.test.ts
                ├── role-permissions.types.ts
                ├── role-permissions.repository.ts
                ├── role-permissions.repository.test.ts
                ├── roles.routes.ts
                └── roles.routes.test.ts
```

---

### Task 1: Monorepo root scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "skillam",
  "private": true,
  "workspaces": [
    "apps/*"
  ],
  "scripts": {
    "dev": "npm run dev --workspace @skillam/server",
    "test": "npm run test --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.base.json .gitignore
git commit -m "chore: scaffold skillam monorepo root"
```

---

### Task 2: Scaffold `apps/server` package

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/vitest.config.ts`

- [ ] **Step 1: Create `apps/server/package.json`**

```json
{
  "name": "@skillam/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json && mkdir -p dist/db/migrations && cp src/db/migrations/*.sql dist/db/migrations/",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node'
  }
})
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: installs `fastify`, `better-sqlite3`, `vitest`, `tsx`, `typescript`, `@types/*` into the workspace; creates/updates root `package-lock.json`. `better-sqlite3` compiles a native binary during install — this should succeed given Xcode Command Line Tools and Python 3 are present.

- [ ] **Step 5: Commit**

```bash
git add apps/server/package.json apps/server/tsconfig.json apps/server/vitest.config.ts package-lock.json
git commit -m "chore: scaffold @skillam/server package"
```

---

### Task 3: SQLite DB client

**Files:**
- Create: `apps/server/src/db/client.ts`
- Test: `apps/server/src/db/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/db/client.test.ts
import { describe, expect, it } from 'vitest'
import { openDb, resolveDbPath } from './client.js'

describe('openDb', () => {
  it('opens an in-memory database with foreign keys enabled', () => {
    const db = openDb(':memory:')

    const fkEnabled = db.pragma('foreign_keys', { simple: true })

    expect(fkEnabled).toBe(1)
    db.close()
  })
})

describe('resolveDbPath', () => {
  it('honors SKILLAM_DB_PATH when set', () => {
    process.env.SKILLAM_DB_PATH = '/tmp/skillam-test.db'

    expect(resolveDbPath()).toBe('/tmp/skillam-test.db')

    delete process.env.SKILLAM_DB_PATH
  })

  it('defaults to ~/.skillam/skillam.db', () => {
    delete process.env.SKILLAM_DB_PATH

    expect(resolveDbPath().endsWith('.skillam/skillam.db')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/db/client.test.ts`
Expected: FAIL — `Cannot find module './client.js'` (file doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/db/client.ts
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function resolveDbPath(): string {
  const override = process.env.SKILLAM_DB_PATH
  if (override) {
    return override
  }
  return path.join(os.homedir(), '.skillam', 'skillam.db')
}

export function openDb(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/db/client.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/client.ts apps/server/src/db/client.test.ts
git commit -m "feat(server): add sqlite db client"
```

---

### Task 4: Migration runner + initial schema

**Files:**
- Create: `apps/server/src/db/migrate.ts`
- Create: `apps/server/src/db/migrations/0001_init.sql`
- Test: `apps/server/src/db/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/db/migrate.test.ts
import { describe, expect, it } from 'vitest'
import { openDb } from './client.js'
import { runMigrations } from './migrate.js'

function tableNames(db: ReturnType<typeof openDb>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (row) => row.name
  )
}

describe('runMigrations', () => {
  it('creates the roles and role_* tables', () => {
    const db = openDb(':memory:')

    runMigrations(db)

    const names = tableNames(db)
    expect(names).toEqual(
      expect.arrayContaining([
        'roles',
        'role_skills',
        'role_mcp_servers',
        'role_agents',
        'role_permissions'
      ])
    )
    db.close()
  })

  it('is idempotent when run twice', () => {
    const db = openDb(':memory:')

    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()

    db.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/db/migrate.test.ts`
Expected: FAIL — `Cannot find module './migrate.js'`

- [ ] **Step 3: Write the migration SQL**

```sql
-- apps/server/src/db/migrations/0001_init.sql
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE role_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  skill_source TEXT NOT NULL CHECK (skill_source IN ('user', 'project-local', 'plugin')),
  skill_path TEXT NOT NULL
);

CREATE TABLE role_mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  command_json TEXT NOT NULL,
  env_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE role_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  markdown_body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('reference', 'authored'))
);

CREATE TABLE role_permissions (
  role_id INTEGER PRIMARY KEY REFERENCES roles(id) ON DELETE CASCADE,
  permissions_json TEXT NOT NULL DEFAULT '{}'
);
```

- [ ] **Step 4: Write the migration runner**

```ts
// apps/server/src/db/migrate.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((row) => row.name)
  )

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  const insertMigration = db.prepare('INSERT INTO _migrations (name) VALUES (?)')

  for (const file of files) {
    if (applied.has(file)) {
      continue
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    db.exec(sql)
    insertMigration.run(file)
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/db/migrate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db/migrate.ts apps/server/src/db/migrate.test.ts apps/server/src/db/migrations/0001_init.sql
git commit -m "feat(server): add migration runner and initial schema"
```

---

### Task 5: Fastify app factory + health check

**Files:**
- Create: `apps/server/src/app.ts`
- Test: `apps/server/src/app.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/app.test.ts
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

describe('GET /health', () => {
  it('returns status ok', async () => {
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/app.test.ts`
Expected: FAIL — `Cannot find module './app.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/app.ts
import Fastify, { FastifyInstance } from 'fastify'

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    return { status: 'ok' }
  })

  return app
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/app.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/app.test.ts
git commit -m "feat(server): add fastify app factory with health check"
```

---

### Task 6: Roles repository

**Files:**
- Create: `apps/server/src/roles/roles.types.ts`
- Create: `apps/server/src/roles/roles.repository.ts`
- Test: `apps/server/src/roles/roles.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/roles/roles.repository.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from './roles.repository.js'

describe('RolesRepository', () => {
  let db: Database.Database
  let repo: RolesRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new RolesRepository(db)
  })

  it('creates and retrieves a role', () => {
    const created = repo.create({ name: 'frontend-dev', description: 'Frontend development role' })

    expect(created.id).toBeGreaterThan(0)
    expect(created.name).toBe('frontend-dev')

    const fetched = repo.getById(created.id)
    expect(fetched).toEqual(created)
  })

  it('lists roles ordered by name', () => {
    repo.create({ name: 'zeta' })
    repo.create({ name: 'alpha' })

    const roles = repo.list()

    expect(roles.map((r) => r.name)).toEqual(['alpha', 'zeta'])
  })

  it('updates a role', () => {
    const created = repo.create({ name: 'original' })

    const updated = repo.update(created.id, { description: 'new description' })

    expect(updated?.name).toBe('original')
    expect(updated?.description).toBe('new description')
  })

  it('returns undefined when updating a missing role', () => {
    expect(repo.update(999, { name: 'x' })).toBeUndefined()
  })

  it('deletes a role', () => {
    const created = repo.create({ name: 'to-delete' })

    const deleted = repo.delete(created.id)

    expect(deleted).toBe(true)
    expect(repo.getById(created.id)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/roles/roles.repository.test.ts`
Expected: FAIL — `Cannot find module './roles.repository.js'`

- [ ] **Step 3: Write the types**

```ts
// apps/server/src/roles/roles.types.ts
export interface Role {
  id: number
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface CreateRoleInput {
  name: string
  description?: string
}

export interface UpdateRoleInput {
  name?: string
  description?: string
}
```

- [ ] **Step 4: Write the repository**

```ts
// apps/server/src/roles/roles.repository.ts
import type Database from 'better-sqlite3'
import type { CreateRoleInput, Role, UpdateRoleInput } from './roles.types.js'

interface RoleRow {
  id: number
  name: string
  description: string
  created_at: string
  updated_at: string
}

function toRole(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class RolesRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateRoleInput): Role {
    const row = this.db
      .prepare('INSERT INTO roles (name, description) VALUES (@name, @description) RETURNING *')
      .get({ name: input.name, description: input.description ?? '' }) as RoleRow
    return toRole(row)
  }

  list(): Role[] {
    const rows = this.db.prepare('SELECT * FROM roles ORDER BY name').all() as RoleRow[]
    return rows.map(toRole)
  }

  getById(id: number): Role | undefined {
    const row = this.db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as RoleRow | undefined
    return row ? toRole(row) : undefined
  }

  update(id: number, input: UpdateRoleInput): Role | undefined {
    const existing = this.getById(id)
    if (!existing) {
      return undefined
    }
    const row = this.db
      .prepare(
        `UPDATE roles
         SET name = @name, description = @description, updated_at = datetime('now')
         WHERE id = @id
         RETURNING *`
      )
      .get({
        id,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description
      }) as RoleRow
    return toRole(row)
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM roles WHERE id = ?').run(id)
    return result.changes > 0
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/roles/roles.repository.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/roles/roles.types.ts apps/server/src/roles/roles.repository.ts apps/server/src/roles/roles.repository.test.ts
git commit -m "feat(server): add roles repository"
```

---

### Task 7: Roles HTTP routes (core CRUD)

**Files:**
- Create: `apps/server/src/roles/roles.routes.ts`
- Test: `apps/server/src/roles/roles.routes.test.ts`
- Modify: `apps/server/src/app.ts` (replace full file — wires `RolesRepository` and `rolesRoutes` in, so `buildApp` now takes a `db` argument)
- Modify: `apps/server/src/app.test.ts` (replace full file — update the health check to build the app with an in-memory db)

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/roles/roles.routes.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'

describe('roles routes', () => {
  let db: Database.Database
  let app: FastifyInstance

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db)
  })

  it('creates a role via POST /roles', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/roles',
      payload: { name: 'frontend-dev', description: 'Frontend role' }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ name: 'frontend-dev', description: 'Frontend role' })
  })

  it('rejects POST /roles without a name', async () => {
    const response = await app.inject({ method: 'POST', url: '/roles', payload: {} })

    expect(response.statusCode).toBe(400)
  })

  it('lists roles via GET /roles', async () => {
    await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-b' } })

    const response = await app.inject({ method: 'GET', url: '/roles' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(2)
  })

  it('gets a single role via GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'GET', url: `/roles/${id}` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id, name: 'role-a' })
  })

  it('returns 404 for GET /roles/:id when missing', async () => {
    const response = await app.inject({ method: 'GET', url: '/roles/999' })

    expect(response.statusCode).toBe(404)
  })

  it('updates a role via PUT /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}`,
      payload: { description: 'updated' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id, description: 'updated' })
  })

  it('deletes a role via DELETE /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'DELETE', url: `/roles/${id}` })

    expect(response.statusCode).toBe(204)
    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.statusCode).toBe(404)
  })
})
```

```ts
// apps/server/src/app.test.ts (replace full file)
import { describe, expect, it } from 'vitest'
import { openDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { buildApp } from './app.js'

describe('GET /health', () => {
  it('returns status ok', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @skillam/server`
Expected: FAIL — `app.test.ts` fails because `buildApp` doesn't accept an argument yet; `roles.routes.test.ts` fails because `roles.routes.ts` doesn't exist

- [ ] **Step 3: Write the routes plugin**

```ts
// apps/server/src/roles/roles.routes.ts
import type { FastifyPluginAsync } from 'fastify'
import { RolesRepository } from './roles.repository.js'

export interface RolesRouteDeps {
  roles: RolesRepository
}

export const rolesRoutes: FastifyPluginAsync<RolesRouteDeps> = async (app, deps) => {
  app.post<{ Body: { name: string; description?: string } }>('/roles', async (request, reply) => {
    const { name, description } = request.body
    if (!name || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' })
    }
    const role = deps.roles.create({ name, description })
    return reply.status(201).send(role)
  })

  app.get('/roles', async () => {
    return deps.roles.list()
  })

  app.get<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const role = deps.roles.getById(id)
    if (!role) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return role
  })

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/roles/:id',
    async (request, reply) => {
      const id = Number(request.params.id)
      const role = deps.roles.update(id, request.body)
      if (!role) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return role
    }
  )

  app.delete<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.roles.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return reply.status(204).send()
  })
}
```

- [ ] **Step 4: Wire it into the app**

```ts
// apps/server/src/app.ts (replace full file)
import Fastify, { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { RolesRepository } from './roles/roles.repository.js'
import { rolesRoutes } from './roles/roles.routes.js'

export function buildApp(db: Database.Database): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    return { status: 'ok' }
  })

  app.register(rolesRoutes, {
    roles: new RolesRepository(db)
  })

  return app
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @skillam/server`
Expected: PASS (all `app.test.ts` and `roles.routes.test.ts` tests)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/app.test.ts apps/server/src/roles/roles.routes.ts apps/server/src/roles/roles.routes.test.ts
git commit -m "feat(server): add roles CRUD http routes"
```

---

### Task 8: role_skills repository + `/roles/:id/skills`

**Files:**
- Create: `apps/server/src/roles/role-skills.types.ts`
- Create: `apps/server/src/roles/role-skills.repository.ts`
- Test: `apps/server/src/roles/role-skills.repository.test.ts`
- Modify: `apps/server/src/roles/roles.routes.ts` (replace full file — add `skills` dep, `PUT /roles/:id/skills`, include `skills` in `GET /roles/:id`)
- Modify: `apps/server/src/app.ts` (replace full file — pass `RoleSkillsRepository` into `rolesRoutes`)
- Modify: `apps/server/src/roles/roles.routes.test.ts` (append new test cases)

- [ ] **Step 1: Write the failing repository test**

```ts
// apps/server/src/roles/role-skills.repository.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from './roles.repository.js'
import { RoleSkillsRepository } from './role-skills.repository.js'

describe('RoleSkillsRepository', () => {
  let db: Database.Database
  let roleId: number
  let repo: RoleSkillsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    roleId = new RolesRepository(db).create({ name: 'test-role' }).id
    repo = new RoleSkillsRepository(db)
  })

  it('returns an empty list for a role with no skills', () => {
    expect(repo.listForRole(roleId)).toEqual([])
  })

  it('replaces the skill list for a role', () => {
    repo.replaceForRole(roleId, [{ skillSource: 'user', skillPath: '~/.claude/skills/brainstorming' }])

    const result = repo.replaceForRole(roleId, [
      { skillSource: 'plugin', skillPath: 'everything-claude-code/docs' }
    ])

    expect(result).toEqual([
      { id: expect.any(Number), skillSource: 'plugin', skillPath: 'everything-claude-code/docs' }
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/roles/role-skills.repository.test.ts`
Expected: FAIL — `Cannot find module './role-skills.repository.js'`

- [ ] **Step 3: Write the types and repository**

```ts
// apps/server/src/roles/role-skills.types.ts
export interface RoleSkill {
  id: number
  skillSource: 'user' | 'project-local' | 'plugin'
  skillPath: string
}

export interface RoleSkillInput {
  skillSource: 'user' | 'project-local' | 'plugin'
  skillPath: string
}
```

```ts
// apps/server/src/roles/role-skills.repository.ts
import type Database from 'better-sqlite3'
import type { RoleSkill, RoleSkillInput } from './role-skills.types.js'

interface RoleSkillRow {
  id: number
  skill_source: string
  skill_path: string
}

function toRoleSkill(row: RoleSkillRow): RoleSkill {
  return {
    id: row.id,
    skillSource: row.skill_source as RoleSkill['skillSource'],
    skillPath: row.skill_path
  }
}

export class RoleSkillsRepository {
  constructor(private readonly db: Database.Database) {}

  listForRole(roleId: number): RoleSkill[] {
    const rows = this.db
      .prepare('SELECT id, skill_source, skill_path FROM role_skills WHERE role_id = ? ORDER BY id')
      .all(roleId) as RoleSkillRow[]
    return rows.map(toRoleSkill)
  }

  replaceForRole(roleId: number, items: RoleSkillInput[]): RoleSkill[] {
    const replace = this.db.transaction((entries: RoleSkillInput[]) => {
      this.db.prepare('DELETE FROM role_skills WHERE role_id = ?').run(roleId)
      const insert = this.db.prepare(
        'INSERT INTO role_skills (role_id, skill_source, skill_path) VALUES (?, ?, ?)'
      )
      for (const entry of entries) {
        insert.run(roleId, entry.skillSource, entry.skillPath)
      }
    })
    replace(items)
    return this.listForRole(roleId)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/roles/role-skills.repository.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Append route tests**

Add these `it()` blocks inside the existing `describe('roles routes', ...)` block in `apps/server/src/roles/roles.routes.test.ts`:

```ts
  it('replaces skills via PUT /roles/:id/skills and reflects them in GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: { skills: [{ skillSource: 'user', skillPath: '~/.claude/skills/brainstorming' }] }
    })
    expect(putResponse.statusCode).toBe(200)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().skills).toEqual([
      { id: expect.any(Number), skillSource: 'user', skillPath: '~/.claude/skills/brainstorming' }
    ])
  })

  it('returns 404 for PUT /roles/:id/skills when role is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/roles/999/skills',
      payload: { skills: [] }
    })

    expect(response.statusCode).toBe(404)
  })
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm run test -w @skillam/server -- src/roles/roles.routes.test.ts`
Expected: FAIL — `PUT /roles/:id/skills` returns 404 (route not registered) and `GET /roles/:id` has no `skills` field

- [ ] **Step 7: Update routes and app wiring**

```ts
// apps/server/src/roles/roles.routes.ts (replace full file)
import type { FastifyPluginAsync } from 'fastify'
import { RolesRepository } from './roles.repository.js'
import { RoleSkillsRepository } from './role-skills.repository.js'
import type { RoleSkillInput } from './role-skills.types.js'

export interface RolesRouteDeps {
  roles: RolesRepository
  skills: RoleSkillsRepository
}

export const rolesRoutes: FastifyPluginAsync<RolesRouteDeps> = async (app, deps) => {
  app.post<{ Body: { name: string; description?: string } }>('/roles', async (request, reply) => {
    const { name, description } = request.body
    if (!name || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' })
    }
    const role = deps.roles.create({ name, description })
    return reply.status(201).send(role)
  })

  app.get('/roles', async () => {
    return deps.roles.list()
  })

  app.get<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const role = deps.roles.getById(id)
    if (!role) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return {
      ...role,
      skills: deps.skills.listForRole(id)
    }
  })

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/roles/:id',
    async (request, reply) => {
      const id = Number(request.params.id)
      const role = deps.roles.update(id, request.body)
      if (!role) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return role
    }
  )

  app.delete<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.roles.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return reply.status(204).send()
  })

  app.put<{ Params: { id: string }; Body: { skills: RoleSkillInput[] } }>(
    '/roles/:id/skills',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.skills.replaceForRole(id, request.body.skills)
    }
  )
}
```

```ts
// apps/server/src/app.ts (replace full file)
import Fastify, { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { RolesRepository } from './roles/roles.repository.js'
import { RoleSkillsRepository } from './roles/role-skills.repository.js'
import { rolesRoutes } from './roles/roles.routes.js'

export function buildApp(db: Database.Database): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    return { status: 'ok' }
  })

  app.register(rolesRoutes, {
    roles: new RolesRepository(db),
    skills: new RoleSkillsRepository(db)
  })

  return app
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests)

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/roles/role-skills.types.ts apps/server/src/roles/role-skills.repository.ts apps/server/src/roles/role-skills.repository.test.ts apps/server/src/roles/roles.routes.ts apps/server/src/roles/roles.routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add role skills sub-resource"
```

---

### Task 9: role_mcp_servers repository + `/roles/:id/mcp-servers`

**Files:**
- Create: `apps/server/src/roles/role-mcp-servers.types.ts`
- Create: `apps/server/src/roles/role-mcp-servers.repository.ts`
- Test: `apps/server/src/roles/role-mcp-servers.repository.test.ts`
- Modify: `apps/server/src/roles/roles.routes.ts` (replace full file)
- Modify: `apps/server/src/app.ts` (replace full file)
- Modify: `apps/server/src/roles/roles.routes.test.ts` (append new test cases)

- [ ] **Step 1: Write the failing repository test**

```ts
// apps/server/src/roles/role-mcp-servers.repository.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from './roles.repository.js'
import { RoleMcpServersRepository } from './role-mcp-servers.repository.js'

describe('RoleMcpServersRepository', () => {
  let db: Database.Database
  let roleId: number
  let repo: RoleMcpServersRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    roleId = new RolesRepository(db).create({ name: 'test-role' }).id
    repo = new RoleMcpServersRepository(db)
  })

  it('returns an empty list for a role with no mcp servers', () => {
    expect(repo.listForRole(roleId)).toEqual([])
  })

  it('replaces the mcp server list for a role', () => {
    const result = repo.replaceForRole(roleId, [
      {
        name: 'filesystem',
        command: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
        env: { ALLOWED_DIR: '${SKILLAM_PROJECT_ROOT}' }
      }
    ])

    expect(result).toEqual([
      {
        id: expect.any(Number),
        name: 'filesystem',
        command: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
        env: { ALLOWED_DIR: '${SKILLAM_PROJECT_ROOT}' }
      }
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/roles/role-mcp-servers.repository.test.ts`
Expected: FAIL — `Cannot find module './role-mcp-servers.repository.js'`

- [ ] **Step 3: Write the types and repository**

```ts
// apps/server/src/roles/role-mcp-servers.types.ts
export interface RoleMcpServer {
  id: number
  name: string
  command: unknown
  env: Record<string, string>
}

export interface RoleMcpServerInput {
  name: string
  command: unknown
  env?: Record<string, string>
}
```

```ts
// apps/server/src/roles/role-mcp-servers.repository.ts
import type Database from 'better-sqlite3'
import type { RoleMcpServer, RoleMcpServerInput } from './role-mcp-servers.types.js'

interface RoleMcpServerRow {
  id: number
  name: string
  command_json: string
  env_json: string
}

function toRoleMcpServer(row: RoleMcpServerRow): RoleMcpServer {
  return {
    id: row.id,
    name: row.name,
    command: JSON.parse(row.command_json),
    env: JSON.parse(row.env_json)
  }
}

export class RoleMcpServersRepository {
  constructor(private readonly db: Database.Database) {}

  listForRole(roleId: number): RoleMcpServer[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, command_json, env_json FROM role_mcp_servers WHERE role_id = ? ORDER BY id'
      )
      .all(roleId) as RoleMcpServerRow[]
    return rows.map(toRoleMcpServer)
  }

  replaceForRole(roleId: number, items: RoleMcpServerInput[]): RoleMcpServer[] {
    const replace = this.db.transaction((entries: RoleMcpServerInput[]) => {
      this.db.prepare('DELETE FROM role_mcp_servers WHERE role_id = ?').run(roleId)
      const insert = this.db.prepare(
        'INSERT INTO role_mcp_servers (role_id, name, command_json, env_json) VALUES (?, ?, ?, ?)'
      )
      for (const entry of entries) {
        insert.run(roleId, entry.name, JSON.stringify(entry.command), JSON.stringify(entry.env ?? {}))
      }
    })
    replace(items)
    return this.listForRole(roleId)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/roles/role-mcp-servers.repository.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Append route tests**

Add these `it()` blocks inside the existing `describe('roles routes', ...)` block in `apps/server/src/roles/roles.routes.test.ts`:

```ts
  it('replaces mcp servers via PUT /roles/:id/mcp-servers and reflects them in GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/mcp-servers`,
      payload: {
        servers: [{ name: 'filesystem', command: { command: 'npx', args: [] }, env: {} }]
      }
    })
    expect(putResponse.statusCode).toBe(200)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().mcpServers).toEqual([
      { id: expect.any(Number), name: 'filesystem', command: { command: 'npx', args: [] }, env: {} }
    ])
  })

  it('returns 404 for PUT /roles/:id/mcp-servers when role is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/roles/999/mcp-servers',
      payload: { servers: [] }
    })

    expect(response.statusCode).toBe(404)
  })
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm run test -w @skillam/server -- src/roles/roles.routes.test.ts`
Expected: FAIL — `PUT /roles/:id/mcp-servers` returns 404 and `GET /roles/:id` has no `mcpServers` field

- [ ] **Step 7: Update routes and app wiring**

```ts
// apps/server/src/roles/roles.routes.ts (replace full file)
import type { FastifyPluginAsync } from 'fastify'
import { RolesRepository } from './roles.repository.js'
import { RoleSkillsRepository } from './role-skills.repository.js'
import { RoleMcpServersRepository } from './role-mcp-servers.repository.js'
import type { RoleSkillInput } from './role-skills.types.js'
import type { RoleMcpServerInput } from './role-mcp-servers.types.js'

export interface RolesRouteDeps {
  roles: RolesRepository
  skills: RoleSkillsRepository
  mcpServers: RoleMcpServersRepository
}

export const rolesRoutes: FastifyPluginAsync<RolesRouteDeps> = async (app, deps) => {
  app.post<{ Body: { name: string; description?: string } }>('/roles', async (request, reply) => {
    const { name, description } = request.body
    if (!name || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' })
    }
    const role = deps.roles.create({ name, description })
    return reply.status(201).send(role)
  })

  app.get('/roles', async () => {
    return deps.roles.list()
  })

  app.get<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const role = deps.roles.getById(id)
    if (!role) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return {
      ...role,
      skills: deps.skills.listForRole(id),
      mcpServers: deps.mcpServers.listForRole(id)
    }
  })

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/roles/:id',
    async (request, reply) => {
      const id = Number(request.params.id)
      const role = deps.roles.update(id, request.body)
      if (!role) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return role
    }
  )

  app.delete<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.roles.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return reply.status(204).send()
  })

  app.put<{ Params: { id: string }; Body: { skills: RoleSkillInput[] } }>(
    '/roles/:id/skills',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.skills.replaceForRole(id, request.body.skills)
    }
  )

  app.put<{ Params: { id: string }; Body: { servers: RoleMcpServerInput[] } }>(
    '/roles/:id/mcp-servers',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.mcpServers.replaceForRole(id, request.body.servers)
    }
  )
}
```

```ts
// apps/server/src/app.ts (replace full file)
import Fastify, { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { RolesRepository } from './roles/roles.repository.js'
import { RoleSkillsRepository } from './roles/role-skills.repository.js'
import { RoleMcpServersRepository } from './roles/role-mcp-servers.repository.js'
import { rolesRoutes } from './roles/roles.routes.js'

export function buildApp(db: Database.Database): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    return { status: 'ok' }
  })

  app.register(rolesRoutes, {
    roles: new RolesRepository(db),
    skills: new RoleSkillsRepository(db),
    mcpServers: new RoleMcpServersRepository(db)
  })

  return app
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests)

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/roles/role-mcp-servers.types.ts apps/server/src/roles/role-mcp-servers.repository.ts apps/server/src/roles/role-mcp-servers.repository.test.ts apps/server/src/roles/roles.routes.ts apps/server/src/roles/roles.routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add role mcp servers sub-resource"
```

---

### Task 10: role_agents repository + `/roles/:id/agents`

**Files:**
- Create: `apps/server/src/roles/role-agents.types.ts`
- Create: `apps/server/src/roles/role-agents.repository.ts`
- Test: `apps/server/src/roles/role-agents.repository.test.ts`
- Modify: `apps/server/src/roles/roles.routes.ts` (replace full file)
- Modify: `apps/server/src/app.ts` (replace full file)
- Modify: `apps/server/src/roles/roles.routes.test.ts` (append new test cases)

- [ ] **Step 1: Write the failing repository test**

```ts
// apps/server/src/roles/role-agents.repository.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from './roles.repository.js'
import { RoleAgentsRepository } from './role-agents.repository.js'

describe('RoleAgentsRepository', () => {
  let db: Database.Database
  let roleId: number
  let repo: RoleAgentsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    roleId = new RolesRepository(db).create({ name: 'test-role' }).id
    repo = new RoleAgentsRepository(db)
  })

  it('returns an empty list for a role with no agents', () => {
    expect(repo.listForRole(roleId)).toEqual([])
  })

  it('replaces the agent list for a role', () => {
    const result = repo.replaceForRole(roleId, [
      { name: 'code-reviewer', markdownBody: '# Code Reviewer\n...', source: 'reference' }
    ])

    expect(result).toEqual([
      {
        id: expect.any(Number),
        name: 'code-reviewer',
        markdownBody: '# Code Reviewer\n...',
        source: 'reference'
      }
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/roles/role-agents.repository.test.ts`
Expected: FAIL — `Cannot find module './role-agents.repository.js'`

- [ ] **Step 3: Write the types and repository**

```ts
// apps/server/src/roles/role-agents.types.ts
export interface RoleAgent {
  id: number
  name: string
  markdownBody: string
  source: 'reference' | 'authored'
}

export interface RoleAgentInput {
  name: string
  markdownBody: string
  source: 'reference' | 'authored'
}
```

```ts
// apps/server/src/roles/role-agents.repository.ts
import type Database from 'better-sqlite3'
import type { RoleAgent, RoleAgentInput } from './role-agents.types.js'

interface RoleAgentRow {
  id: number
  name: string
  markdown_body: string
  source: string
}

function toRoleAgent(row: RoleAgentRow): RoleAgent {
  return {
    id: row.id,
    name: row.name,
    markdownBody: row.markdown_body,
    source: row.source as RoleAgent['source']
  }
}

export class RoleAgentsRepository {
  constructor(private readonly db: Database.Database) {}

  listForRole(roleId: number): RoleAgent[] {
    const rows = this.db
      .prepare('SELECT id, name, markdown_body, source FROM role_agents WHERE role_id = ? ORDER BY id')
      .all(roleId) as RoleAgentRow[]
    return rows.map(toRoleAgent)
  }

  replaceForRole(roleId: number, items: RoleAgentInput[]): RoleAgent[] {
    const replace = this.db.transaction((entries: RoleAgentInput[]) => {
      this.db.prepare('DELETE FROM role_agents WHERE role_id = ?').run(roleId)
      const insert = this.db.prepare(
        'INSERT INTO role_agents (role_id, name, markdown_body, source) VALUES (?, ?, ?, ?)'
      )
      for (const entry of entries) {
        insert.run(roleId, entry.name, entry.markdownBody, entry.source)
      }
    })
    replace(items)
    return this.listForRole(roleId)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/roles/role-agents.repository.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Append route tests**

Add these `it()` blocks inside the existing `describe('roles routes', ...)` block in `apps/server/src/roles/roles.routes.test.ts`:

```ts
  it('replaces agents via PUT /roles/:id/agents and reflects them in GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/agents`,
      payload: { agents: [{ name: 'code-reviewer', markdownBody: '# Reviewer', source: 'authored' }] }
    })
    expect(putResponse.statusCode).toBe(200)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().agents).toEqual([
      { id: expect.any(Number), name: 'code-reviewer', markdownBody: '# Reviewer', source: 'authored' }
    ])
  })

  it('returns 404 for PUT /roles/:id/agents when role is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/roles/999/agents',
      payload: { agents: [] }
    })

    expect(response.statusCode).toBe(404)
  })
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm run test -w @skillam/server -- src/roles/roles.routes.test.ts`
Expected: FAIL — `PUT /roles/:id/agents` returns 404 and `GET /roles/:id` has no `agents` field

- [ ] **Step 7: Update routes and app wiring**

```ts
// apps/server/src/roles/roles.routes.ts (replace full file)
import type { FastifyPluginAsync } from 'fastify'
import { RolesRepository } from './roles.repository.js'
import { RoleSkillsRepository } from './role-skills.repository.js'
import { RoleMcpServersRepository } from './role-mcp-servers.repository.js'
import { RoleAgentsRepository } from './role-agents.repository.js'
import type { RoleSkillInput } from './role-skills.types.js'
import type { RoleMcpServerInput } from './role-mcp-servers.types.js'
import type { RoleAgentInput } from './role-agents.types.js'

export interface RolesRouteDeps {
  roles: RolesRepository
  skills: RoleSkillsRepository
  mcpServers: RoleMcpServersRepository
  agents: RoleAgentsRepository
}

export const rolesRoutes: FastifyPluginAsync<RolesRouteDeps> = async (app, deps) => {
  app.post<{ Body: { name: string; description?: string } }>('/roles', async (request, reply) => {
    const { name, description } = request.body
    if (!name || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' })
    }
    const role = deps.roles.create({ name, description })
    return reply.status(201).send(role)
  })

  app.get('/roles', async () => {
    return deps.roles.list()
  })

  app.get<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const role = deps.roles.getById(id)
    if (!role) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return {
      ...role,
      skills: deps.skills.listForRole(id),
      mcpServers: deps.mcpServers.listForRole(id),
      agents: deps.agents.listForRole(id)
    }
  })

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/roles/:id',
    async (request, reply) => {
      const id = Number(request.params.id)
      const role = deps.roles.update(id, request.body)
      if (!role) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return role
    }
  )

  app.delete<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.roles.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return reply.status(204).send()
  })

  app.put<{ Params: { id: string }; Body: { skills: RoleSkillInput[] } }>(
    '/roles/:id/skills',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.skills.replaceForRole(id, request.body.skills)
    }
  )

  app.put<{ Params: { id: string }; Body: { servers: RoleMcpServerInput[] } }>(
    '/roles/:id/mcp-servers',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.mcpServers.replaceForRole(id, request.body.servers)
    }
  )

  app.put<{ Params: { id: string }; Body: { agents: RoleAgentInput[] } }>(
    '/roles/:id/agents',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.agents.replaceForRole(id, request.body.agents)
    }
  )
}
```

```ts
// apps/server/src/app.ts (replace full file)
import Fastify, { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { RolesRepository } from './roles/roles.repository.js'
import { RoleSkillsRepository } from './roles/role-skills.repository.js'
import { RoleMcpServersRepository } from './roles/role-mcp-servers.repository.js'
import { RoleAgentsRepository } from './roles/role-agents.repository.js'
import { rolesRoutes } from './roles/roles.routes.js'

export function buildApp(db: Database.Database): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    return { status: 'ok' }
  })

  app.register(rolesRoutes, {
    roles: new RolesRepository(db),
    skills: new RoleSkillsRepository(db),
    mcpServers: new RoleMcpServersRepository(db),
    agents: new RoleAgentsRepository(db)
  })

  return app
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests)

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/roles/role-agents.types.ts apps/server/src/roles/role-agents.repository.ts apps/server/src/roles/role-agents.repository.test.ts apps/server/src/roles/roles.routes.ts apps/server/src/roles/roles.routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add role agents sub-resource"
```

---

### Task 11: role_permissions repository + `/roles/:id/permissions`

**Files:**
- Create: `apps/server/src/roles/role-permissions.types.ts`
- Create: `apps/server/src/roles/role-permissions.repository.ts`
- Test: `apps/server/src/roles/role-permissions.repository.test.ts`
- Modify: `apps/server/src/roles/roles.routes.ts` (replace full file)
- Modify: `apps/server/src/app.ts` (replace full file)
- Modify: `apps/server/src/roles/roles.routes.test.ts` (append new test cases)

- [ ] **Step 1: Write the failing repository test**

```ts
// apps/server/src/roles/role-permissions.repository.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from './roles.repository.js'
import { RolePermissionsRepository } from './role-permissions.repository.js'

describe('RolePermissionsRepository', () => {
  let db: Database.Database
  let roleId: number
  let repo: RolePermissionsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    roleId = new RolesRepository(db).create({ name: 'test-role' }).id
    repo = new RolePermissionsRepository(db)
  })

  it('returns undefined when no permissions are set', () => {
    expect(repo.getForRole(roleId)).toBeUndefined()
  })

  it('sets and retrieves permissions for a role', () => {
    const set = repo.setForRole(roleId, { permissions: { allow: ['Bash(git *)'], deny: [] } })

    expect(set).toEqual({ roleId, permissions: { allow: ['Bash(git *)'], deny: [] } })
    expect(repo.getForRole(roleId)).toEqual(set)
  })

  it('overwrites permissions on a second call', () => {
    repo.setForRole(roleId, { permissions: { allow: ['Bash(git *)'] } })

    const updated = repo.setForRole(roleId, { permissions: { allow: ['Edit'] } })

    expect(updated.permissions).toEqual({ allow: ['Edit'] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/roles/role-permissions.repository.test.ts`
Expected: FAIL — `Cannot find module './role-permissions.repository.js'`

- [ ] **Step 3: Write the types and repository**

```ts
// apps/server/src/roles/role-permissions.types.ts
export interface RolePermissions {
  roleId: number
  permissions: unknown
}

export interface RolePermissionsInput {
  permissions: unknown
}
```

```ts
// apps/server/src/roles/role-permissions.repository.ts
import type Database from 'better-sqlite3'
import type { RolePermissions, RolePermissionsInput } from './role-permissions.types.js'

interface RolePermissionsRow {
  role_id: number
  permissions_json: string
}

function toRolePermissions(row: RolePermissionsRow): RolePermissions {
  return {
    roleId: row.role_id,
    permissions: JSON.parse(row.permissions_json)
  }
}

export class RolePermissionsRepository {
  constructor(private readonly db: Database.Database) {}

  getForRole(roleId: number): RolePermissions | undefined {
    const row = this.db
      .prepare('SELECT role_id, permissions_json FROM role_permissions WHERE role_id = ?')
      .get(roleId) as RolePermissionsRow | undefined
    return row ? toRolePermissions(row) : undefined
  }

  setForRole(roleId: number, input: RolePermissionsInput): RolePermissions {
    this.db
      .prepare(
        `INSERT INTO role_permissions (role_id, permissions_json)
         VALUES (@roleId, @permissionsJson)
         ON CONFLICT(role_id) DO UPDATE SET permissions_json = excluded.permissions_json`
      )
      .run({ roleId, permissionsJson: JSON.stringify(input.permissions) })
    return this.getForRole(roleId)!
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/roles/role-permissions.repository.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Append route tests**

Add these `it()` blocks inside the existing `describe('roles routes', ...)` block in `apps/server/src/roles/roles.routes.test.ts`:

```ts
  it('sets permissions via PUT /roles/:id/permissions and reflects them in GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/permissions`,
      payload: { permissions: { allow: ['Bash(git *)'] } }
    })
    expect(putResponse.statusCode).toBe(200)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().permissions).toEqual({
      roleId: id,
      permissions: { allow: ['Bash(git *)'] }
    })
  })

  it('returns null permissions in GET /roles/:id when never set', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().permissions).toBeNull()
  })

  it('returns 404 for PUT /roles/:id/permissions when role is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/roles/999/permissions',
      payload: { permissions: {} }
    })

    expect(response.statusCode).toBe(404)
  })
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm run test -w @skillam/server -- src/roles/roles.routes.test.ts`
Expected: FAIL — `PUT /roles/:id/permissions` returns 404 and `GET /roles/:id` has no `permissions` field

- [ ] **Step 7: Update routes and app wiring**

```ts
// apps/server/src/roles/roles.routes.ts (replace full file)
import type { FastifyPluginAsync } from 'fastify'
import { RolesRepository } from './roles.repository.js'
import { RoleSkillsRepository } from './role-skills.repository.js'
import { RoleMcpServersRepository } from './role-mcp-servers.repository.js'
import { RoleAgentsRepository } from './role-agents.repository.js'
import { RolePermissionsRepository } from './role-permissions.repository.js'
import type { RoleSkillInput } from './role-skills.types.js'
import type { RoleMcpServerInput } from './role-mcp-servers.types.js'
import type { RoleAgentInput } from './role-agents.types.js'

export interface RolesRouteDeps {
  roles: RolesRepository
  skills: RoleSkillsRepository
  mcpServers: RoleMcpServersRepository
  agents: RoleAgentsRepository
  permissions: RolePermissionsRepository
}

export const rolesRoutes: FastifyPluginAsync<RolesRouteDeps> = async (app, deps) => {
  app.post<{ Body: { name: string; description?: string } }>('/roles', async (request, reply) => {
    const { name, description } = request.body
    if (!name || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' })
    }
    const role = deps.roles.create({ name, description })
    return reply.status(201).send(role)
  })

  app.get('/roles', async () => {
    return deps.roles.list()
  })

  app.get<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const role = deps.roles.getById(id)
    if (!role) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return {
      ...role,
      skills: deps.skills.listForRole(id),
      mcpServers: deps.mcpServers.listForRole(id),
      agents: deps.agents.listForRole(id),
      permissions: deps.permissions.getForRole(id) ?? null
    }
  })

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/roles/:id',
    async (request, reply) => {
      const id = Number(request.params.id)
      const role = deps.roles.update(id, request.body)
      if (!role) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return role
    }
  )

  app.delete<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.roles.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return reply.status(204).send()
  })

  app.put<{ Params: { id: string }; Body: { skills: RoleSkillInput[] } }>(
    '/roles/:id/skills',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.skills.replaceForRole(id, request.body.skills)
    }
  )

  app.put<{ Params: { id: string }; Body: { servers: RoleMcpServerInput[] } }>(
    '/roles/:id/mcp-servers',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.mcpServers.replaceForRole(id, request.body.servers)
    }
  )

  app.put<{ Params: { id: string }; Body: { agents: RoleAgentInput[] } }>(
    '/roles/:id/agents',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.agents.replaceForRole(id, request.body.agents)
    }
  )

  app.put<{ Params: { id: string }; Body: { permissions: unknown } }>(
    '/roles/:id/permissions',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.permissions.setForRole(id, { permissions: request.body.permissions })
    }
  )
}
```

```ts
// apps/server/src/app.ts (replace full file)
import Fastify, { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { RolesRepository } from './roles/roles.repository.js'
import { RoleSkillsRepository } from './roles/role-skills.repository.js'
import { RoleMcpServersRepository } from './roles/role-mcp-servers.repository.js'
import { RoleAgentsRepository } from './roles/role-agents.repository.js'
import { RolePermissionsRepository } from './roles/role-permissions.repository.js'
import { rolesRoutes } from './roles/roles.routes.js'

export function buildApp(db: Database.Database): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    return { status: 'ok' }
  })

  app.register(rolesRoutes, {
    roles: new RolesRepository(db),
    skills: new RoleSkillsRepository(db),
    mcpServers: new RoleMcpServersRepository(db),
    agents: new RoleAgentsRepository(db),
    permissions: new RolePermissionsRepository(db)
  })

  return app
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests)

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/roles/role-permissions.types.ts apps/server/src/roles/role-permissions.repository.ts apps/server/src/roles/role-permissions.repository.test.ts apps/server/src/roles/roles.routes.ts apps/server/src/roles/roles.routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add role permissions sub-resource"
```

---

### Task 12: Server entrypoint + manual end-to-end verification

**Files:**
- Create: `apps/server/src/index.ts`

- [ ] **Step 1: Write the entrypoint**

```ts
// apps/server/src/index.ts
import { openDb, resolveDbPath } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { buildApp } from './app.js'

const db = openDb(resolveDbPath())
runMigrations(db)

const app = buildApp(db)

app
  .listen({ port: 4317, host: '127.0.0.1' })
  .then((address) => {
    console.log(`skillam server listening at ${address}`)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
```

- [ ] **Step 2: Start the server**

Run: `npm run dev -w @skillam/server`
Expected: console prints `skillam server listening at http://127.0.0.1:4317`, and `~/.skillam/skillam.db` is created

- [ ] **Step 3: Manually verify the full CRUD flow with curl**

In a separate terminal, run each of these in order:

```bash
curl -s http://127.0.0.1:4317/health
# Expected: {"status":"ok"}

curl -s -X POST http://127.0.0.1:4317/roles \
  -H 'content-type: application/json' \
  -d '{"name":"frontend-dev","description":"Frontend development role"}'
# Expected: 201, JSON body with id, name "frontend-dev"

curl -s http://127.0.0.1:4317/roles
# Expected: array containing the created role

curl -s -X PUT http://127.0.0.1:4317/roles/1/skills \
  -H 'content-type: application/json' \
  -d '{"skills":[{"skillSource":"user","skillPath":"~/.claude/skills/brainstorming"}]}'
# Expected: array with the one skill entry

curl -s http://127.0.0.1:4317/roles/1
# Expected: role object including "skills": [...], "mcpServers": [], "agents": [], "permissions": null

curl -s -X DELETE http://127.0.0.1:4317/roles/1 -o /dev/null -w '%{http_code}\n'
# Expected: 204

curl -s http://127.0.0.1:4317/roles/1 -o /dev/null -w '%{http_code}\n'
# Expected: 404
```

- [ ] **Step 4: Stop the dev server**

Stop the `npm run dev` process with `Ctrl+C`.

- [ ] **Step 5: Run the full test suite once more**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests across `db/`, `roles/`, and `app.test.ts`)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "feat(server): add process entrypoint"
```

---

## Phase 1 Definition of Done

- `npm run dev` starts a Fastify server on `127.0.0.1:4317` backed by `~/.skillam/skillam.db`.
- Full CRUD for roles and their skills/MCP servers/agents/permissions sub-resources works via HTTP, verified both by the automated test suite and the manual curl walkthrough in Task 12.
- All tests pass via `npm test` from the repo root.

## Next Phases (not detailed here)

- **Phase 2:** Catalog scanning (skills/MCP servers/agents discovery from `~/.claude/*` and registered projects), project registry (auto-detect + manual register/exclude), secrets encryption via macOS Keychain.
- **Phase 3:** Apply/diff engine (merge-mode file generation, diff preview, apply history, drift detection), export/import.
- **Phase 4:** `apps/web` React SPA consuming the Phase 1–3 APIs.
