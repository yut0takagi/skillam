import fs from 'node:fs'
import path from 'node:path'
import type { Project } from '../projects/projects.types.js'
import type { RoleSkillsRepository } from '../roles/role-skills.repository.js'
import type { RoleAgentsRepository } from '../roles/role-agents.repository.js'
import type { RoleMcpServersRepository } from '../roles/role-mcp-servers.repository.js'
import type { RolePermissionsRepository } from '../roles/role-permissions.repository.js'
import type { ApplyHistoryRepository } from './apply-history.repository.js'
import type { ApplyHistoryEntry } from './apply-history.types.js'
import type { ManagedState } from './managed-state.js'
import { planSettings, type RolePermissionsShape } from './plan-settings.js'
import { planMcp } from './plan-mcp.js'
import {
  planMaterialize,
  MaterializeConflictError,
  type CurrentEntry,
  type DesiredEntry,
  type MaterializeOperation
} from './plan-materialize.js'
import {
  readFileOrNull,
  readJsonObject,
  readCurrentEntry,
  settingsPathFor,
  SETTINGS_RELATIVE_PATH
} from './project-state.js'
import { listTrackedPaths, isTracked, GitTrackedTargetError } from './git-tracked.js'
import {
  composeRoles,
  type BindingOrigin,
  type ComposedRole,
  type RoleBinding
} from './compose-roles.js'

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

// Which binding contributed each materialized item. Surfaced so the preview
// can answer "why is this here?" — with scope and group bindings an entry can
// arrive without anyone having chosen it for this project specifically.
export interface PlanOrigin {
  kind: 'skill' | 'agent' | 'mcpServer'
  name: string
  origin: BindingOrigin
}

export interface ApplyPlan {
  projectId: number
  projectPath: string
  // The role this plan applied, or null when several bindings were composed
  // and no single role describes it. apply_history.role_id is nullable for
  // exactly this reason; naming an arbitrary one of the roles would make the
  // history claim an apply that never happened that way.
  roleId: number | null
  origins: PlanOrigin[]
  settingsFile: FileChange
  mcpFile: FileChange
  mcpAfterObject: Record<string, unknown>
  operations: MaterializeOperation[]
  managed: ManagedState
}

const GITIGNORE_RELATIVE_PATH = path.join('.claude', '.gitignore')

// Written alongside whatever skillam materializes so a shared repository does
// not pick up this machine's symlinks. Only covers what skillam owns; a
// settings.json the team committed is deliberately absent, because skillam
// does not manage that file and must not start ignoring it on their behalf.
const GITIGNORE_CONTENT = `# skillam が管理する範囲。このマシン固有のパスを指すためコミットしない。
settings.local.json
skills/
agents/
commands/
`

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

// Everything skillam has attempted since its last known-good state (i.e.
// every history row from the last success onward, or the whole history if
// there has never been a success) is treated as skillam's own for the
// purpose of the conflict guard: a retry after a failed apply must be able
// to overwrite paths a previous attempt already wrote, including partial
// writes left behind by the failure, without tripping the "not created by
// skillam" check. Order-stable de-duplicated union, oldest attempt first.
function unionStringLists(lists: string[][]): string[] {
  const seen = new Set<string>()
  const union: string[] = []
  for (const list of lists) {
    for (const entry of list) {
      if (!seen.has(entry)) {
        seen.add(entry)
        union.push(entry)
      }
    }
  }
  return union
}

function unionManagedStates(entries: ApplyHistoryEntry[]): ManagedState {
  return {
    mcpServers: unionStringLists(entries.map((entry) => entry.managed.mcpServers)),
    materialized: unionStringLists(entries.map((entry) => entry.managed.materialized)),
    permissionAllow: unionStringLists(entries.map((entry) => entry.managed.permissionAllow)),
    permissionDeny: unionStringLists(entries.map((entry) => entry.managed.permissionDeny))
  }
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

// One role bound to a project, before its material is read from the database.
export interface RoleBindingRef {
  roleId: number
  origin: BindingOrigin
  priority: number
}

// Reads each bound role's material and composes it into a single set. This is
// the only part of planning that knows about multiple roles; everything below
// works from the composed result and cannot tell how many roles produced it.
function composeBindings(deps: ApplyPlannerDeps, refs: RoleBindingRef[]): ComposedRole {
  const bindings: RoleBinding[] = refs.map((ref) => ({
    roleId: ref.roleId,
    origin: ref.origin,
    priority: ref.priority,
    skills: deps.skills.listForRole(ref.roleId).map((skill) => ({
      skillSource: skill.skillSource,
      skillPath: skill.skillPath
    })),
    agents: deps.agents.listForRole(ref.roleId).map((agent) => ({
      name: agent.name,
      markdownBody: agent.markdownBody,
      source: agent.source,
      sourcePath: agent.sourcePath
    })),
    mcpServers: deps.mcpServers.listForRole(ref.roleId).map((server) => ({
      name: server.name,
      command: server.command,
      env: server.env
    })),
    permissions: toRolePermissions(deps.permissions.getForRole(ref.roleId)?.permissions)
  }))
  return composeRoles(bindings)
}

// Kept for the callers that bind exactly one role. Composing a single binding
// is the identity operation, so this stays behaviour-preserving.
export function buildApplyPlan(deps: ApplyPlannerDeps, project: Project, roleId: number): ApplyPlan {
  return buildApplyPlanForRoles(deps, project, [{ roleId, origin: { kind: 'direct' }, priority: 0 }])
}

export function buildApplyPlanForRoles(
  deps: ApplyPlannerDeps,
  project: Project,
  refs: RoleBindingRef[]
): ApplyPlan {
  const composed = composeBindings(deps, refs)
  const previous = unionManagedStates(deps.history.listSinceLastSuccess(project.id))

  const settingsPath = settingsPathFor(project.path)
  const settingsBefore = readFileOrNull(settingsPath)
  const settingsResult = planSettings({
    currentSettings: readJsonObject(settingsBefore, settingsPath),
    rolePermissions: composed.permissions,
    previous
  })

  const mcpPath = path.join(project.path, '.mcp.json')
  const mcpBefore = readFileOrNull(mcpPath)
  const mcpResult = planMcp({
    currentMcpJson: readJsonObject(mcpBefore, mcpPath),
    roleServers: composed.mcpServers.map((server) => ({
      name: server.name,
      command: server.command,
      env: server.env
    })),
    previous
  })

  const origins: PlanOrigin[] = []
  const desired: DesiredEntry[] = []
  for (const skill of composed.skills) {
    desired.push({
      kind: 'link',
      path: `.claude/skills/${skill.name}`,
      target: skill.skillPath
    })
    origins.push({ kind: 'skill', name: skill.name, origin: skill.origin })
  }
  for (const agent of composed.agents) {
    if (agent.source === 'reference') {
      desired.push({ kind: 'link', path: `.claude/agents/${agent.name}.md`, target: agent.sourcePath })
    } else {
      desired.push({ kind: 'file', path: `.claude/agents/${agent.name}.md`, content: agent.markdownBody })
    }
    origins.push({ kind: 'agent', name: agent.name, origin: agent.origin })
  }
  for (const server of composed.mcpServers) {
    origins.push({ kind: 'mcpServer', name: server.name, origin: server.origin })
  }

  // Only planned when there is something to hide. A role with no skills,
  // agents or commands leaves no machine-local paths behind, so writing a
  // .gitignore would be skillam touching a file for no reason.
  if (desired.length > 0) {
    desired.push({ kind: 'file', path: GITIGNORE_RELATIVE_PATH, content: GITIGNORE_CONTENT })
  }

  // Refuse before planning any write: a tracked destination means a commit
  // would publish this machine's absolute paths to every other clone. The
  // .gitignore skillam writes is exempt — committing that one is harmless and
  // is in fact what a team would want.
  const trackedPaths = listTrackedPaths(project.path)
  if (trackedPaths.length > 0) {
    const collisions = [
      ...desired.filter((entry) => entry.path !== GITIGNORE_RELATIVE_PATH).map((entry) => entry.path),
      SETTINGS_RELATIVE_PATH
    ].filter((relativePath) => isTracked(trackedPaths, relativePath))
    if (collisions.length > 0) {
      throw new GitTrackedTargetError([...new Set(collisions)])
    }
  }

  const projectRoot = path.resolve(project.path)
  for (const entry of desired) {
    const resolved = path.resolve(projectRoot, entry.path)
    if (resolved !== projectRoot && !resolved.startsWith(projectRoot + path.sep)) {
      throw new MaterializeConflictError(
        `適用先がプロジェクト外を指しています: ${entry.path}。skillam はプロジェクトディレクトリの外には書き込みません。`
      )
    }
    if (entry.kind === 'link' && !fs.existsSync(entry.target)) {
      throw new MaterializeConflictError(
        `リンク先が存在しません: ${entry.target}（${entry.path} に配置予定）。ロールが参照している Skill / Agent が削除された可能性があります。`
      )
    }
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
    roleId: refs.length === 1 ? refs[0].roleId : null,
    origins,
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
