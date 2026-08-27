import type { Role } from './roles.types.js'
import type { RoleSkill, RoleSkillInput } from './role-skills.types.js'
import type { RoleMcpServer, RoleMcpServerInput } from './role-mcp-servers.types.js'
import type { RoleAgent, RoleAgentInput } from './role-agents.types.js'

export const ROLE_EXPORT_VERSION = 1

// The shape returned by GET /roles/:id today (roles.routes.ts's inline
// object). Kept local rather than imported so this module has no dependency
// on the routes file — export/import logic should not need the HTTP layer
// to compile.
export interface RoleDetail extends Role {
  skills: RoleSkill[]
  mcpServers: RoleMcpServer[]
  agents: RoleAgent[]
  permissions: { roleId: number; permissions: unknown } | null
}

export interface RoleExportPayload {
  skillamRoleVersion: number
  name: string
  description: string
  skills: RoleSkillInput[]
  mcpServers: RoleMcpServerInput[]
  agents: RoleAgentInput[]
  permissions: unknown
}

export interface ParsedRoleImport {
  name: string
  description: string
  skills: RoleSkillInput[]
  mcpServers: RoleMcpServerInput[]
  agents: RoleAgentInput[]
  permissions: unknown
}

export class RoleImportError extends Error {}

/**
 * Builds the exported JSON payload for a role.
 *
 * Deliberately does NOT touch the secrets table. `role.mcpServers[].env`
 * values are already `secret_ref:...` strings by the time they reach this
 * function (that is all the role_mcp_servers table ever stores) — this
 * function passes them through verbatim. Never resolve them here: doing so
 * would leak plaintext secrets into an exported file.
 */
export function toExportPayload(role: RoleDetail): RoleExportPayload {
  return {
    skillamRoleVersion: ROLE_EXPORT_VERSION,
    name: role.name,
    description: role.description,
    skills: role.skills.map((skill) => ({
      skillSource: skill.skillSource,
      skillPath: skill.skillPath
    })),
    mcpServers: role.mcpServers.map((server) => ({
      name: server.name,
      command: server.command,
      env: server.env
    })),
    agents: role.agents.map((agent) => ({
      name: agent.name,
      markdownBody: agent.markdownBody,
      source: agent.source,
      sourcePath: agent.sourcePath
    })),
    permissions: role.permissions?.permissions ?? null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parses and validates an untrusted export payload (e.g. read from a file
 * picked by the user). Throws RoleImportError on anything malformed.
 *
 * Does NOT validate that skillPath / sourcePath exist on this machine —
 * that is a known, inherent limitation of exporting a role (the Skill /
 * agent bodies live outside skillam, on whatever machine authored them).
 * Applying the imported role later is where a missing path surfaces, via
 * the existing "リンク先が存在しません" error.
 */
export function fromExportPayload(payload: unknown): ParsedRoleImport {
  if (!isRecord(payload)) {
    throw new RoleImportError('role export must be a JSON object')
  }

  if (payload.skillamRoleVersion !== ROLE_EXPORT_VERSION) {
    throw new RoleImportError(
      `unsupported skillamRoleVersion: ${JSON.stringify(payload.skillamRoleVersion)} (expected ${ROLE_EXPORT_VERSION})`
    )
  }

  if (typeof payload.name !== 'string' || payload.name.trim() === '') {
    throw new RoleImportError('role export is missing a name')
  }

  if (payload.description !== undefined && typeof payload.description !== 'string') {
    throw new RoleImportError('role export description must be a string')
  }

  const skills = Array.isArray(payload.skills) ? payload.skills : []
  for (const skill of skills) {
    if (!isRecord(skill) || typeof skill.skillSource !== 'string' || typeof skill.skillPath !== 'string') {
      throw new RoleImportError('each skill must have a string skillSource and skillPath')
    }
  }

  const mcpServers = Array.isArray(payload.mcpServers) ? payload.mcpServers : []
  for (const server of mcpServers) {
    if (!isRecord(server) || typeof server.name !== 'string') {
      throw new RoleImportError('each mcp server must have a string name')
    }
  }

  const agents = Array.isArray(payload.agents) ? payload.agents : []
  for (const agent of agents) {
    if (
      !isRecord(agent) ||
      typeof agent.name !== 'string' ||
      typeof agent.markdownBody !== 'string' ||
      typeof agent.source !== 'string'
    ) {
      throw new RoleImportError('each agent must have a string name, markdownBody, and source')
    }
  }

  return {
    name: payload.name,
    description: typeof payload.description === 'string' ? payload.description : '',
    skills: skills as RoleSkillInput[],
    mcpServers: mcpServers.map((server) => {
      const s = server as Record<string, unknown>
      return {
        name: s.name as string,
        command: s.command,
        env: isRecord(s.env) ? (s.env as Record<string, string>) : {}
      }
    }),
    agents: agents.map((agent) => {
      const a = agent as Record<string, unknown>
      return {
        name: a.name as string,
        markdownBody: a.markdownBody as string,
        source: a.source as RoleAgentInput['source'],
        sourcePath: typeof a.sourcePath === 'string' ? a.sourcePath : undefined
      }
    }),
    permissions: payload.permissions ?? null
  }
}
