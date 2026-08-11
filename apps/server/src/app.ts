import os from 'node:os'
import path from 'node:path'
import Fastify, { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { RolesRepository } from './roles/roles.repository.js'
import { rolesRoutes } from './roles/roles.routes.js'
import { RoleSkillsRepository } from './roles/role-skills.repository.js'
import { RoleMcpServersRepository } from './roles/role-mcp-servers.repository.js'
import { RoleAgentsRepository } from './roles/role-agents.repository.js'
import { RolePermissionsRepository } from './roles/role-permissions.repository.js'
import { AutoDetectRootsRepository } from './projects/auto-detect-roots.repository.js'
import { ProjectsRepository } from './projects/projects.repository.js'
import { projectsRoutes } from './projects/projects.routes.js'
import type { KeychainClient } from './secrets/keychain-client.js'
import { KeychainAccessError } from './secrets/keychain-client.js'
import { MacKeychainClient } from './secrets/mac-keychain-client.js'
import { MasterKeyProvider } from './secrets/master-key-provider.js'
import { SecretsRepository } from './secrets/secrets.repository.js'
import { secretsRoutes } from './secrets/secrets.routes.js'
import { catalogRoutes } from './catalog/catalog.routes.js'

export interface CatalogRoots {
  userSkillsRoot?: string
  userAgentsRoot?: string
  pluginsCacheRoot?: string
  claudeJsonPath?: string
}

export function buildApp(
  db: Database.Database,
  keychainClient: KeychainClient = new MacKeychainClient(),
  catalogRoots: CatalogRoots = {}
): FastifyInstance {
  const app = Fastify({ logger: false })

  const userSkillsRoot = catalogRoots.userSkillsRoot ?? path.join(os.homedir(), '.claude', 'skills')
  const userAgentsRoot = catalogRoots.userAgentsRoot ?? path.join(os.homedir(), '.claude', 'agents')
  const pluginsCacheRoot = catalogRoots.pluginsCacheRoot ?? path.join(os.homedir(), '.claude', 'plugins', 'cache')
  const claudeJsonPath = catalogRoots.claudeJsonPath ?? path.join(os.homedir(), '.claude.json')

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof KeychainAccessError) {
      return reply
        .status(503)
        .send({ error: 'キーチェーンにアクセスできません。ターミナルのアクセス許可を確認してください。' })
    }
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
      return reply.status(400).send({ error: 'invalid request: violates a database constraint' })
    }
    const statusCode = (error as { statusCode?: unknown }).statusCode
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const message = (error as { message?: unknown }).message
      return reply.status(statusCode).send({ error: typeof message === 'string' ? message : 'bad request' })
    }
    return reply.status(500).send({ error: 'internal server error' })
  })

  app.get('/health', async () => {
    return { status: 'ok' }
  })

  app.register(rolesRoutes, {
    roles: new RolesRepository(db),
    skills: new RoleSkillsRepository(db),
    mcpServers: new RoleMcpServersRepository(db),
    agents: new RoleAgentsRepository(db),
    permissions: new RolePermissionsRepository(db)
  })

  app.register(projectsRoutes, {
    autoDetectRoots: new AutoDetectRootsRepository(db),
    projects: new ProjectsRepository(db)
  })

  app.register(secretsRoutes, {
    secrets: new SecretsRepository(db),
    masterKeyProvider: new MasterKeyProvider(keychainClient)
  })

  app.register(catalogRoutes, {
    projects: new ProjectsRepository(db),
    secrets: new SecretsRepository(db),
    masterKeyProvider: new MasterKeyProvider(keychainClient),
    userSkillsRoot,
    userAgentsRoot,
    pluginsCacheRoot,
    claudeJsonPath
  })

  return app
}
