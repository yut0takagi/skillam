import type { FastifyPluginAsync } from 'fastify'
import { RolesRepository } from './roles.repository.js'

export interface RolesRouteDeps {
  roles: RolesRepository
}

export const rolesRoutes: FastifyPluginAsync<RolesRouteDeps> = async (app, deps) => {
  app.post<{ Body: { name: string; description?: string } }>('/roles', async (request, reply) => {
    const { name, description } = request.body
    if (!name || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' })
    }
    const role = deps.roles.create({ name, description })
    return reply.status(201).send(role)
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
    return role
  })

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/roles/:id',
    async (request, reply) => {
      const id = Number(request.params.id)
      const role = deps.roles.update(id, request.body)
      if (!role) {
        return reply.status(404).send({ error: 'role not found' })
      }
      return role
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
}
