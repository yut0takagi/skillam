import type { ManagedState } from './managed-state.js'
import type { CurrentEntry } from './plan-materialize.js'

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

function readMcpServers(mcpJson: Record<string, unknown>): Record<string, unknown> {
  const rawServers = mcpJson.mcpServers
  if (typeof rawServers !== 'object' || rawServers === null) {
    return {}
  }
  return rawServers as Record<string, unknown>
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Structural equality with key order ignored. JSON.stringify would be shorter
// but treats `{a,b}` and `{b,a}` as different, and any tool that rewrites
// .mcp.json may reorder keys without changing meaning — reporting that as
// tampering would train users to ignore the warning.
function isSameValue(recorded: unknown, present: unknown): boolean {
  if (Array.isArray(recorded) || Array.isArray(present)) {
    if (!Array.isArray(recorded) || !Array.isArray(present) || recorded.length !== present.length) {
      return false
    }
    // Order matters inside an array: argv is positional.
    return recorded.every((entry, index) => isSameValue(entry, present[index]))
  }
  if (isPlainObject(recorded) || isPlainObject(present)) {
    if (!isPlainObject(recorded) || !isPlainObject(present)) {
      return false
    }
    const recordedKeys = Object.keys(recorded)
    if (recordedKeys.length !== Object.keys(present).length) {
      return false
    }
    return recordedKeys.every(
      (key) => key in present && isSameValue(recorded[key], present[key])
    )
  }
  return recorded === present
}

// env is compared by key set only. The record deliberately holds just the
// key names (`envKeys`) because a role's env values are not guaranteed to be
// `secret_ref:` placeholders and the record lands in apply_history — see
// plan-mcp.ts. Values on disk are also the *resolved* ones, so even a
// faithful record could not be compared against them without the master key,
// and drift detection is a read-only inspection that should not need it.
//
// The cost is explicit: a rewritten env *value* (a redirected endpoint, a
// loosened LOG_LEVEL) is not detected. A key being added or removed is.
function isSameEnvKeys(recordedKeys: string[], present: unknown): boolean {
  const presentKeys = isPlainObject(present) ? Object.keys(present) : []
  if (recordedKeys.length !== presentKeys.length) {
    return false
  }
  const sortedPresent = [...presentKeys].sort()
  return [...recordedKeys].sort().every((key, index) => key === sortedPresent[index])
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function changedFields(recorded: Record<string, unknown>, present: Record<string, unknown>): string[] {
  const changed: string[] = []

  if ('envKeys' in recorded || 'env' in present) {
    if (!isSameEnvKeys(readStringList(recorded.envKeys), present.env)) {
      changed.push('env')
    }
  }

  const fields = new Set([
    ...Object.keys(recorded).filter((field) => field !== 'envKeys'),
    ...Object.keys(present).filter((field) => field !== 'env')
  ])
  for (const field of fields) {
    if (!isSameValue(recorded[field], present[field])) {
      changed.push(field)
    }
  }
  return changed.sort()
}

// Only servers that skillam recorded a definition for are compared. A server
// the user added by hand is not skillam's business (the same promise the
// missing-server check keeps), and a history row from before definitions were
// recorded has nothing to compare against — such rows keep working and keep
// detecting removal, they just cannot report a rewrite.
function detectMcpDefinitionDrift(
  recorded: Record<string, unknown> | undefined,
  present: Record<string, unknown>
): DriftItem[] {
  if (!recorded) {
    return []
  }
  const items: DriftItem[] = []
  for (const [name, definition] of Object.entries(recorded)) {
    const onDisk = present[name]
    // Absent is already reported as mcp-server-missing. Adding a second item
    // for the same target would give one problem two diagnoses.
    if (onDisk === undefined) {
      continue
    }
    if (!isPlainObject(definition) || !isPlainObject(onDisk)) {
      if (!isSameValue(definition, onDisk)) {
        items.push({
          kind: 'mcp-server-changed',
          target: name,
          detail: `skillam が書いた MCP サーバー "${name}" の定義が .mcp.json で書き換えられています。`
        })
      }
      continue
    }
    const changed = changedFields(definition, onDisk)
    if (changed.length > 0) {
      items.push({
        kind: 'mcp-server-changed',
        target: name,
        detail: `skillam が書いた MCP サーバー "${name}" の定義が .mcp.json で書き換えられています（${changed.join(', ')}）。`
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
  const presentMcpDefinitions = readMcpServers(input.mcpJson)

  const items: DriftItem[] = [
    ...detectPermissionDrift(input.managed.permissionAllow, presentAllow),
    ...detectPermissionDrift(input.managed.permissionDeny, presentDeny),
    ...detectMcpServerDrift(input.managed.mcpServers, presentMcpServers),
    ...detectMcpDefinitionDrift(input.managed.mcpDefinitions, presentMcpDefinitions),
    ...detectMaterializedDrift(input.managed.materialized, input.current)
  ]

  return { hasDrift: items.length > 0, items }
}
