import type { FastifyPluginAsync } from 'fastify'
import type { RolesRepository } from '../roles/roles.repository.js'
import type { ScopesRepository } from './scopes.repository.js'
import type { ScopeRolesRepository } from './scope-roles.repository.js'

export interface ScopesRouteDeps {
  scopes: ScopesRepository
  scopeRoles: ScopeRolesRepository
  roles: RolesRepository
}

function readPath(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }
  const value = (body as { path?: unknown }).path
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function readRoleIds(body: unknown): number[] | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }
  const value = (body as { roleIds?: unknown }).roleIds
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'number')) {
    return undefined
  }
  return value as number[]
}

export const scopesRoutes: FastifyPluginAsync<ScopesRouteDeps> = async (app, deps) => {
  app.get('/scopes', async () => {
    return deps.scopes.list()
  })

  app.post<{ Body: { path: string } }>('/scopes', async (request, reply) => {
    const scopePath = readPath(request.body)
    if (!scopePath) {
      return reply.status(400).send({ error: 'path is required' })
    }
    // A scope is matched against absolute project paths, so a relative one
    // would never match. Rejecting it here beats storing a scope that
    // silently does nothing.
    if (!scopePath.startsWith('/')) {
      return reply.status(400).send({ error: 'path must be absolute' })
    }
    if (deps.scopes.getByPath(scopePath)) {
      return reply.status(409).send({ error: `scope ${scopePath} already exists` })
    }
    return reply.status(201).send(deps.scopes.create({ path: scopePath }))
  })

  app.get<{ Params: { id: string } }>('/scopes/:id', async (request, reply) => {
    const scope = deps.scopes.getById(Number(request.params.id))
    if (!scope) {
      return reply.status(404).send({ error: 'scope not found' })
    }
    return scope
  })

  // No update route: a scope is its path. Changing it would move every
  // binding to a different part of the filesystem at once, which reads as
  // deleting one scope and creating another — so that is what a caller does.
  app.delete<{ Params: { id: string } }>('/scopes/:id', async (request, reply) => {
    if (!deps.scopes.delete(Number(request.params.id))) {
      return reply.status(404).send({ error: 'scope not found' })
    }
    return reply.status(204).send()
  })

  app.get<{ Params: { id: string } }>('/scopes/:id/roles', async (request, reply) => {
    const id = Number(request.params.id)
    if (!deps.scopes.getById(id)) {
      return reply.status(404).send({ error: 'scope not found' })
    }
    return deps.scopeRoles.listForScope(id)
  })

  // What this scope currently reaches. A scope binds by path, so this is the
  // only way to see its blast radius before adding roles to it or deleting it.
  app.get<{ Params: { id: string } }>('/scopes/:id/projects', async (request, reply) => {
    const projects = deps.scopes.listProjectsForScope(Number(request.params.id))
    if (!projects) {
      return reply.status(404).send({ error: 'scope not found' })
    }
    return projects
  })

  app.put<{ Params: { id: string }; Body: { roleIds: number[] } }>(
    '/scopes/:id/roles',
    async (request, reply) => {
      const roleIds = readRoleIds(request.body)
      if (!roleIds) {
        return reply.status(400).send({ error: 'roleIds must be an array of numbers' })
      }
      const id = Number(request.params.id)
      if (!deps.scopes.getById(id)) {
        return reply.status(404).send({ error: 'scope not found' })
      }
      for (const roleId of roleIds) {
        if (!deps.roles.getById(roleId)) {
          return reply.status(400).send({ error: `role ${roleId} not found` })
        }
      }
      return deps.scopeRoles.replaceForScope(id, roleIds)
    }
  )
}
