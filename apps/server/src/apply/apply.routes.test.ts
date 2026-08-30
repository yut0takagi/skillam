import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'
import { InMemoryKeychainClient } from '../secrets/in-memory-keychain-client.js'
import { RolesRepository } from '../roles/roles.repository.js'
import { RoleSkillsRepository } from '../roles/role-skills.repository.js'
import { RoleAgentsRepository } from '../roles/role-agents.repository.js'
import { RoleMcpServersRepository } from '../roles/role-mcp-servers.repository.js'
import { RolePermissionsRepository } from '../roles/role-permissions.repository.js'
import { ProjectsRepository } from '../projects/projects.repository.js'
import { SecretsRepository } from '../secrets/secrets.repository.js'
import { MasterKeyProvider } from '../secrets/master-key-provider.js'
import { ApplyHistoryRepository } from './apply-history.repository.js'
import { applyRoutes } from './apply.routes.js'
import type { ApplyHistoryEntry, RecordApplyInput } from './apply-history.types.js'

describe('apply routes', () => {
  let db: Database.Database
  let app: FastifyInstance
  let scratchRoot: string
  let projectPath: string
  let projectId: number
  let roleId: number

  beforeEach(async () => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-apply-routes-test-')))
    projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })
    app = buildApp(db, new InMemoryKeychainClient())

    projectId = (
      await app.inject({ method: 'POST', url: '/projects', payload: { path: projectPath, name: 'p' } })
    ).json().id
    roleId = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dev' } })).json().id
    await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/permissions`,
      payload: { permissions: { allow: ['Edit'] } }
    })
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  it('previews without writing anything to disk', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: { roleId }
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.json().settingsFile.after)).toEqual({ permissions: { allow: ['Edit'] } })
    expect(fs.existsSync(path.join(projectPath, '.claude', 'settings.local.json'))).toBe(false)
  })

  it('returns 404 when previewing an unknown project', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/projects/9999/apply/preview',
      payload: { roleId }
    })

    expect(response.statusCode).toBe(404)
  })

  it('returns 404 when previewing an unknown role', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: { roleId: 9999 }
    })

    expect(response.statusCode).toBe(404)
  })

  it('returns 400 when roleId is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  it('writes the files on apply and records a successful history entry', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply`,
      payload: { roleId }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('success')
    expect(
      JSON.parse(fs.readFileSync(path.join(projectPath, '.claude', 'settings.local.json'), 'utf-8'))
    ).toEqual({ permissions: { allow: ['Edit'] } })

    const history = await app.inject({ method: 'GET', url: `/projects/${projectId}/apply-history` })
    expect(history.json()).toEqual([
      expect.objectContaining({ status: 'success', roleId, errorMessage: '' })
    ])
  })

  it('never returns a resolved secret value in the response, even though the file on disk holds it', async () => {
    await app.inject({ method: 'POST', url: '/secrets', payload: { refName: 'mcp:github:TOKEN', value: 'sh-super-secret' } })
    await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/mcp-servers`,
      payload: {
        servers: [
          { name: 'github', command: { command: 'npx' }, env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } }
        ]
      }
    })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply`,
      payload: { roleId }
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.stringify(response.json())
    expect(body).not.toContain('sh-super-secret')
    expect(response.json().plan.mcpFile.after).toContain('secret_ref:mcp:github:TOKEN')
    expect(response.json().plan.mcpAfterObject.mcpServers.github.env.TOKEN).toBe('secret_ref:mcp:github:TOKEN')

    const mcpOnDisk = JSON.parse(fs.readFileSync(path.join(projectPath, '.mcp.json'), 'utf-8'))
    expect(mcpOnDisk.mcpServers.github.env.TOKEN).toBe('sh-super-secret')
  })

  it('records the applied role on the project', async () => {
    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })

    const project = await app.inject({ method: 'GET', url: `/projects/${projectId}` })
    expect(project.json().lastAppliedRoleId).toBe(roleId)
  })

  it('removes on re-apply only what the previous apply added', async () => {
    await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/mcp-servers`,
      payload: { servers: [{ name: 'playwright', command: { command: 'npx' } }] }
    })
    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })

    const mcpPath = path.join(projectPath, '.mcp.json')
    const withManual = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'))
    withManual.mcpServers.mine = { command: 'node' }
    fs.writeFileSync(mcpPath, `${JSON.stringify(withManual, null, 2)}\n`)

    await app.inject({ method: 'PUT', url: `/roles/${roleId}/mcp-servers`, payload: { servers: [] } })
    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })

    expect(JSON.parse(fs.readFileSync(mcpPath, 'utf-8')).mcpServers).toEqual({ mine: { command: 'node' } })
  })

  it('records a failed history entry when a secret reference cannot be resolved', async () => {
    await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/mcp-servers`,
      payload: {
        servers: [
          { name: 'github', command: { command: 'npx' }, env: { TOKEN: 'secret_ref:mcp:github:GONE' } }
        ]
      }
    })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply`,
      payload: { roleId }
    })

    expect(response.statusCode).toBe(500)
    expect(response.json().error).toContain('mcp:github:GONE')

    const history = await app.inject({ method: 'GET', url: `/projects/${projectId}/apply-history` })
    expect(history.json()[0]).toEqual(
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('mcp:github:GONE') })
    )
  })

  it('returns 409 and records no history when the project has a conflicting file', async () => {
    const skillPath = path.join(scratchRoot, 'skills', 'drawio')
    fs.mkdirSync(skillPath, { recursive: true })
    await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/skills`,
      payload: { skills: [{ skillSource: 'user', skillPath }] }
    })
    const conflicting = path.join(projectPath, '.claude', 'skills', 'drawio')
    fs.mkdirSync(conflicting, { recursive: true })
    fs.writeFileSync(path.join(conflicting, 'MINE.md'), '# mine')

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply`,
      payload: { roleId }
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toContain('drawio')
    expect(fs.readFileSync(path.join(conflicting, 'MINE.md'), 'utf-8')).toBe('# mine')

    const history = await app.inject({ method: 'GET', url: `/projects/${projectId}/apply-history` })
    expect(history.json()).toEqual([])
  })

  it('returns 409 from preview when the settings file cannot be parsed', async () => {
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.local.json'), '{ broken')

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: { roleId }
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toContain('settings.local.json')
    expect(fs.readFileSync(path.join(projectPath, '.claude', 'settings.local.json'), 'utf-8')).toBe('{ broken')
  })

  it('returns an empty history for a project that was never applied', async () => {
    const response = await app.inject({ method: 'GET', url: `/projects/${projectId}/apply-history` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })

  it('returns 404 for the history of an unknown project', async () => {
    const response = await app.inject({ method: 'GET', url: '/projects/9999/apply-history' })

    expect(response.statusCode).toBe(404)
  })
})

// The route plugin under test is registered by `buildApp` with a hard-coded
// `new ApplyHistoryRepository(db)` and no seam to substitute it afterwards,
// so exercising a history-recording failure means bypassing `buildApp` and
// registering `applyRoutes` directly on a bare Fastify instance, reusing the
// real repositories for everything except the one dependency under test.
class ThrowsOnStatusHistoryRepository extends ApplyHistoryRepository {
  constructor(
    db: Database.Database,
    private readonly statusToThrowOn: 'success' | 'failed',
    private readonly failureMessage: string
  ) {
    super(db)
  }

  record(input: RecordApplyInput): ApplyHistoryEntry {
    if (input.status === this.statusToThrowOn) {
      throw new Error(this.failureMessage)
    }
    return super.record(input)
  }
}

describe('apply route: history recording fails after a successful write', () => {
  it('reports the disk/history divergence and leaves no history row, even though the files are on disk', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const scratchRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-apply-history-fail-test-'))
    )
    const projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })

    const projects = new ProjectsRepository(db)
    const roles = new RolesRepository(db)
    const permissions = new RolePermissionsRepository(db)

    const project = projects.create({ path: projectPath, name: 'p' })
    const role = roles.create({ name: 'dev' })
    permissions.setForRole(role.id, { permissions: { allow: ['Edit'] } })

    const app = Fastify({ logger: false })
    app.register(applyRoutes, {
      projects,
      roles,
      skills: new RoleSkillsRepository(db),
      agents: new RoleAgentsRepository(db),
      mcpServers: new RoleMcpServersRepository(db),
      permissions,
      history: new ThrowsOnStatusHistoryRepository(db, 'success', 'disk is full'),
      secrets: new SecretsRepository(db),
      masterKeyProvider: new MasterKeyProvider(new InMemoryKeychainClient())
    })

    try {
      const response = await app.inject({
        method: 'POST',
        url: `/projects/${project.id}/apply`,
        payload: { roleId: role.id }
      })

      expect(
        JSON.parse(fs.readFileSync(path.join(projectPath, '.claude', 'settings.local.json'), 'utf-8'))
      ).toEqual({ permissions: { allow: ['Edit'] } })

      expect(response.statusCode).toBe(500)
      expect(response.json().error).toBe(
        '適用はファイルに書き込まれましたが、履歴の記録に失敗しました: disk is full'
      )

      const history = await app.inject({
        method: 'GET',
        url: `/projects/${project.id}/apply-history`
      })
      expect(history.json()).toEqual([])
    } finally {
      fs.rmSync(scratchRoot, { recursive: true, force: true })
    }
  })
})

describe('apply route: history recording also fails after a failed write', () => {
  it('reports both the apply error and the record error, and leaves no history row', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const scratchRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-apply-double-fail-test-'))
    )
    const projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })

    const projects = new ProjectsRepository(db)
    const roles = new RolesRepository(db)
    const mcpServers = new RoleMcpServersRepository(db)

    const project = projects.create({ path: projectPath, name: 'p' })
    const role = roles.create({ name: 'dev' })
    mcpServers.replaceForRole(role.id, [
      { name: 'github', command: { command: 'npx' }, env: { TOKEN: 'secret_ref:mcp:github:GONE' } }
    ])

    const app = Fastify({ logger: false })
    app.register(applyRoutes, {
      projects,
      roles,
      skills: new RoleSkillsRepository(db),
      agents: new RoleAgentsRepository(db),
      mcpServers,
      permissions: new RolePermissionsRepository(db),
      history: new ThrowsOnStatusHistoryRepository(db, 'failed', 'sqlite is locked'),
      secrets: new SecretsRepository(db),
      masterKeyProvider: new MasterKeyProvider(new InMemoryKeychainClient())
    })

    try {
      const response = await app.inject({
        method: 'POST',
        url: `/projects/${project.id}/apply`,
        payload: { roleId: role.id }
      })

      expect(response.statusCode).toBe(500)
      expect(response.json().error).toBe(
        '適用に失敗し、その記録も残せませんでした: シークレット参照が解決できません: mcp:github:GONE / sqlite is locked'
      )

      const history = await app.inject({
        method: 'GET',
        url: `/projects/${project.id}/apply-history`
      })
      expect(history.json()).toEqual([])
    } finally {
      fs.rmSync(scratchRoot, { recursive: true, force: true })
    }
  })
})
