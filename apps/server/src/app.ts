import Fastify, { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { RolesRepository } from './roles/roles.repository.js'
import { rolesRoutes } from './roles/roles.routes.js'

export function buildApp(db: Database.Database): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    return { status: 'ok' }
  })

  app.register(rolesRoutes, {
    roles: new RolesRepository(db)
  })

  return app
}
