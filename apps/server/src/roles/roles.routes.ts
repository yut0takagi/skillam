import type { FastifyPluginAsync } from 'fastify'
import { RolesRepository } from './roles.repository.js'
import { RoleSkillsRepository } from './role-skills.repository.js'
import type { RoleSkillInput } from './role-skills.types.js'
import { RoleMcpServersRepository } from './role-mcp-servers.repository.js'
import type { RoleMcpServerInput } from './role-mcp-servers.types.js'
import { RoleAgentsRepository } from './role-agents.repository.js'
import type { RoleAgentInput } from './role-agents.types.js'
import { RolePermissionsRepository } from './role-permissions.repository.js'
import { fromExportPayload, toExportPayload, RoleImportError, type RoleDetail } from './role-export.js'

export interface RolesRouteDeps {
  roles: RolesRepository
  skills: RoleSkillsRepository
  mcpServers: RoleMcpServersRepository
  agents: RoleAgentsRepository
  permissions: RolePermissionsRepository
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      (error as { code?: string }).code === 'SQLITE_CONSTRAINT')
  )
}

function hasBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null
}

function getRoleDetail(deps: RolesRouteDeps, id: number): RoleDetail | undefined {
  const role = deps.roles.getById(id)
  if (!role) {
    return undefined
  }
  return {
    ...role,
    skills: deps.skills.listForRole(id),
    mcpServers: deps.mcpServers.listForRole(id),
    agents: deps.agents.listForRole(id),
    permissions: deps.permissions.getForRole(id) ?? null
  }
}

export const rolesRoutes: FastifyPluginAsync<RolesRouteDeps> = async (app, deps) => {
  app.post<{ Body: { name: string; description?: string } }>('/roles', async (request, reply) => {
    if (!hasBody(request.body)) {
      return reply.status(400).send({ error: 'request body is required' })
    }
    const { name, description } = request.body
    if (typeof name !== 'string' || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' })
    }
    if (description !== undefined && typeof description !== 'string') {
      return reply.status(400).send({ error: 'description must be a string' })
    }
    try {
      const role = deps.roles.create({ name, description })
      return reply.status(201).send(role)
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ error: `a role named "${name}" already exists` })
      }
      throw error
    }
  })

  app.get('/roles', async () => {
    return deps.roles.list()
  })

  app.get<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const detail = getRoleDetail(deps, id)
    if (!detail) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return detail
  })

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/roles/:id',
    async (request, reply) => {
      if (!hasBody(request.body)) {
        return reply.status(400).send({ error: 'request body is required' })
      }
      const id = Number(request.params.id)
      const { name, description } = request.body
      if (name !== undefined && typeof name !== 'string') {
        return reply.status(400).send({ error: 'name must be a string' })
      }
      if (description !== undefined && typeof description !== 'string') {
        return reply.status(400).send({ error: 'description must be a string' })
      }
      try {
        const role = deps.roles.update(id, request.body)
        if (!role) {
          return reply.status(404).send({ error: 'role not found' })
        }
        return role
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return reply.status(409).send({ error: `a role named "${name}" already exists` })
        }
        throw error
      }
    }
  )

  app.delete<{ Params: { id: string } }>('/roles/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.roles.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return reply.status(204).send()
  })

  app.put<{ Params: { id: string }; Body: { skills: RoleSkillInput[] } }>(
    '/roles/:id/skills',
    async (request, reply) => {
      if (!hasBody(request.body)) {
        return reply.status(400).send({ error: 'request body is required' })
      }
      if (!Array.isArray(request.body.skills)) {
        return reply.status(400).send({ error: 'skills must be an array' })
      }
      const hasInvalidSkill = request.body.skills.some(
        (skill) => typeof skill?.skillSource !== 'string' || typeof skill?.skillPath !== 'string'
      )
      if (hasInvalidSkill) {
        return reply.status(400).send({ error: 'each skill must have a string skillSource and skillPath' })
      }
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.skills.replaceForRole(id, request.body.skills)
    }
  )

  app.put<{ Params: { id: string }; Body: { servers: RoleMcpServerInput[] } }>(
    '/roles/:id/mcp-servers',
    async (request, reply) => {
      if (!hasBody(request.body)) {
        return reply.status(400).send({ error: 'request body is required' })
      }
      if (!Array.isArray(request.body.servers)) {
        return reply.status(400).send({ error: 'servers must be an array' })
      }
      const hasInvalidServer = request.body.servers.some((server) => typeof server?.name !== 'string')
      if (hasInvalidServer) {
        return reply.status(400).send({ error: 'each mcp server must have a string name' })
      }
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.mcpServers.replaceForRole(id, request.body.servers)
    }
  )

  app.put<{ Params: { id: string }; Body: { agents: RoleAgentInput[] } }>(
    '/roles/:id/agents',
    async (request, reply) => {
      if (!hasBody(request.body)) {
        return reply.status(400).send({ error: 'request body is required' })
      }
      if (!Array.isArray(request.body.agents)) {
        return reply.status(400).send({ error: 'agents must be an array' })
      }
      const hasInvalidAgent = request.body.agents.some(
        (agent) =>
          typeof agent?.name !== 'string' ||
          typeof agent?.markdownBody !== 'string' ||
          typeof agent?.source !== 'string'
      )
      if (hasInvalidAgent) {
        return reply
          .status(400)
          .send({ error: 'each agent must have a string name, markdownBody, and source' })
      }
      const hasInvalidSourcePath = request.body.agents.some(
        (agent) =>
          (agent.sourcePath !== undefined && typeof agent.sourcePath !== 'string') ||
          (agent.source === 'reference' && (agent.sourcePath ?? '').trim() === '')
      )
      if (hasInvalidSourcePath) {
        return reply
          .status(400)
          .send({ error: 'an agent with source "reference" requires a non-empty sourcePath' })
      }
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.agents.replaceForRole(id, request.body.agents)
    }
  )

  app.put<{ Params: { id: string }; Body: { permissions: unknown } }>(
    '/roles/:id/permissions',
    async (request, reply) => {
      if (!hasBody(request.body)) {
        return reply.status(400).send({ error: 'request body is required' })
      }
      const id = Number(request.params.id)
      if (!deps.roles.getById(id)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return deps.permissions.setForRole(id, { permissions: request.body.permissions })
    }
  )

  app.get<{ Params: { id: string } }>('/roles/:id/export', async (request, reply) => {
    const id = Number(request.params.id)
    const detail = getRoleDetail(deps, id)
    if (!detail) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return toExportPayload(detail)
  })

  app.post<{ Body: unknown }>('/roles/import', async (request, reply) => {
    let parsed
    try {
      parsed = fromExportPayload(request.body)
    } catch (error) {
      if (error instanceof RoleImportError) {
        return reply.status(400).send({ error: error.message })
      }
      throw error
    }

    let role
    try {
      role = deps.roles.create({ name: parsed.name, description: parsed.description })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ error: `a role named "${parsed.name}" already exists` })
      }
      throw error
    }

    deps.skills.replaceForRole(role.id, parsed.skills)
    deps.mcpServers.replaceForRole(role.id, parsed.mcpServers)
    deps.agents.replaceForRole(role.id, parsed.agents)
    deps.permissions.setForRole(role.id, { permissions: parsed.permissions })

    const detail = getRoleDetail(deps, role.id)
    return reply.status(201).send(detail)
  })
}
