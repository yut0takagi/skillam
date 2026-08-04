import fs from 'node:fs'
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

  app.post<{
    Body: { path: string; name: string; autoDetected?: boolean; excluded?: boolean }
  }>('/projects', async (request, reply) => {
    if (!hasBody(request.body)) {
      return reply.status(400).send({ error: 'request body is required' })
    }
    const { path: projectPath, name, autoDetected, excluded } = request.body
    if (typeof projectPath !== 'string' || projectPath.trim() === '') {
      return reply.status(400).send({ error: 'path is required' })
    }
    if (typeof name !== 'string' || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' })
    }
    if (autoDetected !== undefined && typeof autoDetected !== 'boolean') {
      return reply.status(400).send({ error: 'autoDetected must be a boolean' })
    }
    if (excluded !== undefined && typeof excluded !== 'boolean') {
      return reply.status(400).send({ error: 'excluded must be a boolean' })
    }
    if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
      return reply.status(400).send({ error: 'path does not exist or is not a directory' })
    }
    // Canonicalize to the OS's real on-disk casing/symlink target so that
    // case-insensitive-but-case-preserving filesystems (e.g. macOS/APFS)
    // can't register the same directory twice under differently-cased
    // path strings. Safe here because existence was just confirmed above.
    const canonicalPath = fs.realpathSync.native(projectPath)
    const project = deps.projects.create({ path: canonicalPath, name, autoDetected, excluded })
    return reply.status(201).send(project)
  })

  app.get('/projects', async () => {
    return deps.projects.list()
  })

  app.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const project = deps.projects.getById(id)
    if (!project) {
      return reply.status(404).send({ error: 'project not found' })
    }
    return project
  })

  app.put<{ Params: { id: string }; Body: { name?: string; excluded?: boolean } }>(
    '/projects/:id',
    async (request, reply) => {
      if (!hasBody(request.body)) {
        return reply.status(400).send({ error: 'request body is required' })
      }
      const id = Number(request.params.id)
      const { name, excluded } = request.body
      if (name !== undefined && typeof name !== 'string') {
        return reply.status(400).send({ error: 'name must be a string' })
      }
      if (excluded !== undefined && typeof excluded !== 'boolean') {
        return reply.status(400).send({ error: 'excluded must be a boolean' })
      }
      const project = deps.projects.update(id, { name, excluded })
      if (!project) {
        return reply.status(404).send({ error: 'project not found' })
      }
      return project
    }
  )

  app.delete<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.projects.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'project not found' })
    }
    return reply.status(204).send()
  })
}
