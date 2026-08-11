# skillam Phase 2c: Catalog Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover candidate Skills, MCP servers, Agents, and Permissions from the local Claude Code environment (user-level config, plugin caches, and registered projects) and expose them as read-only catalog HTTP endpoints, so a future role editor (Phase 4) can offer them as pickable candidates. MCP server env vars that look like secrets are transparently extracted into Phase 2b's encrypted `secrets` store, never returned as plaintext.

**Architecture:** Four independent, pure scanner modules (`skills-scanner.ts`, `agents-scanner.ts`, `mcp-servers-scanner.ts`, `permissions-scanner.ts`) under a new `apps/server/src/catalog/` directory — each takes plain inputs (root paths, project path lists) and returns plain data, with zero DB/HTTP coupling, matching the pattern already established by Phase 2a's `scanner.ts`. **No new database tables or persisted "catalog" rows** — skills/agents/permissions scans are purely live, computed fresh on every request (same philosophy as Phase 2a's `GET /projects/scan`, which never persists candidates either). The one exception: MCP server scanning has a side effect — any env var value that looks like a real secret (not an empty/placeholder value) gets upserted into the existing `secrets` table (Phase 2b) via `SecretsRepository`, and the returned server definition has that value replaced with `secret_ref:<name>` instead of the plaintext.

**Real-environment research findings this plan is grounded in** (gathered by inspecting this machine's actual `~/.claude/` tree before writing this plan, since the design doc explicitly flagged this as needed):
- **Plugin-provided `skills/`/`agents/` directories are NOT at a fixed depth** under `~/.claude/plugins/cache/`. Observed real depths ranging from `cache/<id>/skills` (2 segments) to `cache/<marketplace>/<plugin>/<version>/skills` (4 segments). A fixed glob pattern (as the design doc's §6 originally sketched) does not work — this plan uses a bounded-depth recursive search instead.
- **Some plugin packages embed OTHER tools' agent configs** (observed real examples: `.codex/agents/`, `.kiro/agents/` inside a plugin's cache directory) alongside genuine Claude Code `agents/`. This plan's scanner skips descending into any directory whose name starts with `.` while walking, which naturally excludes these.
- **`~/.claude.json`** (a large, ~100KB file full of unrelated app state — auth cache, telemetry, onboarding flags, etc.) has a top-level `mcpServers` key. Each entry has a `type` field (`"stdio"` or `"http"`) in this newer format; `"stdio"` entries have `command`/`args`/`env`, `"http"` entries have just a `url`. **This plan reads this file but never writes to it** — catalog scanning is read-only with respect to `~/.claude.json`.
- **Project-level `.mcp.json`** (a separate, smaller file) has the same `mcpServers` shape but entries observed on this machine omit the `type` field entirely (stdio is evidently the implicit default) and may reference `${CLAUDE_PLUGIN_ROOT}`-style variables in `args` — this plan does not attempt to resolve such variables, it just captures the raw JSON as-is.
- **`.claude/settings.json`** can have BOTH a `permissions` block (`{defaultMode, allow: [], deny: []}`) AND separately `enabledPlugins`/`extraKnownMarketplaces` keys (plugin-management metadata, unrelated to permissions). This plan only reads the `permissions` key from `settings.json` — `enabledPlugins`/`extraKnownMarketplaces` are out of scope (they matter for the future "apply" phase, not for cataloging).
- **`~/.claude/agents/*.md`** frontmatter observed: `name`, `description`, `tools` (comma-separated string), `color`, and sometimes a commented-out `hooks` block. This plan captures the raw frontmatter `name`/`description` plus the full markdown body (matching the `role_agents` table's existing `markdown_body` column from Phase 1), and ignores `tools`/`color`/`hooks` (out of scope for a role's agent reference — Phase 1's `role_agents` table has no columns for them).
- **`~/.claude/skills/`** entries can be **symlinks** (observed: a real skill symlinked to an external directory). This plan follows one level of symlink when listing direct children of a known skills root (safe — no recursion, so no cycle risk), matching how a real Claude Code installation actually resolves them.

**Tech Stack:** Same as prior phases — Node.js 24, TypeScript (NodeNext ESM), Fastify 5, better-sqlite3, Vitest.

**Depends on:** Phase 1 (roles, for context — not modified here), Phase 2a (registered `projects` list, read via `ProjectsRepository`), Phase 2b (`secrets` table, read/written via `SecretsRepository`). Branches from `main`, which contains all of the above. **Out of scope for this phase:** writing/applying anything to `.claude/settings.json`/`.mcp.json` (that's Phase 3's "apply" engine), resolving `${CLAUDE_PLUGIN_ROOT}`-style variables, `enabledPlugins` semantics, catalog result caching/persistence, the web UI (Phase 4).

---

## File Structure

```
apps/server/src/catalog/
├── skills-scanner.ts              # Pure: user + plugin + project skill discovery
├── skills-scanner.test.ts
├── agents-scanner.ts              # Pure: user + plugin + project agent discovery
├── agents-scanner.test.ts
├── mcp-servers-scanner.ts         # Pure, read-only: user + project MCP server discovery
├── mcp-servers-scanner.test.ts
├── secret-extraction.ts           # Pure: classify+redact secret-looking env values
├── secret-extraction.test.ts
├── permissions-scanner.ts         # Pure: per-project permissions block discovery
├── permissions-scanner.test.ts
├── catalog.routes.ts              # Fastify plugin: GET /catalog/{skills,agents,mcp-servers,permissions}
└── catalog.routes.test.ts
```

`apps/server/src/app.ts` is modified once (Task 9) to register `catalogRoutes`.

---

### Task 1: Skills scanner

**Files:**
- Create: `apps/server/src/catalog/skills-scanner.ts`
- Test: `apps/server/src/catalog/skills-scanner.test.ts`

- [ ] **Step 1: Write the failing test**

This test builds real temporary directory trees (no `fs` mocking), matching the project's established convention from Phase 2a's scanner tests.

```ts
// apps/server/src/catalog/skills-scanner.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanSkills } from './skills-scanner.js'

describe('scanSkills', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-skills-scanner-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function writeSkill(dir: string, name: string, description: string): void {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody text.\n`
    )
  }

  it('finds a user-level skill directly under the skills root', () => {
    const userSkillsRoot = path.join(root, 'user-skills')
    writeSkill(path.join(userSkillsRoot, 'drawio'), 'drawio', 'Create diagrams')

    const result = scanSkills({ userSkillsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'user',
        name: 'drawio',
        description: 'Create diagrams',
        path: path.join(userSkillsRoot, 'drawio')
      }
    ])
  })

  it('skips a user-level entry that has no SKILL.md', () => {
    const userSkillsRoot = path.join(root, 'user-skills')
    fs.mkdirSync(path.join(userSkillsRoot, 'learned'), { recursive: true })

    const result = scanSkills({ userSkillsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([])
  })

  it('finds a plugin skill at a shallow depth', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    writeSkill(
      path.join(pluginsCacheRoot, 'some-plugin', 'skills', 'my-skill'),
      'my-skill',
      'A shallow plugin skill'
    )

    const result = scanSkills({ userSkillsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'plugin',
        name: 'my-skill',
        description: 'A shallow plugin skill',
        path: path.join(pluginsCacheRoot, 'some-plugin', 'skills', 'my-skill')
      }
    ])
  })

  it('finds a plugin skill nested several directories deep (marketplace/plugin/version/skills)', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    writeSkill(
      path.join(pluginsCacheRoot, 'some-marketplace', 'some-plugin', '1.0.0', 'skills', 'deep-skill'),
      'deep-skill',
      'A deeply nested plugin skill'
    )

    const result = scanSkills({ userSkillsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'plugin',
        name: 'deep-skill',
        description: 'A deeply nested plugin skill',
        path: path.join(
          pluginsCacheRoot,
          'some-marketplace',
          'some-plugin',
          '1.0.0',
          'skills',
          'deep-skill'
        )
      }
    ])
  })

  it('finds a project-local skill', () => {
    const projectPath = path.join(root, 'my-project')
    writeSkill(
      path.join(projectPath, '.claude', 'skills', 'project-skill'),
      'project-skill',
      'A project-local skill'
    )

    const result = scanSkills({
      userSkillsRoot: undefined,
      pluginsCacheRoot: undefined,
      projectPaths: [projectPath]
    })

    expect(result).toEqual([
      {
        source: 'project-local',
        name: 'project-skill',
        description: 'A project-local skill',
        path: path.join(projectPath, '.claude', 'skills', 'project-skill')
      }
    ])
  })

  it('follows a symlinked user-level skill directory', () => {
    const userSkillsRoot = path.join(root, 'user-skills')
    const realSkillDir = path.join(root, 'external-skill-location')
    writeSkill(realSkillDir, 'linked-skill', 'A symlinked skill')
    fs.mkdirSync(userSkillsRoot, { recursive: true })
    fs.symlinkSync(realSkillDir, path.join(userSkillsRoot, 'linked-skill'))

    const result = scanSkills({ userSkillsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'user',
        name: 'linked-skill',
        description: 'A symlinked skill',
        path: path.join(userSkillsRoot, 'linked-skill')
      }
    ])
  })

  it('does not descend into dot-prefixed directories while searching for plugin skills', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    writeSkill(
      path.join(pluginsCacheRoot, 'some-plugin', '.hidden-tool', 'skills', 'not-claude-code'),
      'not-claude-code',
      'Should not be found'
    )

    const result = scanSkills({ userSkillsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result).toEqual([])
  })

  it('returns results for multiple sources combined, each tagged correctly', () => {
    const userSkillsRoot = path.join(root, 'user-skills')
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    const projectPath = path.join(root, 'my-project')
    writeSkill(path.join(userSkillsRoot, 'a'), 'a', 'user skill')
    writeSkill(path.join(pluginsCacheRoot, 'p', 'skills', 'b'), 'b', 'plugin skill')
    writeSkill(path.join(projectPath, '.claude', 'skills', 'c'), 'c', 'project skill')

    const result = scanSkills({ userSkillsRoot, pluginsCacheRoot, projectPaths: [projectPath] })

    expect(result.map((r) => [r.source, r.name]).sort()).toEqual([
      ['plugin', 'b'],
      ['project-local', 'c'],
      ['user', 'a']
    ])
  })

  it('returns an empty array when the roots do not exist', () => {
    const result = scanSkills({
      userSkillsRoot: path.join(root, 'does-not-exist'),
      pluginsCacheRoot: path.join(root, 'also-does-not-exist'),
      projectPaths: [path.join(root, 'no-project-here')]
    })

    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/catalog/skills-scanner.test.ts`
Expected: FAIL — `Cannot find module './skills-scanner.js'`

- [ ] **Step 3: Write the scanner**

```ts
// apps/server/src/catalog/skills-scanner.ts
import fs from 'node:fs'
import path from 'node:path'

export interface SkillCandidate {
  source: 'user' | 'plugin' | 'project-local'
  name: string
  description: string
  path: string
}

interface ScanSkillsInput {
  userSkillsRoot: string | undefined
  pluginsCacheRoot: string | undefined
  projectPaths: string[]
}

const MAX_PLUGIN_SEARCH_DEPTH = 8

function parseFrontmatterField(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))
  return match ? match[1].trim() : undefined
}

function readSkillAt(dir: string, source: SkillCandidate['source']): SkillCandidate | undefined {
  const skillMdPath = path.join(dir, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) {
    return undefined
  }
  const content = fs.readFileSync(skillMdPath, 'utf-8')
  const name = parseFrontmatterField(content, 'name')
  const description = parseFrontmatterField(content, 'description')
  if (!name || !description) {
    return undefined
  }
  return { source, name, description, path: dir }
}

function scanDirectSkillChildren(
  skillsRoot: string,
  source: SkillCandidate['source']
): SkillCandidate[] {
  if (!fs.existsSync(skillsRoot)) {
    return []
  }
  const candidates: SkillCandidate[] = []
  for (const entry of fs.readdirSync(skillsRoot)) {
    const entryPath = path.join(skillsRoot, entry)
    let stat: fs.Stats
    try {
      stat = fs.statSync(entryPath)
    } catch {
      continue
    }
    if (!stat.isDirectory()) {
      continue
    }
    const skill = readSkillAt(entryPath, source)
    if (skill) {
      candidates.push(skill)
    }
  }
  return candidates
}

function findPluginSkillDirs(root: string): string[] {
  const found: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > MAX_PLUGIN_SEARCH_DEPTH) {
      return
    }
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue
      }
      const entryPath = path.join(dir, entry.name)
      if (entry.name === 'skills') {
        found.push(entryPath)
        continue
      }
      walk(entryPath, depth + 1)
    }
  }

  if (fs.existsSync(root)) {
    walk(root, 0)
  }
  return found
}

export function scanSkills(input: ScanSkillsInput): SkillCandidate[] {
  const candidates: SkillCandidate[] = []

  if (input.userSkillsRoot) {
    candidates.push(...scanDirectSkillChildren(input.userSkillsRoot, 'user'))
  }

  if (input.pluginsCacheRoot) {
    for (const skillsDir of findPluginSkillDirs(input.pluginsCacheRoot)) {
      candidates.push(...scanDirectSkillChildren(skillsDir, 'plugin'))
    }
  }

  for (const projectPath of input.projectPaths) {
    const projectSkillsRoot = path.join(projectPath, '.claude', 'skills')
    candidates.push(...scanDirectSkillChildren(projectSkillsRoot, 'project-local'))
  }

  return candidates
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/catalog/skills-scanner.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/catalog/skills-scanner.ts apps/server/src/catalog/skills-scanner.test.ts
git commit -m "feat(server): add skills catalog scanner"
```

If you hit a shell heredoc parsing error when committing, write the commit message to a temp file and use `git commit -F <file>` instead.

---

### Task 2: Agents scanner

**Files:**
- Create: `apps/server/src/catalog/agents-scanner.ts`
- Test: `apps/server/src/catalog/agents-scanner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/catalog/agents-scanner.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanAgents } from './agents-scanner.js'

describe('scanAgents', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-agents-scanner-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function writeAgent(dir: string, filename: string, name: string, description: string): void {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, filename),
      `---\nname: ${name}\ndescription: ${description}\ntools: Read, Write\ncolor: cyan\n---\n\n<role>\nBody text.\n</role>\n`
    )
  }

  it('finds a user-level agent', () => {
    const userAgentsRoot = path.join(root, 'user-agents')
    writeAgent(userAgentsRoot, 'reviewer.md', 'reviewer', 'Reviews code')

    const result = scanAgents({ userAgentsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'user',
        name: 'reviewer',
        description: 'Reviews code',
        markdownBody: fs.readFileSync(path.join(userAgentsRoot, 'reviewer.md'), 'utf-8'),
        path: path.join(userAgentsRoot, 'reviewer.md')
      }
    ])
  })

  it('ignores non-markdown files in the agents root', () => {
    const userAgentsRoot = path.join(root, 'user-agents')
    fs.mkdirSync(userAgentsRoot, { recursive: true })
    fs.writeFileSync(path.join(userAgentsRoot, 'notes.txt'), 'not an agent')

    const result = scanAgents({ userAgentsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([])
  })

  it('finds a plugin agent at a shallow depth', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    writeAgent(path.join(pluginsCacheRoot, 'some-plugin', 'agents'), 'helper.md', 'helper', 'Helps out')

    const result = scanAgents({ userAgentsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'plugin',
        name: 'helper',
        description: 'Helps out',
        markdownBody: fs.readFileSync(
          path.join(pluginsCacheRoot, 'some-plugin', 'agents', 'helper.md'),
          'utf-8'
        ),
        path: path.join(pluginsCacheRoot, 'some-plugin', 'agents', 'helper.md')
      }
    ])
  })

  it('does not descend into dot-prefixed tool directories (e.g. a bundled .codex/agents)', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    writeAgent(
      path.join(pluginsCacheRoot, 'some-plugin', '.codex', 'agents'),
      'codex-agent.md',
      'codex-agent',
      'Not for Claude Code'
    )
    writeAgent(
      path.join(pluginsCacheRoot, 'some-plugin', 'agents'),
      'real-agent.md',
      'real-agent',
      'For Claude Code'
    )

    const result = scanAgents({ userAgentsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result.map((r) => r.name)).toEqual(['real-agent'])
  })

  it('finds a project-local agent', () => {
    const projectPath = path.join(root, 'my-project')
    writeAgent(path.join(projectPath, '.claude', 'agents'), 'local.md', 'local', 'A project agent')

    const result = scanAgents({
      userAgentsRoot: undefined,
      pluginsCacheRoot: undefined,
      projectPaths: [projectPath]
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ source: 'project-local', name: 'local' })
  })

  it('skips a markdown file with no name in frontmatter', () => {
    const userAgentsRoot = path.join(root, 'user-agents')
    fs.mkdirSync(userAgentsRoot, { recursive: true })
    fs.writeFileSync(path.join(userAgentsRoot, 'broken.md'), '---\ndescription: no name here\n---\nbody')

    const result = scanAgents({ userAgentsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([])
  })

  it('finds a plugin agent reached through a symlinked intermediate directory', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    const realPluginLocation = path.join(root, 'real-plugin-location')
    writeAgent(path.join(realPluginLocation, 'agents'), 'symlinked.md', 'symlinked-agent', 'Reached via a symlinked plugin dir')
    fs.mkdirSync(pluginsCacheRoot, { recursive: true })
    fs.symlinkSync(realPluginLocation, path.join(pluginsCacheRoot, 'some-plugin'))

    const result = scanAgents({ userAgentsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ source: 'plugin', name: 'symlinked-agent' })
  })

  it('returns an empty array when the roots do not exist', () => {
    const result = scanAgents({
      userAgentsRoot: path.join(root, 'does-not-exist'),
      pluginsCacheRoot: path.join(root, 'also-does-not-exist'),
      projectPaths: [path.join(root, 'no-project-here')]
    })

    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/catalog/agents-scanner.test.ts`
Expected: FAIL — `Cannot find module './agents-scanner.js'`

- [ ] **Step 3: Write the scanner**

```ts
// apps/server/src/catalog/agents-scanner.ts
import fs from 'node:fs'
import path from 'node:path'

export interface AgentCandidate {
  source: 'user' | 'plugin' | 'project-local'
  name: string
  description: string
  markdownBody: string
  path: string
}

interface ScanAgentsInput {
  userAgentsRoot: string | undefined
  pluginsCacheRoot: string | undefined
  projectPaths: string[]
}

const MAX_PLUGIN_SEARCH_DEPTH = 8

function parseFrontmatterField(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))
  return match ? match[1].trim() : undefined
}

function readAgentAt(filePath: string, source: AgentCandidate['source']): AgentCandidate | undefined {
  const content = fs.readFileSync(filePath, 'utf-8')
  const name = parseFrontmatterField(content, 'name')
  if (!name) {
    return undefined
  }
  const description = parseFrontmatterField(content, 'description') ?? ''
  return { source, name, description, markdownBody: content, path: filePath }
}

function scanDirectAgentChildren(
  agentsRoot: string,
  source: AgentCandidate['source']
): AgentCandidate[] {
  if (!fs.existsSync(agentsRoot)) {
    return []
  }
  const candidates: AgentCandidate[] = []
  for (const entry of fs.readdirSync(agentsRoot)) {
    if (!entry.endsWith('.md')) {
      continue
    }
    const entryPath = path.join(agentsRoot, entry)
    let stat: fs.Stats
    try {
      stat = fs.statSync(entryPath)
    } catch {
      continue
    }
    if (!stat.isFile()) {
      continue
    }
    const agent = readAgentAt(entryPath, source)
    if (agent) {
      candidates.push(agent)
    }
  }
  return candidates
}

function findPluginAgentDirs(root: string): string[] {
  const found: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > MAX_PLUGIN_SEARCH_DEPTH) {
      return
    }
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }
      const entryPath = path.join(dir, entry.name)
      let isDir = entry.isDirectory()
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(entryPath).isDirectory()
        } catch {
          continue
        }
      }
      if (!isDir) {
        continue
      }
      if (entry.name === 'agents') {
        found.push(entryPath)
        continue
      }
      walk(entryPath, depth + 1)
    }
  }

  if (fs.existsSync(root)) {
    walk(root, 0)
  }
  return found
}

export function scanAgents(input: ScanAgentsInput): AgentCandidate[] {
  const candidates: AgentCandidate[] = []

  if (input.userAgentsRoot) {
    candidates.push(...scanDirectAgentChildren(input.userAgentsRoot, 'user'))
  }

  if (input.pluginsCacheRoot) {
    for (const agentsDir of findPluginAgentDirs(input.pluginsCacheRoot)) {
      candidates.push(...scanDirectAgentChildren(agentsDir, 'plugin'))
    }
  }

  for (const projectPath of input.projectPaths) {
    const projectAgentsRoot = path.join(projectPath, '.claude', 'agents')
    candidates.push(...scanDirectAgentChildren(projectAgentsRoot, 'project-local'))
  }

  return candidates
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/catalog/agents-scanner.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/catalog/agents-scanner.ts apps/server/src/catalog/agents-scanner.test.ts
git commit -m "feat(server): add agents catalog scanner"
```

---

### Task 3: Secret extraction (pure classification + redaction logic)

**Files:**
- Create: `apps/server/src/catalog/secret-extraction.ts`
- Test: `apps/server/src/catalog/secret-extraction.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/catalog/secret-extraction.test.ts
import { describe, expect, it } from 'vitest'
import { extractSecretsFromEnv, looksLikePlaceholder } from './secret-extraction.js'

describe('looksLikePlaceholder', () => {
  it('treats an empty string as a placeholder', () => {
    expect(looksLikePlaceholder('')).toBe(true)
  })

  it('treats whitespace-only as a placeholder', () => {
    expect(looksLikePlaceholder('   ')).toBe(true)
  })

  it('treats TODO-prefixed values as placeholders', () => {
    expect(looksLikePlaceholder('TODO_SET_YOUR_TOKEN')).toBe(true)
    expect(looksLikePlaceholder('todo-fill-this-in')).toBe(true)
  })

  it('treats YOUR_-prefixed values as placeholders', () => {
    expect(looksLikePlaceholder('YOUR_API_KEY_HERE')).toBe(true)
  })

  it('treats angle-bracket placeholders as placeholders', () => {
    expect(looksLikePlaceholder('<your-token>')).toBe(true)
  })

  it('treats ${...}-style template placeholders as placeholders', () => {
    expect(looksLikePlaceholder('${API_KEY}')).toBe(true)
  })

  it('treats CHANGEME as a placeholder', () => {
    expect(looksLikePlaceholder('CHANGEME')).toBe(true)
    expect(looksLikePlaceholder('change_me')).toBe(true)
  })

  it('does not treat a real-looking token as a placeholder', () => {
    expect(looksLikePlaceholder('ghp_1234567890abcdefABCDEF')).toBe(false)
  })

  it('does not treat a file path as a placeholder', () => {
    expect(looksLikePlaceholder('/Users/example/credentials.json')).toBe(false)
  })
})

describe('extractSecretsFromEnv', () => {
  it('returns the env unchanged when there are no non-placeholder values', () => {
    const result = extractSecretsFromEnv('my-server', { API_KEY: 'TODO_SET_YOUR_TOKEN', EMPTY: '' })

    expect(result.sanitizedEnv).toEqual({ API_KEY: 'TODO_SET_YOUR_TOKEN', EMPTY: '' })
    expect(result.secretsToStore).toEqual([])
  })

  it('extracts a real-looking value and replaces it with a secret_ref', () => {
    const result = extractSecretsFromEnv('my-server', { GITHUB_TOKEN: 'ghp_realtoken123' })

    expect(result.secretsToStore).toEqual([
      { refName: 'mcp:my-server:GITHUB_TOKEN', value: 'ghp_realtoken123' }
    ])
    expect(result.sanitizedEnv).toEqual({ GITHUB_TOKEN: 'secret_ref:mcp:my-server:GITHUB_TOKEN' })
  })

  it('handles a mix of real and placeholder values in one env object', () => {
    const result = extractSecretsFromEnv('mixed-server', {
      REAL_SECRET: 'sk-abc123real',
      PLACEHOLDER: 'YOUR_KEY_HERE',
      PATH_LIKE: '/Users/example/creds.json'
    })

    expect(result.sanitizedEnv).toEqual({
      REAL_SECRET: 'secret_ref:mcp:mixed-server:REAL_SECRET',
      PLACEHOLDER: 'YOUR_KEY_HERE',
      PATH_LIKE: 'secret_ref:mcp:mixed-server:PATH_LIKE'
    })
    expect(result.secretsToStore).toEqual([
      { refName: 'mcp:mixed-server:REAL_SECRET', value: 'sk-abc123real' },
      { refName: 'mcp:mixed-server:PATH_LIKE', value: '/Users/example/creds.json' }
    ])
  })

  it('returns an empty env unchanged', () => {
    const result = extractSecretsFromEnv('empty-server', {})

    expect(result.sanitizedEnv).toEqual({})
    expect(result.secretsToStore).toEqual([])
  })

  it('does not let a colon in serverName or key collide with a different pair', () => {
    const a = extractSecretsFromEnv('evil:server', { TOKEN: 'realvalue1' })
    const b = extractSecretsFromEnv('evil', { 'server:TOKEN': 'realvalue2' })

    expect(a.secretsToStore[0].refName).not.toBe(b.secretsToStore[0].refName)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/catalog/secret-extraction.test.ts`
Expected: FAIL — `Cannot find module './secret-extraction.js'`

- [ ] **Step 3: Write the module**

```ts
// apps/server/src/catalog/secret-extraction.ts
const PLACEHOLDER_PATTERNS = [/^todo/i, /^your_/i, /^<.*>$/, /^\$\{.*\}$/, /^change_?me$/i]

export function looksLikePlaceholder(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') {
    return true
  }
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export interface SecretToStore {
  refName: string
  value: string
}

export interface ExtractSecretsResult {
  sanitizedEnv: Record<string, string>
  secretsToStore: SecretToStore[]
}

export function extractSecretsFromEnv(
  serverName: string,
  env: Record<string, string>
): ExtractSecretsResult {
  const sanitizedEnv: Record<string, string> = {}
  const secretsToStore: SecretToStore[] = []

  for (const [key, value] of Object.entries(env)) {
    if (looksLikePlaceholder(value)) {
      sanitizedEnv[key] = value
      continue
    }
    const refName = `mcp:${encodeURIComponent(serverName)}:${encodeURIComponent(key)}`
    secretsToStore.push({ refName, value })
    sanitizedEnv[key] = `secret_ref:${refName}`
  }

  return { sanitizedEnv, secretsToStore }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/catalog/secret-extraction.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/catalog/secret-extraction.ts apps/server/src/catalog/secret-extraction.test.ts
git commit -m "feat(server): add secret-looking env value classification and redaction"
```

---

### Task 4: MCP servers scanner (read-only)

**Files:**
- Create: `apps/server/src/catalog/mcp-servers-scanner.ts`
- Test: `apps/server/src/catalog/mcp-servers-scanner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/catalog/mcp-servers-scanner.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanMcpServers } from './mcp-servers-scanner.js'

describe('scanMcpServers', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-mcp-scanner-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('reads user-level servers from the claudeJsonPath\'s mcpServers key', () => {
    const claudeJsonPath = path.join(root, '.claude.json')
    fs.writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        someUnrelatedKey: 'ignored',
        mcpServers: {
          filesystem: { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'], env: {} }
        }
      })
    )

    const result = scanMcpServers({ claudeJsonPath, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'user',
        name: 'filesystem',
        command: { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'], env: {} }
      }
    ])
  })

  it('reads an http-type user-level server without a command/args shape', () => {
    const claudeJsonPath = path.join(root, '.claude.json')
    fs.writeFileSync(
      claudeJsonPath,
      JSON.stringify({ mcpServers: { notion: { type: 'http', url: 'https://mcp.notion.com/mcp' } } })
    )

    const result = scanMcpServers({ claudeJsonPath, projectPaths: [] })

    expect(result).toEqual([
      { source: 'user', name: 'notion', command: { type: 'http', url: 'https://mcp.notion.com/mcp' } }
    ])
  })

  it('returns an empty array when claudeJsonPath does not exist', () => {
    const result = scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [] })

    expect(result).toEqual([])
  })

  it('returns an empty array when claudeJsonPath has no mcpServers key', () => {
    const claudeJsonPath = path.join(root, '.claude.json')
    fs.writeFileSync(claudeJsonPath, JSON.stringify({ someOtherKey: true }))

    const result = scanMcpServers({ claudeJsonPath, projectPaths: [] })

    expect(result).toEqual([])
  })

  it('reads project-level servers from .mcp.json', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(projectPath, { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { local: { command: 'node', args: ['start.mjs'] } } })
    )

    const result = scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })

    expect(result).toEqual([
      { source: 'project-local', name: 'local', command: { command: 'node', args: ['start.mjs'] } }
    ])
  })

  it('reads project-level servers from .claude/settings.json when .mcp.json is absent', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { fromSettings: { command: 'python3', args: ['server.py'] } } })
    )

    const result = scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })

    expect(result).toEqual([
      { source: 'project-local', name: 'fromSettings', command: { command: 'python3', args: ['server.py'] } }
    ])
  })

  it('merges .mcp.json and .claude/settings.json servers for the same project without duplicating a name defined in both (prefers .mcp.json)', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { shared: { command: 'from-mcp-json' } } })
    )
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({
        mcpServers: { shared: { command: 'from-settings-json' }, onlyInSettings: { command: 'x' } }
      })
    )

    const result = scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })

    expect(result).toEqual([
      { source: 'project-local', name: 'shared', command: { command: 'from-mcp-json' } },
      { source: 'project-local', name: 'onlyInSettings', command: { command: 'x' } }
    ])
  })

  it('handles a project with neither file gracefully', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(projectPath, { recursive: true })

    const result = scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })

    expect(result).toEqual([])
  })

  it('handles malformed JSON in a project file without throwing', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(projectPath, { recursive: true })
    fs.writeFileSync(path.join(projectPath, '.mcp.json'), '{ not valid json')

    expect(() =>
      scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })
    ).not.toThrow()
    expect(
      scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/catalog/mcp-servers-scanner.test.ts`
Expected: FAIL — `Cannot find module './mcp-servers-scanner.js'`

- [ ] **Step 3: Write the scanner**

```ts
// apps/server/src/catalog/mcp-servers-scanner.ts
import fs from 'node:fs'
import path from 'node:path'

export interface McpServerCandidate {
  source: 'user' | 'project-local'
  name: string
  command: unknown
}

interface ScanMcpServersInput {
  claudeJsonPath: string
  projectPaths: string[]
}

function readMcpServersObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { mcpServers?: unknown }
    if (parsed && typeof parsed === 'object' && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
      return parsed.mcpServers as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

export function scanMcpServers(input: ScanMcpServersInput): McpServerCandidate[] {
  const candidates: McpServerCandidate[] = []

  const userServers = readMcpServersObject(input.claudeJsonPath)
  for (const [name, command] of Object.entries(userServers)) {
    candidates.push({ source: 'user', name, command })
  }

  for (const projectPath of input.projectPaths) {
    const mcpJsonServers = readMcpServersObject(path.join(projectPath, '.mcp.json'))
    const settingsServers = readMcpServersObject(path.join(projectPath, '.claude', 'settings.json'))
    const merged: Record<string, unknown> = { ...settingsServers, ...mcpJsonServers }
    for (const [name, command] of Object.entries(merged)) {
      candidates.push({ source: 'project-local', name, command })
    }
  }

  return candidates
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/catalog/mcp-servers-scanner.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/catalog/mcp-servers-scanner.ts apps/server/src/catalog/mcp-servers-scanner.test.ts
git commit -m "feat(server): add read-only MCP servers catalog scanner"
```

---

### Task 5: Permissions scanner

**Files:**
- Create: `apps/server/src/catalog/permissions-scanner.ts`
- Test: `apps/server/src/catalog/permissions-scanner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/catalog/permissions-scanner.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanPermissions } from './permissions-scanner.js'

describe('scanPermissions', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-permissions-scanner-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('reads a permissions block from a project settings.json', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(*)'], deny: ['Bash(rm -rf /*)'] } })
    )

    const result = scanPermissions({ projectPaths: [projectPath] })

    expect(result).toEqual([
      {
        source: 'project-local',
        projectPath,
        permissions: { allow: ['Bash(*)'], deny: ['Bash(rm -rf /*)'] }
      }
    ])
  })

  it('skips a project with no settings.json', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(projectPath, { recursive: true })

    const result = scanPermissions({ projectPaths: [projectPath] })

    expect(result).toEqual([])
  })

  it('skips a project whose settings.json has no permissions key', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { x: true } })
    )

    const result = scanPermissions({ projectPaths: [projectPath] })

    expect(result).toEqual([])
  })

  it('handles malformed JSON without throwing', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.json'), '{ not valid')

    expect(() => scanPermissions({ projectPaths: [projectPath] })).not.toThrow()
    expect(scanPermissions({ projectPaths: [projectPath] })).toEqual([])
  })

  it('handles multiple projects independently', () => {
    const projectA = path.join(root, 'a')
    const projectB = path.join(root, 'b')
    fs.mkdirSync(path.join(projectA, '.claude'), { recursive: true })
    fs.mkdirSync(path.join(projectB, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectA, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Edit'] } })
    )
    fs.writeFileSync(path.join(projectB, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: {} }))

    const result = scanPermissions({ projectPaths: [projectA, projectB] })

    expect(result).toEqual([
      { source: 'project-local', projectPath: projectA, permissions: { allow: ['Edit'] } }
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/catalog/permissions-scanner.test.ts`
Expected: FAIL — `Cannot find module './permissions-scanner.js'`

- [ ] **Step 3: Write the scanner**

```ts
// apps/server/src/catalog/permissions-scanner.ts
import fs from 'node:fs'
import path from 'node:path'

export interface PermissionsCandidate {
  source: 'project-local'
  projectPath: string
  permissions: unknown
}

interface ScanPermissionsInput {
  projectPaths: string[]
}

export function scanPermissions(input: ScanPermissionsInput): PermissionsCandidate[] {
  const candidates: PermissionsCandidate[] = []

  for (const projectPath of input.projectPaths) {
    const settingsPath = path.join(projectPath, '.claude', 'settings.json')
    if (!fs.existsSync(settingsPath)) {
      continue
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { permissions?: unknown }
      if (parsed && typeof parsed === 'object' && parsed.permissions !== undefined) {
        candidates.push({ source: 'project-local', projectPath, permissions: parsed.permissions })
      }
    } catch {
      continue
    }
  }

  return candidates
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/catalog/permissions-scanner.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/catalog/permissions-scanner.ts apps/server/src/catalog/permissions-scanner.test.ts
git commit -m "feat(server): add permissions catalog scanner"
```

---

### Task 6: Catalog routes — skills, agents, permissions

**Files:**
- Create: `apps/server/src/catalog/catalog.routes.ts` (skills/agents/permissions routes in this task; MCP servers route in Task 7)
- Test: `apps/server/src/catalog/catalog.routes.test.ts`
- Modify: `apps/server/src/app.ts` (register `catalogRoutes`)

**Before editing `app.ts`**, read its actual current content (should be the Phase 2b end-state: `buildApp(db, keychainClient = new MacKeychainClient())`, error handler including `KeychainAccessError`, `/health`, `rolesRoutes`, `projectsRoutes`, `secretsRoutes`) and adapt rather than assume.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/catalog/catalog.routes.test.ts
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

describe('catalog routes', () => {
  let db: Database.Database
  let app: FastifyInstance
  let scratchRoot: string

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-catalog-routes-test-')))
    app = buildApp(db, new InMemoryKeychainClient(), {
      userSkillsRoot: path.join(scratchRoot, 'user-skills'),
      userAgentsRoot: path.join(scratchRoot, 'user-agents'),
      pluginsCacheRoot: path.join(scratchRoot, 'plugins-cache')
    })
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  describe('GET /catalog/skills', () => {
    it('returns an empty array when nothing is registered and env vars are unset', async () => {
      const response = await app.inject({ method: 'GET', url: '/catalog/skills' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([])
    })

    it('finds skills under a registered project once a project is registered', async () => {
      const projectPath = path.join(scratchRoot, 'my-project')
      const skillDir = path.join(projectPath, '.claude', 'skills', 'demo')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: demo\ndescription: A demo skill\n---\n\nBody\n'
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'my-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/skills' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([
        {
          source: 'project-local',
          name: 'demo',
          description: 'A demo skill',
          path: skillDir
        }
      ])
    })
  })

  describe('GET /catalog/agents', () => {
    it('finds agents under a registered project', async () => {
      const projectPath = path.join(scratchRoot, 'agent-project')
      const agentsDir = path.join(projectPath, '.claude', 'agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(
        path.join(agentsDir, 'reviewer.md'),
        '---\nname: reviewer\ndescription: Reviews things\n---\n\nBody\n'
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'agent-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/agents' })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({ source: 'project-local', name: 'reviewer', description: 'Reviews things' })
    })
  })

  describe('GET /catalog/permissions', () => {
    it('finds a permissions block under a registered project', async () => {
      const projectPath = path.join(scratchRoot, 'perms-project')
      fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.claude', 'settings.json'),
        JSON.stringify({ permissions: { allow: ['Edit'] } })
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'perms-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/permissions' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([
        { source: 'project-local', projectPath, permissions: { allow: ['Edit'] } }
      ])
    })

    it('returns an empty array when no registered project has a permissions block', async () => {
      const response = await app.inject({ method: 'GET', url: '/catalog/permissions' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @skillam/server -- src/catalog/catalog.routes.test.ts`
Expected: FAIL — `Cannot find module './catalog.routes.js'`

- [ ] **Step 3: Write the routes plugin**

```ts
// apps/server/src/catalog/catalog.routes.ts
import type { FastifyPluginAsync } from 'fastify'
import type { ProjectsRepository } from '../projects/projects.repository.js'
import { scanSkills } from './skills-scanner.js'
import { scanAgents } from './agents-scanner.js'
import { scanPermissions } from './permissions-scanner.js'

export interface CatalogRouteDeps {
  projects: ProjectsRepository
  userSkillsRoot: string
  userAgentsRoot: string
  pluginsCacheRoot: string
}

export const catalogRoutes: FastifyPluginAsync<CatalogRouteDeps> = async (app, deps) => {
  app.get('/catalog/skills', async () => {
    const projectPaths = deps.projects.list().map((p) => p.path)
    return scanSkills({
      userSkillsRoot: deps.userSkillsRoot,
      pluginsCacheRoot: deps.pluginsCacheRoot,
      projectPaths
    })
  })

  app.get('/catalog/agents', async () => {
    const projectPaths = deps.projects.list().map((p) => p.path)
    return scanAgents({
      userAgentsRoot: deps.userAgentsRoot,
      pluginsCacheRoot: deps.pluginsCacheRoot,
      projectPaths
    })
  })

  app.get('/catalog/permissions', async () => {
    const projectPaths = deps.projects.list().map((p) => p.path)
    return scanPermissions({ projectPaths })
  })
}
```

**Why the roots are injected rather than hardcoded:** if `catalog.routes.ts` computed `path.join(os.homedir(), '.claude', 'skills')` etc. internally (as an earlier draft of this plan did), every test hitting `/catalog/skills` or `/catalog/agents` would scan the REAL developer machine's `~/.claude/` tree — indeterminate results depending on what's actually installed there, and no way to assert an empty/known baseline. This is the same trap Phase 2b pre-empted for `MacKeychainClient` (injectable with a production-safe default) — same fix, applied here to filesystem roots instead of a Keychain client.

- [ ] **Step 4: Wire into `app.ts`**

Read the actual current `apps/server/src/app.ts` first. This step also extends `buildApp`'s signature with a third, optional parameter so tests can override the catalog scan roots while production code keeps today's zero-argument call sites working unchanged. Add these imports (`os`/`path` may already be absent from `app.ts` — add them if not already imported):

```ts
import os from 'node:os'
import path from 'node:path'
import { catalogRoutes } from './catalog/catalog.routes.js'
```

Add a `CatalogRoots` type and change `buildApp`'s signature:

```ts
export interface CatalogRoots {
  userSkillsRoot?: string
  userAgentsRoot?: string
  pluginsCacheRoot?: string
}

export function buildApp(
  db: Database.Database,
  keychainClient: KeychainClient = new MacKeychainClient(),
  catalogRoots: CatalogRoots = {}
): FastifyInstance {
```

Inside `buildApp`, before the `app.register(catalogRoutes, ...)` call, resolve each root to its real-machine default when not overridden:

```ts
  const userSkillsRoot = catalogRoots.userSkillsRoot ?? path.join(os.homedir(), '.claude', 'skills')
  const userAgentsRoot = catalogRoots.userAgentsRoot ?? path.join(os.homedir(), '.claude', 'agents')
  const pluginsCacheRoot = catalogRoots.pluginsCacheRoot ?? path.join(os.homedir(), '.claude', 'plugins', 'cache')
```

And, after the existing `app.register(secretsRoutes, {...})` call and before `return app`:

```ts
  app.register(catalogRoutes, {
    projects: new ProjectsRepository(db),
    userSkillsRoot,
    userAgentsRoot,
    pluginsCacheRoot
  })
```

(`ProjectsRepository` is already imported in `app.ts` from Phase 2a — reuse the existing import, don't add a duplicate.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests, including the 5 new ones)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/catalog/catalog.routes.ts apps/server/src/catalog/catalog.routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add catalog skills/agents/permissions http routes"
```

---

### Task 7: Catalog route — MCP servers (with secret extraction)

**Files:**
- Modify: `apps/server/src/catalog/catalog.routes.ts` (add MCP servers route)
- Modify: `apps/server/src/catalog/catalog.routes.test.ts` (append tests)

- [ ] **Step 1: Append the failing tests**

First, update the existing top-level `beforeEach` in `catalog.routes.test.ts` (added in Task 6) to also inject a scratch `claudeJsonPath`, for the same test-isolation reason the other three roots were injected — without this, `GET /catalog/mcp-servers` would scan this machine's real `~/.claude.json`, which has real `mcpServers` entries that would break every exact-length/exact-equality assertion below:

```ts
    app = buildApp(db, new InMemoryKeychainClient(), {
      userSkillsRoot: path.join(scratchRoot, 'user-skills'),
      userAgentsRoot: path.join(scratchRoot, 'user-agents'),
      pluginsCacheRoot: path.join(scratchRoot, 'plugins-cache'),
      claudeJsonPath: path.join(scratchRoot, '.claude.json')
    })
```

Then add this nested `describe` inside the existing test file:

```ts
  describe('GET /catalog/mcp-servers', () => {
    it('extracts a real-looking env value into secrets and returns a secret_ref in its place', async () => {
      const projectPath = path.join(scratchRoot, 'mcp-project')
      fs.mkdirSync(projectPath, { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            github: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_realvalue1234567890' }
            }
          }
        })
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'mcp-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/mcp-servers' })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body).toHaveLength(1)
      expect(body[0].source).toBe('project-local')
      expect(body[0].name).toBe('github')
      expect(body[0].command.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
        'secret_ref:mcp:github:GITHUB_PERSONAL_ACCESS_TOKEN'
      )
      expect(JSON.stringify(body)).not.toContain('ghp_realvalue1234567890')

      const secretsResponse = await app.inject({ method: 'GET', url: '/secrets' })
      expect(secretsResponse.json()).toEqual([
        expect.objectContaining({ refName: 'mcp:github:GITHUB_PERSONAL_ACCESS_TOKEN' })
      ])

      const secretId = secretsResponse.json()[0].id
      const revealResponse = await app.inject({ method: 'POST', url: `/secrets/${secretId}/reveal` })
      expect(revealResponse.json()).toEqual({ value: 'ghp_realvalue1234567890' })
    })

    it('leaves a placeholder env value untouched and does not create a secret', async () => {
      const projectPath = path.join(scratchRoot, 'placeholder-project')
      fs.mkdirSync(projectPath, { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.mcp.json'),
        JSON.stringify({
          mcpServers: { x: { command: 'npx', env: { TOKEN: 'TODO_SET_YOUR_TOKEN' } } }
        })
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'placeholder-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/mcp-servers' })

      expect(response.json()[0].command.env.TOKEN).toBe('TODO_SET_YOUR_TOKEN')

      const secretsResponse = await app.inject({ method: 'GET', url: '/secrets' })
      expect(secretsResponse.json()).toEqual([])
    })

    it('does not create a duplicate secret on a second scan of the same server', async () => {
      const projectPath = path.join(scratchRoot, 'rescan-project')
      fs.mkdirSync(projectPath, { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.mcp.json'),
        JSON.stringify({ mcpServers: { svc: { command: 'x', env: { KEY: 'realvalue123456' } } } })
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'rescan-project' }
      })

      await app.inject({ method: 'GET', url: '/catalog/mcp-servers' })
      await app.inject({ method: 'GET', url: '/catalog/mcp-servers' })

      const secretsResponse = await app.inject({ method: 'GET', url: '/secrets' })
      expect(secretsResponse.json()).toHaveLength(1)
    })

    it('returns a server with no env untouched (no secrets, no crash)', async () => {
      const projectPath = path.join(scratchRoot, 'no-env-project')
      fs.mkdirSync(projectPath, { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.mcp.json'),
        JSON.stringify({ mcpServers: { simple: { command: 'node', args: ['start.js'] } } })
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'no-env-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/mcp-servers' })

      expect(response.statusCode).toBe(200)
      expect(response.json()[0].command).toEqual({ command: 'node', args: ['start.js'] })
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @skillam/server -- src/catalog/catalog.routes.test.ts`
Expected: FAIL — `GET /catalog/mcp-servers` returns 404 (route not registered)

- [ ] **Step 3: Add the route**

Read the current `apps/server/src/catalog/catalog.routes.ts` first. Add the imports and route:

```ts
import { scanMcpServers } from './mcp-servers-scanner.js'
import { extractSecretsFromEnv } from './secret-extraction.js'
import type { SecretsRepository } from '../secrets/secrets.repository.js'
```

Update `CatalogRouteDeps` to add `secrets: SecretsRepository` and `claudeJsonPath: string` (injected the same way as the other roots — see the note in Task 6 about why these aren't computed inline with `os.homedir()`):

```ts
export interface CatalogRouteDeps {
  projects: ProjectsRepository
  secrets: SecretsRepository
  claudeJsonPath: string
}
```

Add the route (inside the plugin body):

```ts
  app.get('/catalog/mcp-servers', async () => {
    const projectPaths = deps.projects.list().map((p) => p.path)
    const rawServers = scanMcpServers({ claudeJsonPath: deps.claudeJsonPath, projectPaths })

    return rawServers.map((server) => {
      const command = server.command
      if (
        !command ||
        typeof command !== 'object' ||
        !('env' in command) ||
        !command.env ||
        typeof command.env !== 'object'
      ) {
        return server
      }
      const env = command.env as Record<string, string>
      const { sanitizedEnv, secretsToStore } = extractSecretsFromEnv(server.name, env)
      for (const secret of secretsToStore) {
        const existing = deps.secrets.getByRefName(secret.refName)
        if (!existing) {
          deps.secrets.create({ refName: secret.refName, encryptedValue: secret.value })
        }
      }
      return { ...server, command: { ...command, env: sanitizedEnv } }
    })
  })
```

**IMPORTANT — this route stores a PLAINTEXT value via `deps.secrets.create` above, which is wrong.** `SecretsRepository.create` expects an `encryptedValue`, and this route has no access to encryption — Task 6/7 of Phase 2b's `secretsRoutes` did the encryption inline using a `MasterKeyProvider`. This route needs the same capability. Fix this before running the tests: add `masterKeyProvider: MasterKeyProvider` to `CatalogRouteDeps`, import `MasterKeyProvider` from `../secrets/master-key-provider.js` and `encrypt` from `../secrets/secrets-cipher.js`, and change the secret-storing line to:

```ts
      for (const secret of secretsToStore) {
        const existing = deps.secrets.getByRefName(secret.refName)
        if (!existing) {
          const key = deps.masterKeyProvider.getOrCreateKey()
          deps.secrets.create({ refName: secret.refName, encryptedValue: encrypt(secret.value, key) })
        }
      }
```

- [ ] **Step 4: Update `app.ts`'s registration to pass the new dependencies**

Add `claudeJsonPath` to the `CatalogRoots` interface and its default resolution, alongside the three roots already added in Task 6:

```ts
export interface CatalogRoots {
  userSkillsRoot?: string
  userAgentsRoot?: string
  pluginsCacheRoot?: string
  claudeJsonPath?: string
}
```

```ts
  const claudeJsonPath = catalogRoots.claudeJsonPath ?? path.join(os.homedir(), '.claude.json')
```

```ts
  app.register(catalogRoutes, {
    projects: new ProjectsRepository(db),
    secrets: new SecretsRepository(db),
    masterKeyProvider: new MasterKeyProvider(keychainClient),
    userSkillsRoot,
    userAgentsRoot,
    pluginsCacheRoot,
    claudeJsonPath
  })
```

(`SecretsRepository` and `MasterKeyProvider` are already imported in `app.ts` from Phase 2b — reuse the existing imports.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @skillam/server -- src/catalog/catalog.routes.test.ts`
Expected: PASS (all tests)

- [ ] **Step 6: Run the full suite**

Run: `npm run test -w @skillam/server`
Expected: PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/catalog/catalog.routes.ts apps/server/src/catalog/catalog.routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add catalog mcp-servers http route with secret extraction"
```

---

### Task 8: Manual end-to-end verification against this machine's real Claude Code environment

**Files:** None (verification only).

This task scans REAL, READ-ONLY paths on this machine (`~/.claude/skills`, `~/.claude/agents`, `~/.claude/plugins/cache`, `~/.claude.json`) — nothing in this task ever writes to those paths. The catalog scanners in this plan only ever read them. The ONE write side-effect (extracted secrets) goes into skillam's OWN database, which MUST be a scratch path for this verification, not the user's real `~/.skillam/skillam.db` — keeping this verification's synthetic/real-world-derived secret entries separate from any real skillam data the user may already have.

- [ ] **Step 1: Check for a leftover process on port 4317**

```bash
lsof -i :4317 -sTCP:LISTEN
```

Same handling as every prior phase's final verification: investigate before touching anything unexpected; if it's a known leftover from this project's own prior work, it's safe to stop (all real data lives in files, not process memory).

- [ ] **Step 2: Start the server against a scratch DB**

```bash
SKILLAM_DB_PATH=/tmp/skillam-phase2c-verify/skillam.db npm run dev -w @skillam/server &> /tmp/skillam-phase2c-verify.log &
```

Wait for readiness (poll `/health`).

- [ ] **Step 3: Register a real project with Claude Code config**

Register any real project on this machine known to have a `.claude/settings.json` (the skillam repository itself has no `.claude/` directory, so pick a different, real one). Check candidates first with `ls ~/Develop/*/.claude/settings.json`, then substitute a confirmed path below:

```bash
curl -s -X POST http://127.0.0.1:4317/projects \
  -H 'content-type: application/json' \
  -d '{"path":"'"$HOME"'/Develop/demo-claudecode","name":"demo-claudecode"}'
```

(Substitute a real project path on this machine confirmed to have a `.claude/settings.json` if `demo-claudecode` doesn't exist or doesn't have one — check with `ls ~/Develop/*/. claude/settings.json` first and pick any real match. The point is registering at least one real project so `/catalog/permissions` and any project-local MCP/skills/agents have something to find.)

- [ ] **Step 4: Walk through the full curl sequence**

```bash
curl -s http://127.0.0.1:4317/catalog/skills | python3 -m json.tool | head -40
# Expected: a JSON array with entries from ~/.claude/skills/* (source: "user") and
# ~/.claude/plugins/cache/**/skills/* (source: "plugin") — should include real skills
# like "drawio", "daily-flipbook", entries from the superpowers/everything-claude-code
# plugin caches, etc. Confirm the array is non-empty and a plausible size (dozens of entries).

curl -s http://127.0.0.1:4317/catalog/agents | python3 -m json.tool | head -40
# Expected: entries from ~/.claude/agents/*.md (the gsd-* agents observed during planning
# research) plus plugin-provided agents, tagged with the correct source. Confirm no
# entries leaked from any observed .codex/.kiro-style bundled directories (spot-check
# a few names against what's actually in ~/.claude/agents/).

curl -s http://127.0.0.1:4317/catalog/mcp-servers | python3 -m json.tool | head -60
# Expected: entries from ~/.claude.json's real mcpServers (filesystem, memory, github,
# playwright, notebooklm-mcp, etc.), each with source: "user". For the "github" entry
# specifically, confirm its env.GITHUB_PERSONAL_ACCESS_TOKEN value is now the literal
# string "TODO_SET_YOUR_TOKEN" UNCHANGED (this is a real placeholder value observed on
# this machine, so it should NOT be extracted into secrets). If any other server has a
# real-looking token value, confirm it now shows as "secret_ref:mcp:<server>:<key>"
# instead of the raw value.

curl -s http://127.0.0.1:4317/secrets
# Expected: any secrets extracted during the mcp-servers scan above. Confirm NO
# plaintext value appears anywhere in this response (it shouldn't — /secrets never
# returns values, per Phase 2b).

curl -s http://127.0.0.1:4317/catalog/permissions
# Expected: an entry for the project registered in Step 3, if its settings.json has a
# permissions block (many won't — that's fine, confirm the response is a valid array
# either way, empty or non-empty).
```

- [ ] **Step 5: Confirm no unexpected write side effects**

```bash
# Confirm the real ~/.claude/ tree was not modified by this verification:
ls -la ~/.claude/skills ~/.claude/agents ~/.claude.json
# (just eyeball that nothing looks freshly modified — timestamps should predate this session's testing, except for whatever normal Claude Code usage already touches ~/.claude.json during this session's other tool calls, which is expected and unrelated to skillam)
```

- [ ] **Step 6: Stop the server and clean up scratch DB files**

```bash
lsof -ti:4317 -sTCP:LISTEN | xargs -r kill
rm -rf /tmp/skillam-phase2c-verify /tmp/skillam-phase2c-verify.log
```

Confirm `~/.skillam/` (the real default DB location) was not touched — this verification used `SKILLAM_DB_PATH` throughout.

- [ ] **Step 7: Run the full test suite one final time**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests)

- [ ] **Step 8: No commit for this task** (verification only)

---

## Phase 2c Definition of Done

- `GET /catalog/skills`, `GET /catalog/agents`, `GET /catalog/mcp-servers`, `GET /catalog/permissions` all work via HTTP, each correctly tagging results by source (`user`/`plugin`/`project-local`).
- Plugin-provided skills/agents are discovered regardless of nesting depth under `~/.claude/plugins/cache/`, and non-Claude-Code tool directories (dot-prefixed, e.g. `.codex/`, `.kiro/`) are correctly excluded.
- MCP server env values that look like real secrets are transparently extracted into the Phase 2b `secrets` table and replaced with `secret_ref:...` placeholders; obvious placeholder values (TODO/YOUR_/`<...>`/`${...}`/CHANGEME) are left untouched and never stored as secrets.
- Re-scanning does not create duplicate secret entries for the same server/env-key pair.
- All automated tests use temporary directories and in-memory databases — no automated test touches this machine's real `~/.claude/` tree or real `~/.skillam/` database.
- Manual verification (Task 8) confirms the scanners correctly discover this machine's actual Skills/Agents/MCP servers/Permissions, and correctly classify at least one known real placeholder value as non-secret.
- All tests pass via `npm test` from the repo root.

## Next Phases (not detailed here)

- **Phase 3:** Apply/diff engine (merge-mode file generation for `.claude/settings.json`/`.mcp.json`/`skills/`/`agents/`, diff preview, apply history, drift detection), export/import.
- **Phase 4:** `apps/web` React SPA.
