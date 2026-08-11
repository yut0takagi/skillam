import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from '../roles/roles.repository.js'
import { RoleSkillsRepository } from '../roles/role-skills.repository.js'
import { RoleAgentsRepository } from '../roles/role-agents.repository.js'
import { RoleMcpServersRepository } from '../roles/role-mcp-servers.repository.js'
import { RolePermissionsRepository } from '../roles/role-permissions.repository.js'
import { ProjectsRepository } from '../projects/projects.repository.js'
import { ApplyHistoryRepository } from './apply-history.repository.js'
import { UnsupportedSettingsError } from './plan-settings.js'
import { MaterializeConflictError } from './plan-materialize.js'
import { buildApplyPlan } from './apply-planner.js'
import type { ApplyPlannerDeps } from './apply-planner.js'
import { EMPTY_MANAGED_STATE } from './managed-state.js'

describe('buildApplyPlan', () => {
  let db: Database.Database
  let deps: ApplyPlannerDeps
  let scratchRoot: string
  let projectPath: string
  let roleId: number

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-planner-test-')))
    projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })

    deps = {
      skills: new RoleSkillsRepository(db),
      agents: new RoleAgentsRepository(db),
      mcpServers: new RoleMcpServersRepository(db),
      permissions: new RolePermissionsRepository(db),
      history: new ApplyHistoryRepository(db)
    }

    roleId = new RolesRepository(db).create({ name: 'dev' }).id
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  function project() {
    return new ProjectsRepository(db).create({ path: projectPath, name: 'project' })
  }

  it('plans settings.json from scratch when the project has no .claude directory', () => {
    new RolePermissionsRepository(db).setForRole(roleId, { permissions: { allow: ['Edit'] } })

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(plan.settingsFile.path).toBe(path.join(projectPath, '.claude', 'settings.json'))
    expect(plan.settingsFile.before).toBeNull()
    expect(JSON.parse(plan.settingsFile.after)).toEqual({ permissions: { allow: ['Edit'] } })
  })

  it('preserves the existing settings.json content it does not manage', () => {
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ language: 'ja', permissions: { allow: ['Bash(git:*)'] } })
    )
    new RolePermissionsRepository(db).setForRole(roleId, { permissions: { allow: ['Edit'] } })

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(JSON.parse(plan.settingsFile.after)).toEqual({
      language: 'ja',
      permissions: { allow: ['Bash(git:*)', 'Edit'] }
    })
  })

  it('refuses to plan against a settings.json that is not valid JSON', () => {
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.json'), '{ broken')
    const created = project()

    expect(() => buildApplyPlan(deps, created, roleId)).toThrow(UnsupportedSettingsError)
  })

  it('plans a skill symlink named after the skill directory', () => {
    const skillPath = path.join(scratchRoot, 'user-skills', 'drawio')
    fs.mkdirSync(skillPath, { recursive: true })
    new RoleSkillsRepository(db).replaceForRole(roleId, [{ skillSource: 'user', skillPath }])

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(plan.operations).toEqual([
      {
        type: 'create-link',
        path: path.join(projectPath, '.claude', 'skills', 'drawio'),
        target: skillPath
      }
    ])
    expect(plan.managed.materialized).toEqual(['.claude/skills/drawio'])
  })

  it('plans a link for a reference agent and a file write for an authored agent', () => {
    const agentPath = path.join(scratchRoot, 'user-agents', 'reviewer.md')
    fs.mkdirSync(path.dirname(agentPath), { recursive: true })
    fs.writeFileSync(agentPath, '# reviewer')
    new RoleAgentsRepository(db).replaceForRole(roleId, [
      { name: 'reviewer', markdownBody: '', source: 'reference', sourcePath: agentPath },
      { name: 'writer', markdownBody: '# writer', source: 'authored' }
    ])

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(plan.operations).toEqual([
      {
        type: 'create-link',
        path: path.join(projectPath, '.claude', 'agents', 'reviewer.md'),
        target: agentPath
      },
      {
        type: 'write-file',
        path: path.join(projectPath, '.claude', 'agents', 'writer.md'),
        content: '# writer'
      }
    ])
  })

  it('keeps secret_ref placeholders in the previewed .mcp.json', () => {
    new RoleMcpServersRepository(db).replaceForRole(roleId, [
      { name: 'github', command: { command: 'npx' }, env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } }
    ])

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(plan.mcpFile.after).toContain('secret_ref:mcp:github:TOKEN')
    expect(plan.mcpAfterObject.mcpServers).toEqual({
      github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } }
    })
  })

  it('uses the managed state of the last successful apply to plan removals', () => {
    const createdProject = project()
    deps.history.record({
      projectId: createdProject.id,
      roleId,
      diff: {},
      managed: {
        mcpServers: ['playwright'],
        materialized: [],
        permissionAllow: [],
        permissionDeny: []
      },
      status: 'success'
    })
    fs.writeFileSync(
      path.join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { playwright: { command: 'npx' } } })
    )

    const plan = buildApplyPlan(deps, createdProject, roleId)

    expect(plan.mcpAfterObject.mcpServers).toEqual({})
  })

  it('produces an unchanged plan when the project already matches the role', () => {
    fs.writeFileSync(
      path.join(projectPath, '.mcp.json'),
      `${JSON.stringify({ mcpServers: { github: { command: 'npx' } } }, null, 2)}\n`
    )
    new RoleMcpServersRepository(db).replaceForRole(roleId, [
      { name: 'github', command: { command: 'npx' }, env: {} }
    ])

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(plan.mcpFile.after).toBe(plan.mcpFile.before)
    expect(plan.operations).toEqual([])
  })

  it('refuses to overwrite a real directory that skillam never managed with a skill link', () => {
    const skillDir = path.join(projectPath, '.claude', 'skills', 'drawio')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'note.txt'), 'hand-written')

    const skillPath = path.join(scratchRoot, 'user-skills', 'drawio')
    fs.mkdirSync(skillPath, { recursive: true })
    new RoleSkillsRepository(db).replaceForRole(roleId, [{ skillSource: 'user', skillPath }])

    expect(() => buildApplyPlan(deps, project(), roleId)).toThrow(MaterializeConflictError)

    expect(fs.existsSync(skillDir)).toBe(true)
    expect(fs.readFileSync(path.join(skillDir, 'note.txt'), 'utf-8')).toBe('hand-written')
  })

  it('refuses to plan an agent path that escapes the project directory', () => {
    new RoleAgentsRepository(db).replaceForRole(roleId, [
      { name: '../../../escaped', markdownBody: '# oops', source: 'authored' }
    ])

    expect(() => buildApplyPlan(deps, project(), roleId)).toThrow(MaterializeConflictError)
  })

  it('refuses to plan a skill link whose target no longer exists on disk', () => {
    const skillPath = path.join(scratchRoot, 'user-skills', 'deleted-skill')
    new RoleSkillsRepository(db).replaceForRole(roleId, [{ skillSource: 'user', skillPath }])

    expect(() => buildApplyPlan(deps, project(), roleId)).toThrow(MaterializeConflictError)
  })

  it('refuses to plan a reference agent link whose target no longer exists on disk', () => {
    const agentPath = path.join(scratchRoot, 'user-agents', 'deleted-agent.md')
    new RoleAgentsRepository(db).replaceForRole(roleId, [
      { name: 'reviewer', markdownBody: '', source: 'reference', sourcePath: agentPath }
    ])

    expect(() => buildApplyPlan(deps, project(), roleId)).toThrow(MaterializeConflictError)
  })

  it('treats paths from a failed attempt since the last success as already managed, unblocking retry', () => {
    const createdProject = project()
    deps.history.record({
      projectId: createdProject.id,
      roleId,
      diff: {},
      managed: EMPTY_MANAGED_STATE,
      status: 'success'
    })
    deps.history.record({
      projectId: createdProject.id,
      roleId,
      diff: {},
      managed: { ...EMPTY_MANAGED_STATE, materialized: ['.claude/skills/drawio'] },
      status: 'failed',
      errorMessage: 'boom'
    })

    const skillPath = path.join(scratchRoot, 'user-skills', 'drawio')
    fs.mkdirSync(skillPath, { recursive: true })
    new RoleSkillsRepository(db).replaceForRole(roleId, [{ skillSource: 'user', skillPath }])

    // Simulate a partial write the failed attempt left behind: a plain file
    // where a symlink is desired, so it does not yet match the role's plan
    // and can only be recognized as skillam's own by the failed history row.
    fs.mkdirSync(path.join(projectPath, '.claude', 'skills'), { recursive: true })
    fs.writeFileSync(path.join(projectPath, '.claude', 'skills', 'drawio'), 'partial write')

    const plan = buildApplyPlan(deps, createdProject, roleId)

    expect(plan.operations).toEqual([
      {
        type: 'create-link',
        path: path.join(projectPath, '.claude', 'skills', 'drawio'),
        target: skillPath
      }
    ])
    expect(plan.managed.materialized).toEqual(['.claude/skills/drawio'])
  })

  it('refuses to plan two skills whose basenames collide on the same destination path', () => {
    const userSkillPath = path.join(scratchRoot, 'user-skills', 'review')
    const projectSkillPath = path.join(scratchRoot, 'project-skills', 'review')
    fs.mkdirSync(userSkillPath, { recursive: true })
    fs.mkdirSync(projectSkillPath, { recursive: true })
    new RoleSkillsRepository(db).replaceForRole(roleId, [
      { skillSource: 'user', skillPath: userSkillPath },
      { skillSource: 'project-local', skillPath: projectSkillPath }
    ])

    expect(() => buildApplyPlan(deps, project(), roleId)).toThrow(MaterializeConflictError)
  })
})
