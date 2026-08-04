import type { FastifyPluginAsync } from 'fastify'
import { AutoDetectRootsRepository } from './auto-detect-roots.repository.js'
import { ProjectsRepository } from './projects.repository.js'
import { scanForCandidates } from './scanner.js'

export interface ProjectsRouteDeps {
  autoDetectRoots: AutoDetectRootsRepository
  projects: ProjectsRepository
}

function hasBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null
}

export const projectsRoutes: FastifyPluginAsync<ProjectsRouteDeps> = async (app, deps) => {
  app.post<{ Body: { path: string } }>('/auto-detect-roots', async (request, reply) => {
    if (!hasBody(request.body)) {
      return reply.status(400).send({ error: 'request body is required' })
    }
    const { path: rootPath } = request.body
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      return reply.status(400).send({ error: 'path is required' })
    }
    const root = deps.autoDetectRoots.create({ path: rootPath })
    return reply.status(201).send(root)
  })

  app.get('/auto-detect-roots', async () => {
    return deps.autoDetectRoots.list()
  })

  app.delete<{ Params: { id: string } }>('/auto-detect-roots/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.autoDetectRoots.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'auto-detect root not found' })
    }
    return reply.status(204).send()
  })

  app.get('/projects/scan', async () => {
    const roots = deps.autoDetectRoots.list().map((root) => root.path)
    const knownPaths = deps.projects.listPaths()
    return scanForCandidates(roots, knownPaths)
  })
}
