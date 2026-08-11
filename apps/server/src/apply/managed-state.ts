export interface ManagedState {
  mcpServers: string[]
  materialized: string[]
  permissionAllow: string[]
  permissionDeny: string[]
}

export const EMPTY_MANAGED_STATE: ManagedState = Object.freeze({
  mcpServers: Object.freeze([]) as string[],
  materialized: Object.freeze([]) as string[],
  permissionAllow: Object.freeze([]) as string[],
  permissionDeny: Object.freeze([]) as string[]
})

function createEmptyManagedState(): ManagedState {
  return { mcpServers: [], materialized: [], permissionAllow: [], permissionDeny: [] }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

export function parseManagedState(json: string | null | undefined): ManagedState {
  if (!json) {
    return createEmptyManagedState()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return createEmptyManagedState()
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return createEmptyManagedState()
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
