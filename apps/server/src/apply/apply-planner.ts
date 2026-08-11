import fs from 'node:fs'
import path from 'node:path'
import type { Project } from '../projects/projects.types.js'
import type { RoleSkillsRepository } from '../roles/role-skills.repository.js'
import type { RoleAgentsRepository } from '../roles/role-agents.repository.js'
import type { RoleMcpServersRepository } from '../roles/role-mcp-servers.repository.js'
import type { RolePermissionsRepository } from '../roles/role-permissions.repository.js'
import type { ApplyHistoryRepository } from './apply-history.repository.js'
import { EMPTY_MANAGED_STATE, type ManagedState } from './managed-state.js'
import { planSettings, UnsupportedSettingsError, type RolePermissionsShape } from './plan-settings.js'
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

function parseJsonObject(raw: string | null, filePath: string): Record<string, unknown> {
  if (raw === null) {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new UnsupportedSettingsError(
      `${filePath} が JSON として読めません。skillam は解釈できないファイルを上書きしません。`
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UnsupportedSettingsError(
      `${filePath} の中身がオブジェクトではありません。skillam は解釈できないファイルを上書きしません。`
    )
  }
  return parsed as Record<string, unknown>
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
    currentSettings: parseJsonObject(settingsBefore, settingsPath),
    rolePermissions: toRolePermissions(deps.permissions.getForRole(roleId)?.permissions),
    previous
  })

  const mcpPath = path.join(project.path, '.mcp.json')
  const mcpBefore = readFileOrNull(mcpPath)
  const mcpResult = planMcp({
    currentMcpJson: parseJsonObject(mcpBefore, mcpPath),
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
