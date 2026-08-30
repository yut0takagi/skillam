export interface ManagedState {
  mcpServers: string[]
  // The server definitions as they were planned, keyed by server name, so
  // drift detection can tell "someone rewrote the command" from "the server
  // is still listed". `mcpServers` alone only ever supported the latter.
  //
  // These are the definitions *before* secret_ref: resolution. Two reasons:
  // the record must never hold a plaintext secret, and the role side has
  // already replaced every real value with a `secret_ref:` placeholder
  // (see catalog/secret-extraction.ts), so the pre-resolution object is
  // both the safe one and the one we already have.
  //
  // Absent on history rows written before this field existed. Those rows
  // must stay readable — drift detection walks back through history — so
  // this is optional and its absence means "no definition to compare",
  // not "the definition was empty".
  mcpDefinitions?: Record<string, unknown>
  materialized: string[]
  permissionAllow: string[]
  permissionDeny: string[]
}

export const EMPTY_MANAGED_STATE: ManagedState = Object.freeze({
  mcpServers: Object.freeze([]) as unknown as string[],
  materialized: Object.freeze([]) as unknown as string[],
  permissionAllow: Object.freeze([]) as unknown as string[],
  permissionDeny: Object.freeze([]) as unknown as string[]
})

function createEmptyManagedState(): ManagedState {
  return { mcpServers: [], materialized: [], permissionAllow: [], permissionDeny: [] }
}

function readDefinitions(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return { ...(value as Record<string, unknown>) }
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
  const state: ManagedState = {
    mcpServers: readStringArray(source.mcpServers),
    materialized: readStringArray(source.materialized),
    permissionAllow: readStringArray(source.permissionAllow),
    permissionDeny: readStringArray(source.permissionDeny)
  }
  const definitions = readDefinitions(source.mcpDefinitions)
  if (definitions) {
    state.mcpDefinitions = definitions
  }
  return state
}

export function serializeManagedState(state: ManagedState): string {
  return JSON.stringify(state)
}

export function staleEntries(previouslyManaged: string[], desired: string[]): string[] {
  return previouslyManaged.filter((entry) => !desired.includes(entry))
}
