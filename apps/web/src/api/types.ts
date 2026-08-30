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

export interface ScanCandidate {
  path: string
  name: string
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

// Where a role reached this project from. An item can arrive without anyone
// having chosen it for this project specifically, so the preview names the
// path it came through.
export type BindingOrigin =
  | { kind: 'scope'; path: string }
  | { kind: 'group'; name: string }
  | { kind: 'direct' }

export interface PlanOrigin {
  kind: 'skill' | 'agent' | 'mcpServer'
  name: string
  origin: BindingOrigin
}

export interface SuppressedAllow {
  entry: string
  deniedBy: BindingOrigin
}

export interface ApplyPlan {
  projectId: number
  projectPath: string
  // null when several bindings were composed, or when the only binding came
  // through a group or scope rather than a direct assignment.
  roleId: number | null
  origins: PlanOrigin[]
  suppressedAllow: SuppressedAllow[]
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

export type DriftKind =
  | 'permission-missing'
  | 'mcp-server-missing'
  | 'mcp-server-changed'
  | 'materialized-missing'
  | 'materialized-changed'
  | 'config-unreadable'

export interface DriftItem {
  kind: DriftKind
  target: string
  detail: string
}

export interface DriftReport {
  projectId: number
  projectPath: string
  hasDrift: boolean
  items: DriftItem[]
  lastAppliedAt: string | null
}

export interface RoleExportPayload {
  skillamRoleVersion: number
  name: string
  description: string
  skills: Array<{ skillSource: string; skillPath: string }>
  mcpServers: Array<{ name: string; command: unknown; env: Record<string, string> }>
  agents: Array<{ name: string; markdownBody: string; source: string; sourcePath?: string }>
  permissions: unknown
}

export interface Group {
  id: number
  name: string
  description: string
  createdAt: string
}

export interface GroupRole {
  roleId: number
  priority: number
}

export interface Scope {
  id: number
  path: string
  createdAt: string
}

export interface ScopeRole {
  roleId: number
  priority: number
}
