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
