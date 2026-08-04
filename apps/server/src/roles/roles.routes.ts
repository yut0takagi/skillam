import type { FastifyPluginAsync } from 'fastify'
import { RolesRepository } from './roles.repository.js'
import { RoleSkillsRepository } from './role-skills.repository.js'
import type { RoleSkillInput } from './role-skills.types.js'
import { RoleMcpServersRepository } from './role-mcp-servers.repository.js'
import type { RoleMcpServerInput } from './role-mcp-servers.types.js'
import { RoleAgentsRepository } from './role-agents.repository.js'
import type { RoleAgentInput } from './role-agents.types.js'
import { RolePermissionsRepository } from './role-permissions.repository.js'

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

export const rolesRoutes: FastifyPluginAsync<RolesRouteDeps> = async (app, deps) => {
  app.post<{ Body: { name: string; description?: string } }>('/roles', async (request, reply) => {
    if (!hasBody(request.body)) {
      return reply.status(400).send({ error: 'request body is required' })
    }
    const { name, description } = request.body
    if (typeof name !== 'string' || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' })
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
    const role = deps.roles.getById(id)
    if (!role) {
      return reply.status(404).send({ error: 'role not found' })
    }
    return {
      ...role,
      skills: deps.skills.listForRole(id),
      mcpServers: deps.mcpServers.listForRole(id),
      agents: deps.agents.listForRole(id),
      permissions: deps.permissions.getForRole(id) ?? null
    }
  })

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/roles/:id',
    async (request, reply) => {
      if (!hasBody(request.body)) {
        return reply.status(400).send({ error: 'request body is required' })
      }
      const id = Number(request.params.id)
      const { name } = request.body
      if (name !== undefined && typeof name !== 'string') {
        return reply.status(400).send({ error: 'name must be a string' })
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
}
