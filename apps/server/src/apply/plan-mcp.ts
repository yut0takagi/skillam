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

  for (const server of input.roleServers) {
    const base =
      typeof server.command === 'string'
        ? { command: server.command }
        : typeof server.command === 'object' && server.command !== null
          ? { ...(server.command as Record<string, unknown>) }
          : {}
    // The role-level env intentionally wins over any env embedded in the command
    // object: it is the one that carries resolved secret_ref: placeholders.
    currentServers[server.name] =
      Object.keys(server.env).length > 0 ? { ...base, env: server.env } : base
  }

  return {
    mcpJson: { ...input.currentMcpJson, mcpServers: currentServers },
    managedServers: roleNames
  }
}
