# skillam Phase 2a: Project Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the project registry — auto-detection roots CRUD, a filesystem scanner that finds candidate Claude Code projects (`.claude`/`.git` markers) under those roots, and full CRUD for registered/ignored projects — exercised end-to-end with curl against the running server.

**Architecture:** Extends the existing `apps/server` Fastify + better-sqlite3 app from Phase 1 with a new `apps/server/src/projects/` module, following the exact repository/routes/types layering established in Phase 1's `roles/` module. Two new tables (`auto_detect_roots`, `projects`) are added via a new migration file. A pure, dependency-free filesystem scanner (`scanner.ts`) walks registered roots and returns candidate paths not already known to the `projects` table; nothing about a candidate is persisted until the user explicitly registers or ignores it.

**Tech Stack:** Same as Phase 1 — Node.js 24, TypeScript (NodeNext ESM), Fastify 5, better-sqlite3, Vitest.

**Depends on:** Phase 1 (Foundation) — branches from `feature/phase-1-foundation`. **Out of scope for this phase:** catalog scanning of Skills/MCP/Agents (Phase 2c), secrets/Keychain (Phase 2b), role↔project assignment and apply/diff (Phase 3), web UI (Phase 4). Per the design doc (`docs/superpowers/specs/2026-08-04-skillam-design.md` §5, §9), the `project_roles`/`apply_history` tables and the `last_applied_role_id`/`last_applied_at` columns on `projects` are explicitly deferred to Phase 3 and are NOT created by this plan.

---

## File Structure

```
apps/server/src/
├── app.ts                              # Modify: register projectsRoutes
├── db/migrations/
│   └── 0002_projects.sql               # Create: auto_detect_roots + projects tables
└── projects/
    ├── auto-detect-roots.types.ts
    ├── auto-detect-roots.repository.ts
    ├── auto-detect-roots.repository.test.ts
    ├── projects.types.ts
    ├── projects.repository.ts
    ├── projects.repository.test.ts
    ├── scanner.ts                      # Pure fs-walking logic, no DB/HTTP
    ├── scanner.test.ts
    ├── projects.routes.ts              # Fastify plugin: roots + scan + projects CRUD
    └── projects.routes.test.ts
```

---

### Task 1: Migration — `auto_detect_roots` and `projects` tables

**Files:**
- Create: `apps/server/src/db/migrations/0002_projects.sql`
- Test: `apps/server/src/db/migrate.test.ts` (modify — extend the existing table-list assertion)

- [ ] **Step 1: Write the failing test**

Modify `apps/server/src/db/migrate.test.ts` — read the current file first (it has a `runMigrations` describe block with two tests). Change the `arrayContaining([...])` list in the `'creates the roles and role_* tables'` test to also expect the two new tables:

```ts
// apps/server/src/db/migrate.test.ts (modify the existing 'creates the roles and role_* tables' test)
  it('creates the roles, role_*, and project tables', () => {
    const db = openDb(':memory:')

    runMigrations(db)

    const names = tableNames(db)
    expect(names).toEqual(
      expect.arrayContaining([
        'roles',
        'role_skills',
        'role_mcp_servers',
        'role_agents',
        'role_permissions',
        'auto_detect_roots',
        'projects'
      ])
    )
    db.close()
  })
```

(Rename the test description as shown; keep the second `'is idempotent when run twice'` test unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/db/migrate.test.ts`
Expected: FAIL — the new tables aren't in `sqlite_master` yet, so `arrayContaining` fails

- [ ] **Step 3: Write the migration**

```sql
-- apps/server/src/db/migrations/0002_projects.sql
CREATE TABLE auto_detect_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  auto_detected INTEGER NOT NULL DEFAULT 0,
  excluded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/db/migrate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm run test -w @skillam/server`
Expected: PASS (all 61 existing tests plus this file's 2)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db/migrations/0002_projects.sql apps/server/src/db/migrate.test.ts
git commit -m "feat(server): add auto_detect_roots and projects tables"
```

---

### Task 2: AutoDetectRootsRepository

**Files:**
- Create: `apps/server/src/projects/auto-detect-roots.types.ts`
- Create: `apps/server/src/projects/auto-detect-roots.repository.ts`
- Test: `apps/server/src/projects/auto-detect-roots.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/projects/auto-detect-roots.repository.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { AutoDetectRootsRepository } from './auto-detect-roots.repository.js'

describe('AutoDetectRootsRepository', () => {
  let db: Database.Database
  let repo: AutoDetectRootsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new AutoDetectRootsRepository(db)
  })

  it('returns an empty list when no roots are registered', () => {
    expect(repo.list()).toEqual([])
  })

  it('creates and lists a root', () => {
    const created = repo.create({ path: '/Users/example/Develop' })

    expect(created.id).toBeGreaterThan(0)
    expect(created.path).toBe('/Users/example/Develop')

    expect(repo.list()).toEqual([created])
  })

  it('lists roots ordered by path', () => {
    repo.create({ path: '/z/root' })
    repo.create({ path: '/a/root' })

    const roots = repo.list()

    expect(roots.map((r) => r.path)).toEqual(['/a/root', '/z/root'])
  })

  it('deletes a root', () => {
    const created = repo.create({ path: '/Users/example/Develop' })

    const deleted = repo.delete(created.id)

    expect(deleted).toBe(true)
    expect(repo.list()).toEqual([])
  })

  it('returns false when deleting a missing root', () => {
    expect(repo.delete(999)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/projects/auto-detect-roots.repository.test.ts`
Expected: FAIL — `Cannot find module './auto-detect-roots.repository.js'`

- [ ] **Step 3: Write the types and repository**

```ts
// apps/server/src/projects/auto-detect-roots.types.ts
export interface AutoDetectRoot {
  id: number
  path: string
  createdAt: string
}

export interface CreateAutoDetectRootInput {
  path: string
}
```

```ts
// apps/server/src/projects/auto-detect-roots.repository.ts
import type Database from 'better-sqlite3'
import type { AutoDetectRoot, CreateAutoDetectRootInput } from './auto-detect-roots.types.js'

interface AutoDetectRootRow {
  id: number
  path: string
  created_at: string
}

function toAutoDetectRoot(row: AutoDetectRootRow): AutoDetectRoot {
  return {
    id: row.id,
    path: row.path,
    createdAt: row.created_at
  }
}

export class AutoDetectRootsRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateAutoDetectRootInput): AutoDetectRoot {
    const row = this.db
      .prepare('INSERT INTO auto_detect_roots (path) VALUES (?) RETURNING *')
      .get(input.path) as AutoDetectRootRow
    return toAutoDetectRoot(row)
  }

  list(): AutoDetectRoot[] {
    const rows = this.db
      .prepare('SELECT * FROM auto_detect_roots ORDER BY path')
      .all() as AutoDetectRootRow[]
    return rows.map(toAutoDetectRoot)
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM auto_detect_roots WHERE id = ?').run(id)
    return result.changes > 0
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/projects/auto-detect-roots.repository.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/projects/auto-detect-roots.types.ts apps/server/src/projects/auto-detect-roots.repository.ts apps/server/src/projects/auto-detect-roots.repository.test.ts
git commit -m "feat(server): add auto-detect roots repository"
```

---

### Task 3: ProjectsRepository

**Files:**
- Create: `apps/server/src/projects/projects.types.ts`
- Create: `apps/server/src/projects/projects.repository.ts`
- Test: `apps/server/src/projects/projects.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/projects/projects.repository.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { ProjectsRepository } from './projects.repository.js'

describe('ProjectsRepository', () => {
  let db: Database.Database
  let repo: ProjectsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new ProjectsRepository(db)
  })

  it('creates a project with defaults', () => {
    const created = repo.create({ path: '/Users/example/Develop/foo', name: 'foo' })

    expect(created).toMatchObject({
      path: '/Users/example/Develop/foo',
      name: 'foo',
      autoDetected: false,
      excluded: false
    })
  })

  it('creates a project with autoDetected and excluded set', () => {
    const created = repo.create({
      path: '/Users/example/Develop/bar',
      name: 'bar',
      autoDetected: true,
      excluded: true
    })

    expect(created.autoDetected).toBe(true)
    expect(created.excluded).toBe(true)
  })

  it('lists projects ordered by path', () => {
    repo.create({ path: '/z/proj', name: 'z' })
    repo.create({ path: '/a/proj', name: 'a' })

    expect(repo.list().map((p) => p.path)).toEqual(['/a/proj', '/z/proj'])
  })

  it('gets a project by id', () => {
    const created = repo.create({ path: '/Users/example/Develop/foo', name: 'foo' })

    expect(repo.getById(created.id)).toEqual(created)
  })

  it('returns undefined for a missing project', () => {
    expect(repo.getById(999)).toBeUndefined()
  })

  it('lists all registered paths', () => {
    repo.create({ path: '/a/proj', name: 'a' })
    repo.create({ path: '/b/proj', name: 'b', excluded: true })

    expect(repo.listPaths()).toEqual(new Set(['/a/proj', '/b/proj']))
  })

  it('updates a project name and excluded flag', () => {
    const created = repo.create({ path: '/Users/example/Develop/foo', name: 'foo' })

    const updated = repo.update(created.id, { name: 'renamed', excluded: true })

    expect(updated?.name).toBe('renamed')
    expect(updated?.excluded).toBe(true)
    expect(updated?.path).toBe('/Users/example/Develop/foo')
  })

  it('returns undefined when updating a missing project', () => {
    expect(repo.update(999, { name: 'x' })).toBeUndefined()
  })

  it('deletes a project', () => {
    const created = repo.create({ path: '/Users/example/Develop/foo', name: 'foo' })

    expect(repo.delete(created.id)).toBe(true)
    expect(repo.getById(created.id)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/projects/projects.repository.test.ts`
Expected: FAIL — `Cannot find module './projects.repository.js'`

- [ ] **Step 3: Write the types and repository**

```ts
// apps/server/src/projects/projects.types.ts
export interface Project {
  id: number
  path: string
  name: string
  autoDetected: boolean
  excluded: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  path: string
  name: string
  autoDetected?: boolean
  excluded?: boolean
}

export interface UpdateProjectInput {
  name?: string
  excluded?: boolean
}
```

```ts
// apps/server/src/projects/projects.repository.ts
import type Database from 'better-sqlite3'
import type { CreateProjectInput, Project, UpdateProjectInput } from './projects.types.js'

interface ProjectRow {
  id: number
  path: string
  name: string
  auto_detected: number
  excluded: number
  created_at: string
  updated_at: string
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    autoDetected: row.auto_detected === 1,
    excluded: row.excluded === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class ProjectsRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateProjectInput): Project {
    const row = this.db
      .prepare(
        `INSERT INTO projects (path, name, auto_detected, excluded)
         VALUES (@path, @name, @autoDetected, @excluded)
         RETURNING *`
      )
      .get({
        path: input.path,
        name: input.name,
        autoDetected: input.autoDetected ? 1 : 0,
        excluded: input.excluded ? 1 : 0
      }) as ProjectRow
    return toProject(row)
  }

  list(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY path').all() as ProjectRow[]
    return rows.map(toProject)
  }

  getById(id: number): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | ProjectRow
      | undefined
    return row ? toProject(row) : undefined
  }

  listPaths(): Set<string> {
    const rows = this.db.prepare('SELECT path FROM projects').all() as { path: string }[]
    return new Set(rows.map((row) => row.path))
  }

  update(id: number, input: UpdateProjectInput): Project | undefined {
    const existing = this.getById(id)
    if (!existing) {
      return undefined
    }
    const row = this.db
      .prepare(
        `UPDATE projects
         SET name = @name, excluded = @excluded, updated_at = datetime('now')
         WHERE id = @id
         RETURNING *`
      )
      .get({
        id,
        name: input.name ?? existing.name,
        excluded: (input.excluded ?? existing.excluded) ? 1 : 0
      }) as ProjectRow
    return toProject(row)
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    return result.changes > 0
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/projects/projects.repository.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/projects/projects.types.ts apps/server/src/projects/projects.repository.ts apps/server/src/projects/projects.repository.test.ts
git commit -m "feat(server): add projects repository"
```

---

### Task 4: Scanner (pure filesystem walk, no DB/HTTP)

**Files:**
- Create: `apps/server/src/projects/scanner.ts`
- Test: `apps/server/src/projects/scanner.test.ts`

- [ ] **Step 1: Write the failing test**

This test builds a real temporary directory tree (no mocking of `fs`) to exercise the real walking logic.

```ts
// apps/server/src/projects/scanner.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanForCandidates } from './scanner.js'

describe('scanForCandidates', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-scanner-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function makeDir(...segments: string[]): string {
    const dir = path.join(root, ...segments)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  it('finds a directory with a .git marker', () => {
    const projectDir = makeDir('project-a')
    fs.mkdirSync(path.join(projectDir, '.git'))

    const candidates = scanForCandidates([root], new Set())

    expect(candidates).toEqual([{ path: projectDir, name: 'project-a' }])
  })

  it('finds a directory with a .claude marker', () => {
    const projectDir = makeDir('project-b')
    fs.mkdirSync(path.join(projectDir, '.claude'))

    const candidates = scanForCandidates([root], new Set())

    expect(candidates).toEqual([{ path: projectDir, name: 'project-b' }])
  })

  it('finds nested projects several directories deep', () => {
    const nested = makeDir('workspace', 'nested', 'project-c')
    fs.mkdirSync(path.join(nested, '.git'))

    const candidates = scanForCandidates([root], new Set())

    expect(candidates).toEqual([{ path: nested, name: 'project-c' }])
  })

  it('does not recurse into node_modules', () => {
    const trap = makeDir('node_modules', 'some-package')
    fs.mkdirSync(path.join(trap, '.git'))
    const realProject = makeDir('project-d')
    fs.mkdirSync(path.join(realProject, '.git'))

    const candidates = scanForCandidates([root], new Set())

    expect(candidates).toEqual([{ path: realProject, name: 'project-d' }])
  })

  it('does not recurse further once a project marker is found', () => {
    const outer = makeDir('outer')
    fs.mkdirSync(path.join(outer, '.git'))
    fs.mkdirSync(path.join(outer, 'inner'))
    fs.mkdirSync(path.join(outer, 'inner', '.git'))

    const candidates = scanForCandidates([root], new Set())

    expect(candidates).toEqual([{ path: outer, name: 'outer' }])
  })

  it('excludes paths already known', () => {
    const projectDir = makeDir('project-e')
    fs.mkdirSync(path.join(projectDir, '.git'))

    const candidates = scanForCandidates([root], new Set([projectDir]))

    expect(candidates).toEqual([])
  })

  it('returns an empty array when nothing matches', () => {
    makeDir('just-a-folder')

    expect(scanForCandidates([root], new Set())).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/projects/scanner.test.ts`
Expected: FAIL — `Cannot find module './scanner.js'`

- [ ] **Step 3: Write the scanner**

```ts
// apps/server/src/projects/scanner.ts
import fs from 'node:fs'
import path from 'node:path'

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.turbo'
])

export interface ScanCandidate {
  path: string
  name: string
}

function hasProjectMarker(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.claude')) || fs.existsSync(path.join(dir, '.git'))
}

export function scanForCandidates(
  roots: string[],
  knownPaths: Set<string>,
  maxDepth = 6
): ScanCandidate[] {
  const candidates: ScanCandidate[] = []
  const seen = new Set<string>()

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) {
      return
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    if (hasProjectMarker(dir)) {
      if (!knownPaths.has(dir) && !seen.has(dir)) {
        seen.add(dir)
        candidates.push({ path: dir, name: path.basename(dir) })
      }
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIR_NAMES.has(entry.name)) {
        continue
      }
      walk(path.join(dir, entry.name), depth + 1)
    }
  }

  for (const root of roots) {
    walk(root, 0)
  }

  return candidates
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/projects/scanner.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/projects/scanner.ts apps/server/src/projects/scanner.test.ts
git commit -m "feat(server): add project auto-detection scanner"
```

---

### Task 5: `/auto-detect-roots` routes + wire into `app.ts`

**Files:**
- Create: `apps/server/src/projects/projects.routes.ts` (auto-detect-roots endpoints only in this task)
- Test: `apps/server/src/projects/projects.routes.test.ts` (auto-detect-roots tests only in this task)
- Modify: `apps/server/src/app.ts` (register `projectsRoutes`)

**Important:** Before editing, read the actual current `apps/server/src/app.ts` — it should match the version shown below exactly (Phase 1 left it in this state), but confirm rather than assume, since this file may have continued to evolve.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/projects/projects.routes.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'

describe('projects routes', () => {
  let db: Database.Database
  let app: FastifyInstance

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db)
  })

  describe('auto-detect roots', () => {
    it('creates a root via POST /auto-detect-roots', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auto-detect-roots',
        payload: { path: '/Users/example/Develop' }
      })

      expect(response.statusCode).toBe(201)
      expect(response.json()).toMatchObject({ path: '/Users/example/Develop' })
    })

    it('rejects POST /auto-detect-roots without a path', async () => {
      const response = await app.inject({ method: 'POST', url: '/auto-detect-roots', payload: {} })

      expect(response.statusCode).toBe(400)
    })

    it('rejects POST /auto-detect-roots with no body', async () => {
      const response = await app.inject({ method: 'POST', url: '/auto-detect-roots' })

      expect(response.statusCode).toBe(400)
    })

    it('rejects a duplicate root path', async () => {
      await app.inject({
        method: 'POST',
        url: '/auto-detect-roots',
        payload: { path: '/Users/example/Develop' }
      })

      const response = await app.inject({
        method: 'POST',
        url: '/auto-detect-roots',
        payload: { path: '/Users/example/Develop' }
      })

      expect(response.statusCode).toBe(400)
    })

    it('lists roots via GET /auto-detect-roots', async () => {
      await app.inject({ method: 'POST', url: '/auto-detect-roots', payload: { path: '/a' } })
      await app.inject({ method: 'POST', url: '/auto-detect-roots', payload: { path: '/b' } })

      const response = await app.inject({ method: 'GET', url: '/auto-detect-roots' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toHaveLength(2)
    })

    it('deletes a root via DELETE /auto-detect-roots/:id', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/auto-detect-roots',
        payload: { path: '/Users/example/Develop' }
      })
      const { id } = created.json()

      const response = await app.inject({ method: 'DELETE', url: `/auto-detect-roots/${id}` })

      expect(response.statusCode).toBe(204)
      const listResponse = await app.inject({ method: 'GET', url: '/auto-detect-roots' })
      expect(listResponse.json()).toEqual([])
    })

    it('returns 404 deleting a missing root', async () => {
      const response = await app.inject({ method: 'DELETE', url: '/auto-detect-roots/999' })

      expect(response.statusCode).toBe(404)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @skillam/server -- src/projects/projects.routes.test.ts`
Expected: FAIL — `Cannot find module './projects.routes.js'` (and `buildApp` doesn't register these routes yet)

- [ ] **Step 3: Write the routes plugin**

```ts
// apps/server/src/projects/projects.routes.ts
import type { FastifyPluginAsync } from 'fastify'
import { AutoDetectRootsRepository } from './auto-detect-roots.repository.js'
import { ProjectsRepository } from './projects.repository.js'

export interface ProjectsRouteDeps {
  autoDetectRoots: AutoDetectRootsRepository
  projects: ProjectsRepository
}

function hasBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null
}

export const projectsRoutes: FastifyPluginAsync<ProjectsRouteDeps> = async (app, deps) => {
  app.post<{ Body: { path: string } }>('/auto-detect-roots', async (request, reply) => {
    if (!hasBody(request.body)) {
      return reply.status(400).send({ error: 'request body is required' })
    }
    const { path: rootPath } = request.body
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      return reply.status(400).send({ error: 'path is required' })
    }
    const root = deps.autoDetectRoots.create({ path: rootPath })
    return reply.status(201).send(root)
  })

  app.get('/auto-detect-roots', async () => {
    return deps.autoDetectRoots.list()
  })

  app.delete<{ Params: { id: string } }>('/auto-detect-roots/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.autoDetectRoots.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'auto-detect root not found' })
    }
    return reply.status(204).send()
  })
}
```

- [ ] **Step 4: Wire into `app.ts`**

```ts
// apps/server/src/app.ts (replace full file)
import Fastify, { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { RolesRepository } from './roles/roles.repository.js'
import { rolesRoutes } from './roles/roles.routes.js'
import { RoleSkillsRepository } from './roles/role-skills.repository.js'
import { RoleMcpServersRepository } from './roles/role-mcp-servers.repository.js'
import { RoleAgentsRepository } from './roles/role-agents.repository.js'
import { RolePermissionsRepository } from './roles/role-permissions.repository.js'
import { AutoDetectRootsRepository } from './projects/auto-detect-roots.repository.js'
import { ProjectsRepository } from './projects/projects.repository.js'
import { projectsRoutes } from './projects/projects.routes.js'

export function buildApp(db: Database.Database): FastifyInstance {
  const app = Fastify({ logger: false })

  app.setErrorHandler((error, _request, reply) => {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
      return reply.status(400).send({ error: 'invalid request: violates a database constraint' })
    }
    const statusCode = (error as { statusCode?: unknown }).statusCode
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const message = (error as { message?: unknown }).message
      return reply.status(statusCode).send({ error: typeof message === 'string' ? message : 'bad request' })
    }
    return reply.status(500).send({ error: 'internal server error' })
  })

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

  app.register(projectsRoutes, {
    autoDetectRoots: new AutoDetectRootsRepository(db),
    projects: new ProjectsRepository(db)
  })

  return app
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests, including the 7 new ones)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/projects/projects.routes.ts apps/server/src/projects/projects.routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add auto-detect-roots http routes"
```

---

### Task 6: `GET /projects/scan`

**Files:**
- Modify: `apps/server/src/projects/projects.routes.ts` (add scan route)
- Modify: `apps/server/src/projects/projects.routes.test.ts` (append scan tests)

- [ ] **Step 1: Append the failing tests**

Add this nested `describe` inside the existing `describe('projects routes', ...)` block in `apps/server/src/projects/projects.routes.test.ts`, alongside the existing `describe('auto-detect roots', ...)` block:

```ts
  describe('scan', () => {
    it('returns an empty array when no roots are registered', async () => {
      const response = await app.inject({ method: 'GET', url: '/projects/scan' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([])
    })

    it('finds candidates under a registered root and excludes already-known paths', async () => {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const path = await import('node:path')

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-scan-route-test-'))
      const projectA = path.join(root, 'project-a')
      const projectB = path.join(root, 'project-b')
      fs.mkdirSync(path.join(projectA, '.git'), { recursive: true })
      fs.mkdirSync(path.join(projectB, '.claude'), { recursive: true })

      try {
        await app.inject({ method: 'POST', url: '/auto-detect-roots', payload: { path: root } })
        await app.inject({
          method: 'POST',
          url: '/projects',
          payload: { path: projectA, name: 'project-a', autoDetected: true }
        })

        const response = await app.inject({ method: 'GET', url: '/projects/scan' })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual([{ path: projectB, name: 'project-b' }])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @skillam/server -- src/projects/projects.routes.test.ts`
Expected: FAIL — `GET /projects/scan` returns 404 (route not registered)

- [ ] **Step 3: Add the scan route**

Modify `apps/server/src/projects/projects.routes.ts` — add the import and the route:

```ts
// apps/server/src/projects/projects.routes.ts (add this import near the top)
import { scanForCandidates } from './scanner.js'
```

```ts
// apps/server/src/projects/projects.routes.ts (add inside the plugin body, after the auto-detect-roots routes)
  app.get('/projects/scan', async () => {
    const roots = deps.autoDetectRoots.list().map((root) => root.path)
    const knownPaths = deps.projects.listPaths()
    return scanForCandidates(roots, knownPaths)
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @skillam/server -- src/projects/projects.routes.test.ts`
Expected: the `'returns an empty array when no roots are registered'` scan test PASSES. The `'finds candidates under a registered root and excludes already-known paths'` scan test is expected to FAIL at this point — it depends on `POST /projects`, which doesn't exist until Task 7. Confirm the failure is specifically a 404 on that `POST /projects` call (an extra unexpected candidate in the result), not some other bug in the scan route. This test will fully pass once Task 7 lands.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/projects/projects.routes.ts apps/server/src/projects/projects.routes.test.ts
git commit -m "feat(server): add GET /projects/scan"
```

---

### Task 7: Projects CRUD routes

**Files:**
- Modify: `apps/server/src/projects/projects.routes.ts` (add projects CRUD routes)
- Modify: `apps/server/src/projects/projects.routes.test.ts` (append projects CRUD tests)

- [ ] **Step 1: Append the failing tests**

Add this nested `describe` inside the existing `describe('projects routes', ...)` block in `apps/server/src/projects/projects.routes.test.ts`:

```ts
  describe('projects CRUD', () => {
    it('registers a project via POST /projects when the path exists on disk', async () => {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const path = await import('node:path')
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-project-crud-test-'))

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/projects',
          payload: { path: dir, name: 'my-project' }
        })

        expect(response.statusCode).toBe(201)
        expect(response.json()).toMatchObject({
          path: dir,
          name: 'my-project',
          autoDetected: false,
          excluded: false
        })
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    it('rejects POST /projects when the path does not exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/definitely/does/not/exist/anywhere', name: 'ghost' }
      })

      expect(response.statusCode).toBe(400)
    })

    it('rejects POST /projects without a name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/tmp' }
      })

      expect(response.statusCode).toBe(400)
    })

    it('rejects POST /projects when autoDetected is not a boolean', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/tmp', name: 'x', autoDetected: 'yes' }
      })

      expect(response.statusCode).toBe(400)
    })

    it('lists projects via GET /projects', async () => {
      await app.inject({ method: 'POST', url: '/projects', payload: { path: '/tmp', name: 'tmp' } })

      const response = await app.inject({ method: 'GET', url: '/projects' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toHaveLength(1)
    })

    it('gets a single project via GET /projects/:id', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/tmp', name: 'tmp' }
      })
      const { id } = created.json()

      const response = await app.inject({ method: 'GET', url: `/projects/${id}` })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ id, name: 'tmp' })
    })

    it('returns 404 for GET /projects/:id when missing', async () => {
      const response = await app.inject({ method: 'GET', url: '/projects/999' })

      expect(response.statusCode).toBe(404)
    })

    it('updates a project via PUT /projects/:id', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/tmp', name: 'tmp' }
      })
      const { id } = created.json()

      const response = await app.inject({
        method: 'PUT',
        url: `/projects/${id}`,
        payload: { name: 'renamed', excluded: true }
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ id, name: 'renamed', excluded: true })
    })

    it('returns 404 for PUT /projects/:id when missing', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/projects/999',
        payload: { name: 'x' }
      })

      expect(response.statusCode).toBe(404)
    })

    it('deletes a project via DELETE /projects/:id', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/tmp', name: 'tmp' }
      })
      const { id } = created.json()

      const response = await app.inject({ method: 'DELETE', url: `/projects/${id}` })

      expect(response.statusCode).toBe(204)
      const getResponse = await app.inject({ method: 'GET', url: `/projects/${id}` })
      expect(getResponse.statusCode).toBe(404)
    })

    it('returns 404 for DELETE /projects/:id when missing', async () => {
      const response = await app.inject({ method: 'DELETE', url: '/projects/999' })

      expect(response.statusCode).toBe(404)
    })
  })
```

Note: `/tmp` is used as a "path that exists" fixture across several tests in this block since it's a real directory on every machine this runs on (macOS/Linux CI) — this is fine for route-level HTTP tests that don't care about the path's contents, only that `fs.existsSync`/`isDirectory()` succeed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @skillam/server -- src/projects/projects.routes.test.ts`
Expected: FAIL — all `/projects` routes return 404 (not registered yet)

- [ ] **Step 3: Add the projects CRUD routes**

Modify `apps/server/src/projects/projects.routes.ts` — add the import and the routes:

```ts
// apps/server/src/projects/projects.routes.ts (add these imports near the top)
import fs from 'node:fs'
```

```ts
// apps/server/src/projects/projects.routes.ts (add inside the plugin body, after the scan route)
  app.post<{
    Body: { path: string; name: string; autoDetected?: boolean; excluded?: boolean }
  }>('/projects', async (request, reply) => {
    if (!hasBody(request.body)) {
      return reply.status(400).send({ error: 'request body is required' })
    }
    const { path: projectPath, name, autoDetected, excluded } = request.body
    if (typeof projectPath !== 'string' || projectPath.trim() === '') {
      return reply.status(400).send({ error: 'path is required' })
    }
    if (typeof name !== 'string' || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' })
    }
    if (autoDetected !== undefined && typeof autoDetected !== 'boolean') {
      return reply.status(400).send({ error: 'autoDetected must be a boolean' })
    }
    if (excluded !== undefined && typeof excluded !== 'boolean') {
      return reply.status(400).send({ error: 'excluded must be a boolean' })
    }
    if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
      return reply.status(400).send({ error: 'path does not exist or is not a directory' })
    }
    const project = deps.projects.create({ path: projectPath, name, autoDetected, excluded })
    return reply.status(201).send(project)
  })

  app.get('/projects', async () => {
    return deps.projects.list()
  })

  app.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const project = deps.projects.getById(id)
    if (!project) {
      return reply.status(404).send({ error: 'project not found' })
    }
    return project
  })

  app.put<{ Params: { id: string }; Body: { name?: string; excluded?: boolean } }>(
    '/projects/:id',
    async (request, reply) => {
      if (!hasBody(request.body)) {
        return reply.status(400).send({ error: 'request body is required' })
      }
      const id = Number(request.params.id)
      const { name, excluded } = request.body
      if (name !== undefined && typeof name !== 'string') {
        return reply.status(400).send({ error: 'name must be a string' })
      }
      if (excluded !== undefined && typeof excluded !== 'boolean') {
        return reply.status(400).send({ error: 'excluded must be a boolean' })
      }
      const project = deps.projects.update(id, { name, excluded })
      if (!project) {
        return reply.status(404).send({ error: 'project not found' })
      }
      return project
    }
  )

  app.delete<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.projects.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'project not found' })
    }
    return reply.status(204).send()
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @skillam/server -- src/projects/projects.routes.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full suite**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests, no regressions)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/projects/projects.routes.ts apps/server/src/projects/projects.routes.test.ts
git commit -m "feat(server): add projects CRUD http routes"
```

---

### Task 8: Manual end-to-end verification

**Files:** None (verification only).

- [ ] **Step 1: Start the server against a scratch DB**

```bash
SKILLAM_DB_PATH=/tmp/skillam-phase2a-verify/skillam.db npm run dev -w @skillam/server &> /tmp/skillam-phase2a-verify.log &
```

Wait for readiness (poll `/health`), same pattern as Phase 1's Task 12.

- [ ] **Step 2: Create a real temp project tree to scan**

```bash
mkdir -p /tmp/skillam-phase2a-scanroot/existing-project/.git
mkdir -p /tmp/skillam-phase2a-scanroot/new-project/.claude
```

- [ ] **Step 3: Walk through the full curl sequence**

```bash
# Register an auto-detect root
curl -s -X POST http://127.0.0.1:4317/auto-detect-roots \
  -H 'content-type: application/json' \
  -d '{"path":"/tmp/skillam-phase2a-scanroot"}'
# Expected: 201, JSON with id and the path

# Scan — both project dirs should show up as candidates
curl -s http://127.0.0.1:4317/projects/scan
# Expected: array with 2 entries: existing-project and new-project

# Register one of the candidates
curl -s -X POST http://127.0.0.1:4317/projects \
  -H 'content-type: application/json' \
  -d '{"path":"/tmp/skillam-phase2a-scanroot/existing-project","name":"existing-project","autoDetected":true}'
# Expected: 201, autoDetected: true, excluded: false

# Scan again — the registered one should be gone, only new-project remains
curl -s http://127.0.0.1:4317/projects/scan
# Expected: array with only new-project

# Ignore the remaining candidate
curl -s -X POST http://127.0.0.1:4317/projects \
  -H 'content-type: application/json' \
  -d '{"path":"/tmp/skillam-phase2a-scanroot/new-project","name":"new-project","autoDetected":true,"excluded":true}'
# Expected: 201, excluded: true

# Scan a third time — should now be empty (both paths are known)
curl -s http://127.0.0.1:4317/projects/scan
# Expected: []

# List all projects — both should be present
curl -s http://127.0.0.1:4317/projects
# Expected: array of 2 projects, one excluded:false, one excluded:true

# Manually register a project that's outside any scan root
mkdir -p /tmp/skillam-phase2a-scanroot/manual-project
curl -s -X POST http://127.0.0.1:4317/projects \
  -H 'content-type: application/json' \
  -d '{"path":"/tmp/skillam-phase2a-scanroot/manual-project","name":"manual-project"}'
# Expected: 201, autoDetected: false, excluded: false

# Delete one project
curl -s -X DELETE http://127.0.0.1:4317/projects/1 -o /dev/null -w '%{http_code}\n'
# Expected: 204

curl -s http://127.0.0.1:4317/projects
# Expected: array now missing the deleted project
```

- [ ] **Step 4: Stop the server and clean up**

```bash
lsof -ti:4317 -sTCP:LISTEN | xargs -r kill
rm -rf /tmp/skillam-phase2a-scanroot /tmp/skillam-phase2a-verify
```

Confirm `~/.skillam/` was not touched (this verification used `SKILLAM_DB_PATH` throughout).

- [ ] **Step 5: Run the full test suite one final time**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests)

- [ ] **Step 6: No commit for this task** (verification only, nothing to commit)

---

## Phase 2a Definition of Done

- `auto_detect_roots` and `projects` tables exist and are migrated alongside Phase 1's schema.
- Full CRUD for auto-detect roots and projects works via HTTP.
- `GET /projects/scan` correctly finds `.claude`/`.git`-marked directories under registered roots, skips `node_modules` and similar directories, doesn't recurse into already-found projects, and excludes paths already present in the `projects` table (whether registered or explicitly ignored).
- All tests pass via `npm test` from the repo root.
- Manual curl walkthrough (Task 8) confirms the full detect → register/ignore → re-scan loop works end-to-end against a running server.

## Next Sub-Phases (not detailed here)

- **Phase 2b:** Secrets encryption via macOS Keychain (master key generation/storage, AES-256-GCM value encryption, `secrets` table).
- **Phase 2c:** Catalog scanning (Skills/MCP servers/Agents discovery from `~/.claude/*`, plugin caches, and registered projects' `.claude/`/`.mcp.json`) — depends on both 2a (registered project paths) and 2b (secret extraction for MCP server env vars).
