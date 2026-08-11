import type { FastifyPluginAsync } from 'fastify'
import type { ProjectsRepository } from './projects.repository.js'
import type { ProjectRolesRepository } from './project-roles.repository.js'
import type { RolesRepository } from '../roles/roles.repository.js'

export interface ProjectRolesRouteDeps {
  projects: ProjectsRepository
  projectRoles: ProjectRolesRepository
  roles: RolesRepository
}

export const projectRolesRoutes: FastifyPluginAsync<ProjectRolesRouteDeps> = async (app, deps) => {
  app.get<{ Params: { id: string } }>('/projects/:id/roles', async (request, reply) => {
    const projectId = Number(request.params.id)
    if (!deps.projects.getById(projectId)) {
      return reply.status(404).send({ error: 'project not found' })
    }
    return deps.projectRoles.listForProject(projectId)
  })

  app.put<{ Params: { id: string }; Body: { roleIds: number[] } }>(
    '/projects/:id/roles',
    async (request, reply) => {
      const body = request.body
      if (typeof body !== 'object' || body === null || !Array.isArray(body.roleIds)) {
        return reply.status(400).send({ error: 'roleIds must be an array' })
      }
      const projectId = Number(request.params.id)
      if (!deps.projects.getById(projectId)) {
        return reply.status(404).send({ error: 'project not found' })
      }
      for (const roleId of body.roleIds) {
        if (typeof roleId !== 'number' || !deps.roles.getById(roleId)) {
          return reply.status(400).send({ error: `role ${roleId} not found` })
        }
      }
      return deps.projectRoles.replaceForProject(projectId, body.roleIds)
    }
  )
}
