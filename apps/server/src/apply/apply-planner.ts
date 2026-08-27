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
import { readFileOrNull, readJsonObject, readCurrentEntry } from './project-state.js'

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

export function buildApplyPlan(deps: ApplyPlannerDeps, project: Project, roleId: number): ApplyPlan {
  const previous = unionManagedStates(deps.history.listSinceLastSuccess(project.id))

  const settingsPath = path.join(project.path, '.claude', 'settings.json')
  const settingsBefore = readFileOrNull(settingsPath)
  const settingsResult = planSettings({
    currentSettings: readJsonObject(settingsBefore, settingsPath),
    rolePermissions: toRolePermissions(deps.permissions.getForRole(roleId)?.permissions),
    previous
  })

  const mcpPath = path.join(project.path, '.mcp.json')
  const mcpBefore = readFileOrNull(mcpPath)
  const mcpResult = planMcp({
    currentMcpJson: readJsonObject(mcpBefore, mcpPath),
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
