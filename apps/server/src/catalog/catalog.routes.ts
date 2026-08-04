// apps/server/src/catalog/catalog.routes.ts
import type { FastifyPluginAsync } from 'fastify'
import type { ProjectsRepository } from '../projects/projects.repository.js'
import { scanSkills } from './skills-scanner.js'
import { scanAgents } from './agents-scanner.js'
import { scanPermissions } from './permissions-scanner.js'

export interface CatalogRouteDeps {
  projects: ProjectsRepository
  userSkillsRoot: string
  userAgentsRoot: string
  pluginsCacheRoot: string
}

export const catalogRoutes: FastifyPluginAsync<CatalogRouteDeps> = async (app, deps) => {
  app.get('/catalog/skills', async () => {
    const projectPaths = deps.projects.list().map((p) => p.path)
    return scanSkills({
      userSkillsRoot: deps.userSkillsRoot,
      pluginsCacheRoot: deps.pluginsCacheRoot,
      projectPaths
    })
  })

  app.get('/catalog/agents', async () => {
    const projectPaths = deps.projects.list().map((p) => p.path)
    return scanAgents({
      userAgentsRoot: deps.userAgentsRoot,
      pluginsCacheRoot: deps.pluginsCacheRoot,
      projectPaths
    })
  })

  app.get('/catalog/permissions', async () => {
    const projectPaths = deps.projects.list().map((p) => p.path)
    return scanPermissions({ projectPaths })
  })
}
