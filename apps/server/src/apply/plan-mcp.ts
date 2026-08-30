import { staleEntries, type ManagedState } from './managed-state.js'

export interface RoleMcpServerLike {
  name: string
  command: unknown
  env: Record<string, string>
}

export interface PlanMcpInput {
  currentMcpJson: Record<string, unknown>
  roleServers: RoleMcpServerLike[]
  previous: ManagedState
}

export interface PlanMcpResult {
  mcpJson: Record<string, unknown>
  managedServers: string[]
  // What skillam wrote for each of its own servers, so drift detection can
  // later tell a rewritten command from an intact one. Only skillam's servers
  // appear here: the user's hand-added entries stay out of the record, which
  // is what keeps them out of drift reports.
  //
  // env is recorded as its key names only, never its values. A role's env
  // value is NOT guaranteed to be a `secret_ref:` placeholder — only the
  // catalog import path runs extractSecretsFromEnv, so a server added
  // straight through PUT /roles/:id/mcp-servers still holds its raw value —
  // and this record lands in apply_history, which must never hold a
  // plaintext secret. Keys alone still catch an env entry being added or
  // removed, which is what drift detection compares.
  managedDefinitions: Record<string, unknown>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function planMcp(input: PlanMcpInput): PlanMcpResult {
  const currentServers =
    typeof input.currentMcpJson.mcpServers === 'object' && input.currentMcpJson.mcpServers !== null
      ? { ...(input.currentMcpJson.mcpServers as Record<string, unknown>) }
      : {}

  const roleNames = input.roleServers.map((server) => server.name)

  for (const name of staleEntries(input.previous.mcpServers, roleNames)) {
    delete currentServers[name]
  }

  const managedDefinitions: Record<string, unknown> = {}

  for (const server of input.roleServers) {
    const base =
      typeof server.command === 'string'
        ? { command: server.command }
        : typeof server.command === 'object' && server.command !== null
          ? { ...(server.command as Record<string, unknown>) }
          : {}
    // The role-level env intentionally wins over any env embedded in the command
    // object: it is the one that carries resolved secret_ref: placeholders.
    const definition =
      Object.keys(server.env).length > 0 ? { ...base, env: server.env } : base
    currentServers[server.name] = definition
    // structuredClone, not the same object: the caller resolves secret_ref:
    // placeholders into decrypted values on its way to disk, and sharing
    // structure with that would rewrite the record too.
    const recorded = structuredClone(base) as Record<string, unknown>
    // `base` carries an env of its own when command is an object, and that
    // one is raw too — drop it before recording rather than trusting it.
    const embeddedEnv = recorded.env
    delete recorded.env
    const envKeys = Object.keys(server.env).length > 0
      ? Object.keys(server.env)
      : isPlainObject(embeddedEnv)
        ? Object.keys(embeddedEnv)
        : []
    if (envKeys.length > 0) {
      recorded.envKeys = [...envKeys].sort()
    }
    managedDefinitions[server.name] = recorded
  }

  return {
    mcpJson: { ...input.currentMcpJson, mcpServers: currentServers },
    managedServers: roleNames,
    managedDefinitions
  }
}
