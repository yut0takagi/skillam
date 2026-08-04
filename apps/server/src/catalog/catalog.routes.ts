// apps/server/src/catalog/catalog.routes.ts
import os from 'node:os'
import path from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import type { ProjectsRepository } from '../projects/projects.repository.js'
import { scanSkills } from './skills-scanner.js'
import { scanAgents } from './agents-scanner.js'
import { scanPermissions } from './permissions-scanner.js'

export interface CatalogRouteDeps {
  projects: ProjectsRepository
}

const USER_SKILLS_ROOT = path.join(os.homedir(), '.claude', 'skills')
const USER_AGENTS_ROOT = path.join(os.homedir(), '.claude', 'agents')
const PLUGINS_CACHE_ROOT = path.join(os.homedir(), '.claude', 'plugins', 'cache')

export const catalogRoutes: FastifyPluginAsync<CatalogRouteDeps> = async (app, deps) => {
  app.get('/catalog/skills', async () => {
    const projectPaths = deps.projects.list().map((p) => p.path)
    return scanSkills({
      userSkillsRoot: USER_SKILLS_ROOT,
      pluginsCacheRoot: PLUGINS_CACHE_ROOT,
      projectPaths
    })
  })

  app.get('/catalog/agents', async () => {
    const projectPaths = deps.projects.list().map((p) => p.path)
    return scanAgents({
      userAgentsRoot: USER_AGENTS_ROOT,
      pluginsCacheRoot: PLUGINS_CACHE_ROOT,
      projectPaths
    })
  })

  app.get('/catalog/permissions', async () => {
    const projectPaths = deps.projects.list().map((p) => p.path)
    return scanPermissions({ projectPaths })
  })
}
