import Fastify, { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { RolesRepository } from './roles/roles.repository.js'
import { rolesRoutes } from './roles/roles.routes.js'
import { RoleSkillsRepository } from './roles/role-skills.repository.js'
import { RoleMcpServersRepository } from './roles/role-mcp-servers.repository.js'
import { RoleAgentsRepository } from './roles/role-agents.repository.js'
import { RolePermissionsRepository } from './roles/role-permissions.repository.js'

export function buildApp(db: Database.Database): FastifyInstance {
  const app = Fastify({ logger: false })

  app.setErrorHandler((error, _request, reply) => {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
      return reply.status(400).send({ error: 'invalid request: violates a database constraint' })
    }
    const statusCode = (error as { statusCode?: unknown }).statusCode
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const message = (error as { message?: unknown }).message
      return reply.status(statusCode).send({ error: typeof message === 'string' ? message : 'bad request' })
    }
    return reply.status(500).send({ error: 'internal server error' })
  })

  app.get('/health', async () => {
    return { status: 'ok' }
  })

  app.register(rolesRoutes, {
    roles: new RolesRepository(db),
    skills: new RoleSkillsRepository(db),
    mcpServers: new RoleMcpServersRepository(db),
    agents: new RoleAgentsRepository(db),
    permissions: new RolePermissionsRepository(db)
  })

  return app
}
