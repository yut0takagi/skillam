import type { ManagedState } from './managed-state.js'
import type { CurrentEntry } from './plan-materialize.js'

export type DriftKind =
  | 'permission-missing'
  | 'mcp-server-missing'
  | 'materialized-missing'
  | 'materialized-changed'
  | 'config-unreadable'

export interface DriftItem {
  kind: DriftKind
  target: string
  detail: string
}

export interface DetectDriftInput {
  managed: ManagedState
  settings: Record<string, unknown>
  mcpJson: Record<string, unknown>
  current: Record<string, CurrentEntry>
}

export interface DetectDriftResult {
  hasDrift: boolean
  items: DriftItem[]
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function readPermissionList(settings: Record<string, unknown>, key: 'allow' | 'deny'): string[] {
  const rawPermissions = settings.permissions
  if (typeof rawPermissions !== 'object' || rawPermissions === null) {
    return []
  }
  return readStringArray((rawPermissions as Record<string, unknown>)[key])
}

function readMcpServerNames(mcpJson: Record<string, unknown>): string[] {
  const rawServers = mcpJson.mcpServers
  if (typeof rawServers !== 'object' || rawServers === null) {
    return []
  }
  return Object.keys(rawServers as Record<string, unknown>)
}

function detectPermissionDrift(recorded: string[], present: string[]): DriftItem[] {
  const items: DriftItem[] = []
  for (const entry of recorded) {
    if (!present.includes(entry)) {
      items.push({
        kind: 'permission-missing',
        target: entry,
        detail: `skillam が追加した権限 "${entry}" が settings.json から消えています。`
      })
    }
  }
  return items
}

function detectMcpServerDrift(recorded: string[], present: string[]): DriftItem[] {
  const items: DriftItem[] = []
  for (const name of recorded) {
    if (!present.includes(name)) {
      items.push({
        kind: 'mcp-server-missing',
        target: name,
        detail: `skillam が追加した MCP サーバー "${name}" が .mcp.json から消えています。`
      })
    }
  }
  return items
}

// managed.materialized records only a path, not the kind (link vs file) it
// was written as: skill symlinks and authored agent files are both
// legitimate outcomes of a normal apply, and this record cannot tell them
// apart after the fact. So a materialized path currently reported as
// `link` or `file` is treated as fine either way; only two shapes count as
// drift: the path is gone entirely, or it has been replaced by something
// skillam never writes on its own (kind: 'other', e.g. a real directory
// standing where a symlink used to be — the exact Phase 3a bug this must
// not repeat).
function detectMaterializedDrift(recorded: string[], current: Record<string, CurrentEntry>): DriftItem[] {
  const items: DriftItem[] = []
  for (const targetPath of recorded) {
    const entry = current[targetPath]
    if (!entry) {
      items.push({
        kind: 'materialized-missing',
        target: targetPath,
        detail: `skillam が配置した "${targetPath}" が見つかりません。削除されたか移動された可能性があります。`
      })
      continue
    }
    if (entry.kind === 'other') {
      items.push({
        kind: 'materialized-changed',
        target: targetPath,
        detail: `skillam が配置した "${targetPath}" が別の種類のファイル/ディレクトリに置き換わっています。`
      })
    }
  }
  return items
}

export function detectDrift(input: DetectDriftInput): DetectDriftResult {
  const presentAllow = readPermissionList(input.settings, 'allow')
  const presentDeny = readPermissionList(input.settings, 'deny')
  const presentMcpServers = readMcpServerNames(input.mcpJson)

  const items: DriftItem[] = [
    ...detectPermissionDrift(input.managed.permissionAllow, presentAllow),
    ...detectPermissionDrift(input.managed.permissionDeny, presentDeny),
    ...detectMcpServerDrift(input.managed.mcpServers, presentMcpServers),
    ...detectMaterializedDrift(input.managed.materialized, input.current)
  ]

  return { hasDrift: items.length > 0, items }
}
