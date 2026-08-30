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

describe('apply routes — bound roles', () => {
  let db: Database.Database
  let app: FastifyInstance
  let scratchRoot: string
  let projectPath: string
  let projectId: number

  beforeEach(async () => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-bound-roles-test-')))
    projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })
    app = buildApp(db, new InMemoryKeychainClient())

    projectId = (
      await app.inject({ method: 'POST', url: '/projects', payload: { path: projectPath, name: 'p' } })
    ).json().id
  })

  afterEach(async () => {
    await app.close()
    db.close()
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  async function createRole(name: string, allow: string[]): Promise<number> {
    const id = (await app.inject({ method: 'POST', url: '/roles', payload: { name } })).json().id
    await app.inject({
      method: 'PUT',
      url: `/roles/${id}/permissions`,
      payload: { permissions: { allow } }
    })
    return id
  }

  // Without a roleId the preview has to fall back to what the project is bound
  // to. project_roles has always been able to hold several rows; before this it
  // held them and nothing read them.
  it('previews every role bound to the project when no roleId is given', async () => {
    const first = await createRole('team', ['Read(*)'])
    const second = await createRole('personal', ['Edit'])
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [first, second] }
    })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(200)
    const settings = JSON.parse(response.json().settingsFile.after)
    expect(settings.permissions.allow).toContain('Read(*)')
    expect(settings.permissions.allow).toContain('Edit')
  })

  it('still honours an explicit roleId over the bound roles', async () => {
    const bound = await createRole('bound', ['Read(*)'])
    const explicit = await createRole('explicit', ['Edit'])
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [bound] }
    })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: { roleId: explicit }
    })

    const settings = JSON.parse(response.json().settingsFile.after)
    expect(settings.permissions.allow).toContain('Edit')
    expect(settings.permissions.allow).not.toContain('Read(*)')
  })

  it('reports 400 when the project has no bound roles and no roleId is given', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  it('reports 409 when two bound roles disagree on the same name', async () => {
    const first = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'a' } })).json().id
    const second = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'b' } })).json().id
    const one = path.join(scratchRoot, 'one', 'playwright')
    const two = path.join(scratchRoot, 'two', 'playwright')
    for (const dir of [one, two]) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '# playwright\n')
    }
    new RoleSkillsRepository(db).replaceForRole(first, [{ skillSource: 'user', skillPath: one }])
    new RoleSkillsRepository(db).replaceForRole(second, [{ skillSource: 'user', skillPath: two }])
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [first, second] }
    })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toContain('playwright')
  })
  // A history row's role_id names the role that was applied. With several
  // bindings there is no single such role, and naming the first would make the
  // history claim an apply that never happened that way. The column is already
  // nullable; null is the honest value.
  it('records no single role in history when several roles were composed', async () => {
    const first = await createRole('team', ['Read(*)'])
    const second = await createRole('personal', ['Edit'])
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [first, second] }
    })

    const applied = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply`,
      payload: {}
    })
    expect(applied.statusCode).toBe(200)

    const history = new ApplyHistoryRepository(db).listForProject(projectId)
    expect(history[0].roleId).toBeNull()
  })

  it('still records the role when exactly one was applied', async () => {
    const only = await createRole('solo', ['Edit'])
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [only] }
    })

    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: {} })

    const history = new ApplyHistoryRepository(db).listForProject(projectId)
    expect(history[0].roleId).toBe(only)
  })
})

// 段階2: roles now reach a project through the groups it belongs to, not only
// through project_roles. composeRoles already understood group origins; these
// cover the resolution step that feeds them to it.
describe('apply routes — group bindings', () => {
  let db: Database.Database
  let app: FastifyInstance
  let scratchRoot: string
  let projectPath: string
  let projectId: number

  beforeEach(async () => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-apply-groups-test-')))
    projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })
    app = buildApp(db, new InMemoryKeychainClient())
    projectId = (
      await app.inject({ method: 'POST', url: '/projects', payload: { path: projectPath, name: 'p' } })
    ).json().id
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  async function createRole(name: string, permissions: { allow?: string[]; deny?: string[] }): Promise<number> {
    const id = (await app.inject({ method: 'POST', url: '/roles', payload: { name } })).json().id
    await app.inject({ method: 'PUT', url: `/roles/${id}/permissions`, payload: { permissions } })
    return id
  }

  async function createGroup(name: string, roleIds: number[]): Promise<number> {
    const id = (await app.inject({ method: 'POST', url: '/groups', payload: { name } })).json().id
    await app.inject({ method: 'PUT', url: `/groups/${id}/roles`, payload: { roleIds } })
    return id
  }

  async function joinGroups(groupIds: number[]): Promise<void> {
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/groups`, payload: { groupIds } })
  }

  it('applies a role bound through a group the project belongs to', async () => {
    const roleId = await createRole('ts', { allow: ['Read(*)'] })
    const groupId = await createGroup('typescript', [roleId])
    await joinGroups([groupId])

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.json().settingsFile.after).permissions.allow).toContain('Read(*)')
  })

  it('combines group roles with the project’s direct roles', async () => {
    const groupRole = await createRole('ts', { allow: ['Read(*)'] })
    const directRole = await createRole('personal', { allow: ['Edit'] })
    const groupId = await createGroup('typescript', [groupRole])
    await joinGroups([groupId])
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [directRole] }
    })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    const allow = JSON.parse(response.json().settingsFile.after).permissions.allow
    expect(allow).toContain('Read(*)')
    expect(allow).toContain('Edit')
  })

  it('collects roles from every group the project belongs to', async () => {
    const first = await createRole('ts', { allow: ['Read(*)'] })
    const second = await createRole('py', { allow: ['Edit'] })
    await joinGroups([await createGroup('typescript', [first]), await createGroup('python', [second])])

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    const allow = JSON.parse(response.json().settingsFile.after).permissions.allow
    expect(allow).toContain('Read(*)')
    expect(allow).toContain('Edit')
  })

  // The point of the whole precedence design: a group-level deny outranks a
  // directly-bound allow, so an org-wide restriction cannot be undone by
  // binding a personal role to the project.
  it('lets a group deny override an allow from a direct role', async () => {
    const groupRole = await createRole('company', { deny: ['Bash(rm -rf*)'] })
    const directRole = await createRole('personal', { allow: ['Bash(rm -rf*)', 'Read(*)'] })
    await joinGroups([await createGroup('company', [groupRole])])
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [directRole] }
    })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    const settings = JSON.parse(response.json().settingsFile.after)
    expect(settings.permissions.allow).not.toContain('Bash(rm -rf*)')
    expect(settings.permissions.allow).toContain('Read(*)')
    expect(settings.permissions.deny).toContain('Bash(rm -rf*)')
  })

  it('reports the group as the origin of a skill it contributed', async () => {
    const roleId = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'ts' } })).json().id
    const skillDir = path.join(scratchRoot, 'skills', 'playwright')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# playwright\n')
    new RoleSkillsRepository(db).replaceForRole(roleId, [{ skillSource: 'user', skillPath: skillDir }])
    await joinGroups([await createGroup('typescript', [roleId])])

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.json().origins).toContainEqual({
      kind: 'skill',
      name: 'playwright',
      origin: { kind: 'group', name: 'typescript' }
    })
  })

  it('reports 409 when a group role and a direct role disagree on the same name', async () => {
    const groupRole = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'a' } })).json().id
    const directRole = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'b' } })).json().id
    const one = path.join(scratchRoot, 'one', 'playwright')
    const two = path.join(scratchRoot, 'two', 'playwright')
    for (const dir of [one, two]) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '# playwright\n')
    }
    const skills = new RoleSkillsRepository(db)
    skills.replaceForRole(groupRole, [{ skillSource: 'user', skillPath: one }])
    skills.replaceForRole(directRole, [{ skillSource: 'user', skillPath: two }])
    await joinGroups([await createGroup('typescript', [groupRole])])
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [directRole] }
    })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toContain('playwright')
  })

  // An explicit roleId is how the UI previews one role in isolation. Group
  // membership must not leak into that preview, or it would show more than the
  // role being examined.
  it('ignores group roles when an explicit roleId is given', async () => {
    const groupRole = await createRole('ts', { allow: ['Read(*)'] })
    const explicit = await createRole('explicit', { allow: ['Edit'] })
    await joinGroups([await createGroup('typescript', [groupRole])])

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: { roleId: explicit }
    })

    const allow = JSON.parse(response.json().settingsFile.after).permissions.allow
    expect(allow).toContain('Edit')
    expect(allow).not.toContain('Read(*)')
  })

  it('reports 400 when the project’s only group has no roles', async () => {
    await joinGroups([await createGroup('empty', [])])

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  // Leaving a group has to actually withdraw what it granted; otherwise a
  // membership change looks applied but the permission stays on disk.
  it('stops applying a group’s role once the project leaves the group', async () => {
    const roleId = await createRole('ts', { allow: ['Read(*)'] })
    const groupId = await createGroup('typescript', [roleId])
    await joinGroups([groupId])
    await joinGroups([])

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  // projects.last_applied_role_id and apply_history.role_id name a role the
  // project is directly bound to. A role that only arrived through a group is
  // not one, and recording it there would claim a direct binding that does not
  // exist — the same class of lie as naming one role out of a composed set.
  it('records no role when the only binding came through a group', async () => {
    const roleId = await createRole('ts', { allow: ['Read(*)'] })
    await joinGroups([await createGroup('typescript', [roleId])])

    const applied = await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: {} })
    expect(applied.statusCode).toBe(200)

    expect(new ApplyHistoryRepository(db).listForProject(projectId)[0].roleId).toBeNull()
    expect(new ProjectsRepository(db).getById(projectId)?.lastAppliedRoleId).toBeNull()
  })

  it('still records the role when a single direct binding was applied', async () => {
    const roleId = await createRole('solo', { allow: ['Edit'] })
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [roleId] }
    })

    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: {} })

    expect(new ApplyHistoryRepository(db).listForProject(projectId)[0].roleId).toBe(roleId)
  })

  // Composition is a union, so a role reaching the project both directly and
  // through a group must contribute once rather than colliding with itself.
  it('applies a role bound both directly and through a group without conflict', async () => {
    const roleId = await createRole('shared', { allow: ['Read(*)'] })
    await joinGroups([await createGroup('typescript', [roleId])])
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [roleId] }
    })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.json().settingsFile.after).permissions.allow).toEqual(['Read(*)'])
  })
})

// 段階3: roles also reach a project because of where it sits on disk. Scopes
// match by path prefix, so a project acquires them by being placed under one.
describe('apply routes — scope bindings', () => {
  let db: Database.Database
  let app: FastifyInstance
  let scratchRoot: string

  beforeEach(async () => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-apply-scopes-test-')))
    app = buildApp(db, new InMemoryKeychainClient())
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  async function createProjectAt(relativePath: string): Promise<number> {
    const projectPath = path.join(scratchRoot, relativePath)
    fs.mkdirSync(projectPath, { recursive: true })
    return (
      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: path.basename(relativePath) }
      })
    ).json().id
  }

  async function createRole(name: string, permissions: { allow?: string[]; deny?: string[] }): Promise<number> {
    const id = (await app.inject({ method: 'POST', url: '/roles', payload: { name } })).json().id
    await app.inject({ method: 'PUT', url: `/roles/${id}/permissions`, payload: { permissions } })
    return id
  }

  async function createScope(relativePath: string, roleIds: number[]): Promise<number> {
    const scopePath = path.join(scratchRoot, relativePath)
    fs.mkdirSync(scopePath, { recursive: true })
    const id = (await app.inject({ method: 'POST', url: '/scopes', payload: { path: scopePath } })).json().id
    await app.inject({ method: 'PUT', url: `/scopes/${id}/roles`, payload: { roleIds } })
    return id
  }

  it('applies a role bound to a scope containing the project', async () => {
    const roleId = await createRole('company', { allow: ['Read(*)'] })
    await createScope('work', [roleId])
    const projectId = await createProjectAt(path.join('work', 'app'))

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.json().settingsFile.after).permissions.allow).toContain('Read(*)')
  })

  // The prefix trap, end to end: a project in "workspace" must not pick up the
  // scope registered for "work".
  it('does not apply a scope to a sibling directory sharing its prefix', async () => {
    const roleId = await createRole('company', { allow: ['Read(*)'] })
    await createScope('work', [roleId])
    const projectId = await createProjectAt(path.join('workspace', 'app'))

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  it('combines scope, group and direct bindings', async () => {
    const scopeRole = await createRole('company', { allow: ['Read(*)'] })
    const groupRole = await createRole('ts', { allow: ['Edit'] })
    const directRole = await createRole('personal', { allow: ['Write'] })
    await createScope('work', [scopeRole])
    const projectId = await createProjectAt(path.join('work', 'app'))

    const groupId = (await app.inject({ method: 'POST', url: '/groups', payload: { name: 'typescript' } })).json().id
    await app.inject({ method: 'PUT', url: `/groups/${groupId}/roles`, payload: { roleIds: [groupRole] } })
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/groups`, payload: { groupIds: [groupId] } })
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/roles`, payload: { roleIds: [directRole] } })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    const allow = JSON.parse(response.json().settingsFile.after).permissions.allow
    expect(allow).toContain('Read(*)')
    expect(allow).toContain('Edit')
    expect(allow).toContain('Write')
  })

  // The reason deny outranks precedence at all: an org-wide rule set on a
  // directory tree cannot be undone by binding a personal role to one project
  // inside it.
  it('lets a scope deny override an allow from a direct role', async () => {
    const scopeRole = await createRole('company', { deny: ['Bash(rm -rf*)'] })
    const directRole = await createRole('personal', { allow: ['Bash(rm -rf*)', 'Read(*)'] })
    await createScope('work', [scopeRole])
    const projectId = await createProjectAt(path.join('work', 'app'))
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/roles`, payload: { roleIds: [directRole] } })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    const settings = JSON.parse(response.json().settingsFile.after)
    expect(settings.permissions.allow).not.toContain('Bash(rm -rf*)')
    expect(settings.permissions.allow).toContain('Read(*)')
    expect(settings.permissions.deny).toContain('Bash(rm -rf*)')
  })

  it('applies every scope containing the project', async () => {
    const outer = await createRole('outer', { allow: ['Read(*)'] })
    const inner = await createRole('inner', { allow: ['Edit'] })
    await createScope('work', [outer])
    await createScope(path.join('work', 'team'), [inner])
    const projectId = await createProjectAt(path.join('work', 'team', 'app'))

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    const allow = JSON.parse(response.json().settingsFile.after).permissions.allow
    expect(allow).toContain('Read(*)')
    expect(allow).toContain('Edit')
  })

  it('reports the scope as the origin of a skill it contributed', async () => {
    const roleId = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'company' } })).json().id
    const skillDir = path.join(scratchRoot, 'skills', 'drawio')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# drawio\n')
    new RoleSkillsRepository(db).replaceForRole(roleId, [{ skillSource: 'user', skillPath: skillDir }])
    const scopePath = path.join(scratchRoot, 'work')
    await createScope('work', [roleId])
    const projectId = await createProjectAt(path.join('work', 'app'))

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.json().origins).toContainEqual({
      kind: 'skill',
      name: 'drawio',
      origin: { kind: 'scope', path: scopePath }
    })
  })

  it('ignores scope roles when an explicit roleId is given', async () => {
    const scopeRole = await createRole('company', { allow: ['Read(*)'] })
    const explicit = await createRole('explicit', { allow: ['Edit'] })
    await createScope('work', [scopeRole])
    const projectId = await createProjectAt(path.join('work', 'app'))

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: { roleId: explicit }
    })

    const allow = JSON.parse(response.json().settingsFile.after).permissions.allow
    expect(allow).toContain('Edit')
    expect(allow).not.toContain('Read(*)')
  })

  // A scope binding is not a direct one, so the same rule that kept groups out
  // of last_applied_role_id applies here.
  it('records no role when the only binding came through a scope', async () => {
    const roleId = await createRole('company', { allow: ['Read(*)'] })
    await createScope('work', [roleId])
    const projectId = await createProjectAt(path.join('work', 'app'))

    const applied = await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: {} })
    expect(applied.statusCode).toBe(200)

    expect(new ApplyHistoryRepository(db).listForProject(projectId)[0].roleId).toBeNull()
    expect(new ProjectsRepository(db).getById(projectId)?.lastAppliedRoleId).toBeNull()
  })

  it('stops applying a scope’s role once the scope is deleted', async () => {
    const roleId = await createRole('company', { allow: ['Read(*)'] })
    const scopeId = await createScope('work', [roleId])
    const projectId = await createProjectAt(path.join('work', 'app'))

    await app.inject({ method: 'DELETE', url: `/scopes/${scopeId}` })

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/apply/preview`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })
})
