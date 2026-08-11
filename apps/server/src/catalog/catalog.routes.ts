// apps/server/src/catalog/catalog.routes.ts
import type { FastifyPluginAsync } from 'fastify'
import type { ProjectsRepository } from '../projects/projects.repository.js'
import { scanSkills } from './skills-scanner.js'
import { scanAgents } from './agents-scanner.js'
import { scanPermissions } from './permissions-scanner.js'
import { scanMcpServers } from './mcp-servers-scanner.js'
import { extractSecretsFromEnv } from './secret-extraction.js'
import type { SecretsRepository } from '../secrets/secrets.repository.js'
import type { MasterKeyProvider } from '../secrets/master-key-provider.js'
import { encrypt } from '../secrets/secrets-cipher.js'

export interface CatalogRouteDeps {
  projects: ProjectsRepository
  secrets: SecretsRepository
  masterKeyProvider: MasterKeyProvider
  userSkillsRoot: string
  userAgentsRoot: string
  pluginsCacheRoot: string
  claudeJsonPath: string
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

  app.get('/catalog/mcp-servers', async () => {
    const projectPaths = deps.projects.list().map((p) => p.path)
    const rawServers = scanMcpServers({ claudeJsonPath: deps.claudeJsonPath, projectPaths })

    return rawServers.map((server) => {
      const command = server.command
      if (
        !command ||
        typeof command !== 'object' ||
        !('env' in command) ||
        !command.env ||
        typeof command.env !== 'object'
      ) {
        return server
      }
      const env = command.env as Record<string, string>
      const { sanitizedEnv, secretsToStore } = extractSecretsFromEnv(server.name, env)
      for (const secret of secretsToStore) {
        if (!deps.secrets.getByRefName(secret.refName)) {
          const key = deps.masterKeyProvider.getOrCreateKey()
          deps.secrets.create({
            refName: secret.refName,
            encryptedValue: encrypt(secret.value, key)
          })
        }
      }
      return { ...server, command: { ...command, env: sanitizedEnv } }
    })
  })
}
