import type { FastifyPluginAsync } from 'fastify'
import type { ProjectsRepository } from '../projects/projects.repository.js'
import type { RolesRepository } from '../roles/roles.repository.js'
import type { GroupsRepository } from './groups.repository.js'
import type { GroupRolesRepository } from './group-roles.repository.js'
import type { ProjectGroupsRepository } from './project-groups.repository.js'

export interface GroupsRouteDeps {
  groups: GroupsRepository
  groupRoles: GroupRolesRepository
  projectGroups: ProjectGroupsRepository
  projects: ProjectsRepository
  roles: RolesRepository
}

function readName(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }
  const name = (body as { name?: unknown }).name
  return typeof name === 'string' && name.trim() !== '' ? name : undefined
}

function readDescription(body: unknown): string | undefined | null {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }
  const description = (body as { description?: unknown }).description
  if (description === undefined) {
    return undefined
  }
  // null signals "present but not a string" so the caller can reject it
  // rather than silently storing something that is not a description.
  return typeof description === 'string' ? description : null
}

function readIdArray(body: unknown, field: string): number[] | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }
  const value = (body as Record<string, unknown>)[field]
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'number')) {
    return undefined
  }
  return value as number[]
}

export const groupsRoutes: FastifyPluginAsync<GroupsRouteDeps> = async (app, deps) => {
  app.get('/groups', async () => {
    return deps.groups.list()
  })

  app.post<{ Body: { name: string; description?: string } }>('/groups', async (request, reply) => {
    const name = readName(request.body)
    if (!name) {
      return reply.status(400).send({ error: 'name is required' })
    }
    const description = readDescription(request.body)
    if (description === null) {
      return reply.status(400).send({ error: 'description must be a string' })
    }
    if (deps.groups.list().some((group) => group.name === name)) {
      return reply.status(409).send({ error: `group ${name} already exists` })
    }
    return reply.status(201).send(deps.groups.create({ name, description }))
  })

  app.get<{ Params: { id: string } }>('/groups/:id', async (request, reply) => {
    const group = deps.groups.getById(Number(request.params.id))
    if (!group) {
      return reply.status(404).send({ error: 'group not found' })
    }
    return group
  })

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/groups/:id',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (!deps.groups.getById(id)) {
        return reply.status(404).send({ error: 'group not found' })
      }
      const body = request.body
      if (typeof body !== 'object' || body === null) {
        return reply.status(400).send({ error: 'invalid body' })
      }
      const rawName = (body as { name?: unknown }).name
      if (rawName !== undefined && (typeof rawName !== 'string' || rawName.trim() === '')) {
        return reply.status(400).send({ error: 'name must be a non-empty string' })
      }
      const description = readDescription(body)
      if (description === null) {
        return reply.status(400).send({ error: 'description must be a string' })
      }
      const name = typeof rawName === 'string' ? rawName : undefined
      if (name !== undefined && deps.groups.list().some((group) => group.name === name && group.id !== id)) {
        return reply.status(409).send({ error: `group ${name} already exists` })
      }
      return deps.groups.update(id, { name, description })
    }
  )

  // Deleting a group drops its memberships and role bindings with it (ON
  // DELETE CASCADE). Projects and roles survive — a group is a binding path,
  // not an owner of either end.
  app.delete<{ Params: { id: string } }>('/groups/:id', async (request, reply) => {
    if (!deps.groups.delete(Number(request.params.id))) {
      return reply.status(404).send({ error: 'group not found' })
    }
    return reply.status(204).send()
  })

  app.get<{ Params: { id: string } }>('/groups/:id/roles', async (request, reply) => {
    const id = Number(request.params.id)
    if (!deps.groups.getById(id)) {
      return reply.status(404).send({ error: 'group not found' })
    }
    return deps.groupRoles.listForGroup(id)
  })

  app.put<{ Params: { id: string }; Body: { roleIds: number[] } }>(
    '/groups/:id/roles',
    async (request, reply) => {
      const roleIds = readIdArray(request.body, 'roleIds')
      if (!roleIds) {
        return reply.status(400).send({ error: 'roleIds must be an array of numbers' })
      }
      const id = Number(request.params.id)
      if (!deps.groups.getById(id)) {
        return reply.status(404).send({ error: 'group not found' })
      }
      for (const roleId of roleIds) {
        if (!deps.roles.getById(roleId)) {
          return reply.status(400).send({ error: `role ${roleId} not found` })
        }
      }
      return deps.groupRoles.replaceForGroup(id, roleIds)
    }
  )

  app.get<{ Params: { id: string } }>('/groups/:id/projects', async (request, reply) => {
    const id = Number(request.params.id)
    if (!deps.groups.getById(id)) {
      return reply.status(404).send({ error: 'group not found' })
    }
    return deps.projectGroups.listForGroup(id)
  })

  app.get<{ Params: { id: string } }>('/projects/:id/groups', async (request, reply) => {
    const projectId = Number(request.params.id)
    if (!deps.projects.getById(projectId)) {
      return reply.status(404).send({ error: 'project not found' })
    }
    return deps.projectGroups.listForProject(projectId)
  })

  app.put<{ Params: { id: string }; Body: { groupIds: number[] } }>(
    '/projects/:id/groups',
    async (request, reply) => {
      const groupIds = readIdArray(request.body, 'groupIds')
      if (!groupIds) {
        return reply.status(400).send({ error: 'groupIds must be an array of numbers' })
      }
      const projectId = Number(request.params.id)
      if (!deps.projects.getById(projectId)) {
        return reply.status(404).send({ error: 'project not found' })
      }
      for (const groupId of groupIds) {
        if (!deps.groups.getById(groupId)) {
          return reply.status(400).send({ error: `group ${groupId} not found` })
        }
      }
      return deps.projectGroups.replaceForProject(projectId, groupIds)
    }
  )
}
