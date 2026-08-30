import os from 'node:os'
import path from 'node:path'
import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
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
import { ProjectRolesRepository } from './projects/project-roles.repository.js'
import { projectRolesRoutes } from './projects/project-roles.routes.js'
import type { KeychainClient } from './secrets/keychain-client.js'
import { KeychainAccessError } from './secrets/keychain-client.js'
import { MacKeychainClient } from './secrets/mac-keychain-client.js'
import { MasterKeyProvider } from './secrets/master-key-provider.js'
import { SecretsRepository } from './secrets/secrets.repository.js'
import { secretsRoutes } from './secrets/secrets.routes.js'
import { catalogRoutes } from './catalog/catalog.routes.js'
import { ApplyHistoryRepository } from './apply/apply-history.repository.js'
import { applyRoutes } from './apply/apply.routes.js'
import { driftRoutes } from './apply/drift.routes.js'

export interface CatalogRoots {
  userSkillsRoot?: string
  userAgentsRoot?: string
  pluginsCacheRoot?: string
  claudeJsonPath?: string
}

export type ResolvedCatalogRoots = Required<CatalogRoots>

// A path written in a shell profile is where a leading ~ is most natural, and
// the shell does not expand it inside a quoted assignment. Expanding it here
// keeps SKILLAM_USER_SKILLS_ROOT="~/custom/skills" from resolving to a
// directory literally named "~".
function expandHome(value: string): string {
  if (value === '~') {
    return os.homedir()
  }
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

// Precedence: explicit argument, then environment, then the default under the
// home directory. The argument has to win — it is how the tests point the
// scanners at temporary directories, and letting a stray variable in the
// developer's shell override it would make those tests read the real
// ~/.claude on the machine running them.
//
// An empty variable counts as unset. `export SKILLAM_USER_SKILLS_ROOT=` in a
// profile is how someone disables an override, and treating '' as a path
// would silently point the scan at the process's working directory.
function pick(explicit: string | undefined, envVar: string, fallback: string): string {
  if (explicit) {
    return explicit
  }
  const fromEnv = process.env[envVar]
  if (fromEnv) {
    return expandHome(fromEnv)
  }
  return fallback
}

export function resolveCatalogRoots(catalogRoots: CatalogRoots): ResolvedCatalogRoots {
  return {
    userSkillsRoot: pick(
      catalogRoots.userSkillsRoot,
      'SKILLAM_USER_SKILLS_ROOT',
      path.join(os.homedir(), '.claude', 'skills')
    ),
    userAgentsRoot: pick(
      catalogRoots.userAgentsRoot,
      'SKILLAM_USER_AGENTS_ROOT',
      path.join(os.homedir(), '.claude', 'agents')
    ),
    pluginsCacheRoot: pick(
      catalogRoots.pluginsCacheRoot,
      'SKILLAM_PLUGINS_CACHE_ROOT',
      path.join(os.homedir(), '.claude', 'plugins', 'cache')
    ),
    claudeJsonPath: pick(
      catalogRoots.claudeJsonPath,
      'SKILLAM_CLAUDE_JSON_PATH',
      path.join(os.homedir(), '.claude.json')
    )
  }
}

export function buildApp(
  db: Database.Database,
  keychainClient: KeychainClient = new MacKeychainClient(),
  catalogRoots: CatalogRoots = {}
): FastifyInstance {
  const app = Fastify({ logger: false })

  const { userSkillsRoot, userAgentsRoot, pluginsCacheRoot, claudeJsonPath } =
    resolveCatalogRoots(catalogRoots)

  app.register(cors, {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    // @fastify/cors v11 の methods 既定値は 'GET,HEAD,POST' のため、
    // 明示しないとブラウザからの PUT / DELETE がプリフライトで弾かれる。
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE']
  })

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

  app.register(projectRolesRoutes, {
    projects: new ProjectsRepository(db),
    projectRoles: new ProjectRolesRepository(db),
    roles: new RolesRepository(db)
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

  app.register(applyRoutes, {
    projects: new ProjectsRepository(db),
    roles: new RolesRepository(db),
    projectRoles: new ProjectRolesRepository(db),
    skills: new RoleSkillsRepository(db),
    agents: new RoleAgentsRepository(db),
    mcpServers: new RoleMcpServersRepository(db),
    permissions: new RolePermissionsRepository(db),
    history: new ApplyHistoryRepository(db),
    secrets: new SecretsRepository(db),
    masterKeyProvider: new MasterKeyProvider(keychainClient)
  })

  app.register(driftRoutes, {
    projects: new ProjectsRepository(db),
    history: new ApplyHistoryRepository(db)
  })

  return app
}
