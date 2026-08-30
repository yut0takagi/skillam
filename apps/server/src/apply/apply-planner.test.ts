import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
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
import { GitTrackedTargetError } from './git-tracked.js'
import { buildApplyPlan, buildApplyPlanForRoles } from './apply-planner.js'
import { RoleCompositionConflictError } from './compose-roles.js'
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

  it('plans settings.local.json from scratch when the project has no .claude directory', () => {
    new RolePermissionsRepository(db).setForRole(roleId, { permissions: { allow: ['Edit'] } })

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(plan.settingsFile.path).toBe(path.join(projectPath, '.claude', 'settings.local.json'))
    expect(plan.settingsFile.before).toBeNull()
    expect(JSON.parse(plan.settingsFile.after)).toEqual({ permissions: { allow: ['Edit'] } })
  })

  it('preserves the existing settings.local.json content it does not manage', () => {
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.local.json'),
      JSON.stringify({ language: 'ja', permissions: { allow: ['Bash(git:*)'] } })
    )
    new RolePermissionsRepository(db).setForRole(roleId, { permissions: { allow: ['Edit'] } })

    const plan = buildApplyPlan(deps, project(), roleId)

    expect(JSON.parse(plan.settingsFile.after)).toEqual({
      language: 'ja',
      permissions: { allow: ['Bash(git:*)', 'Edit'] }
    })
  })

  it('refuses to plan against a settings.local.json that is not valid JSON', () => {
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.local.json'), '{ broken')
    const created = project()

    expect(() => buildApplyPlan(deps, created, roleId)).toThrow(UnsupportedSettingsError)
  })

  it('plans a skill symlink named after the skill directory', () => {
    const skillPath = path.join(scratchRoot, 'user-skills', 'drawio')
    fs.mkdirSync(skillPath, { recursive: true })
    new RoleSkillsRepository(db).replaceForRole(roleId, [{ skillSource: 'user', skillPath }])

    const plan = buildApplyPlan(deps, project(), roleId)

    // .gitignore is planned alongside anything materialized and is asserted
    // on its own in the git-safe writes block; exclude it here so this test
    // keeps testing the skill link.
    expect(plan.operations.filter((op) => !op.path.endsWith('.gitignore'))).toEqual([
      {
        type: 'create-link',
        path: path.join(projectPath, '.claude', 'skills', 'drawio'),
        target: skillPath
      }
    ])
    expect(plan.managed.materialized).toContain('.claude/skills/drawio')
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

    expect(plan.operations.filter((op) => !op.path.endsWith('.gitignore'))).toEqual([
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

    expect(plan.operations.filter((op) => !op.path.endsWith('.gitignore'))).toEqual([
      {
        type: 'create-link',
        path: path.join(projectPath, '.claude', 'skills', 'drawio'),
        target: skillPath
      }
    ])
    // .gitignore is recorded as managed too, so dropping the role later
    // cleans it up instead of leaving it behind.
    expect(plan.managed.materialized).toEqual(['.claude/skills/drawio', '.claude/.gitignore'])
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

  // --- git-safe writes ------------------------------------------------------

  describe('git-safe writes', () => {
    function git(...args: string[]): void {
      execFileSync('git', args, { cwd: projectPath, stdio: 'pipe' })
    }

    function initRepo(): void {
      git('init', '-q')
      git('config', 'user.email', 'test@example.com')
      git('config', 'user.name', 'test')
    }

    // Permissions go to settings.local.json, which is conventionally
    // gitignored, so an apply never touches a settings.json the team shares.
    it('writes permissions to settings.local.json instead of settings.json', () => {
      new RolePermissionsRepository(db).setForRole(roleId, { permissions: { allow: ['Edit'] } })

      const plan = buildApplyPlan(deps, project(), roleId)

      expect(plan.settingsFile.path).toBe(path.join(projectPath, '.claude', 'settings.local.json'))
    })

    it('does not merge into a git-tracked settings.json the team shares', () => {
      initRepo()
      fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.claude', 'settings.json'),
        `${JSON.stringify({ permissions: { allow: ['Bash'] } })}\n`
      )
      git('add', '.claude/settings.json')
      git('commit', '-qm', 'team settings')
      new RolePermissionsRepository(db).setForRole(roleId, { permissions: { allow: ['Edit'] } })

      const plan = buildApplyPlan(deps, project(), roleId)

      expect(plan.settingsFile.path).toBe(path.join(projectPath, '.claude', 'settings.local.json'))
      // The team's Bash entry is not carried into skillam's file.
      expect(JSON.parse(plan.settingsFile.after)).toEqual({ permissions: { allow: ['Edit'] } })
      // And the shared file is left exactly as committed.
      expect(JSON.parse(fs.readFileSync(path.join(projectPath, '.claude', 'settings.json'), 'utf-8'))).toEqual({
        permissions: { allow: ['Bash'] }
      })
    })

    // A tracked destination means a commit would publish this machine's
    // absolute paths to every other clone. Refuse rather than guess.
    it('refuses to materialize onto a git-tracked path', () => {
      initRepo()
      const skillDir = path.join(scratchRoot, 'store', 'skills', 'demo')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# demo\n')
      fs.mkdirSync(path.join(projectPath, '.claude', 'skills', 'demo'), { recursive: true })
      fs.writeFileSync(path.join(projectPath, '.claude', 'skills', 'demo', 'SKILL.md'), '# committed\n')
      git('add', '.claude/skills/demo/SKILL.md')
      git('commit', '-qm', 'committed skill')
      new RoleSkillsRepository(db).replaceForRole(roleId, [{ skillSource: 'user', skillPath: skillDir }])

      expect(() => buildApplyPlan(deps, project(), roleId)).toThrow(GitTrackedTargetError)
    })

    it('plans a .claude/.gitignore that hides what skillam materializes', () => {
      const skillDir = path.join(scratchRoot, 'store', 'skills', 'demo')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# demo\n')
      new RoleSkillsRepository(db).replaceForRole(roleId, [{ skillSource: 'user', skillPath: skillDir }])

      const plan = buildApplyPlan(deps, project(), roleId)
      const ignore = plan.operations.find((op) => op.path === path.join(projectPath, '.claude', '.gitignore'))

      expect(ignore).toMatchObject({ type: 'write-file' })
      const content = (ignore as { content: string }).content
      expect(content).toContain('settings.local.json')
      expect(content).toContain('skills/')
    })
  })
})

describe('buildApplyPlan — multiple roles', () => {
  let db: Database.Database
  let deps: ApplyPlannerDeps
  let scratchRoot: string
  let projectPath: string

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-compose-test-')))
    projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })

    deps = {
      skills: new RoleSkillsRepository(db),
      agents: new RoleAgentsRepository(db),
      mcpServers: new RoleMcpServersRepository(db),
      permissions: new RolePermissionsRepository(db),
      history: new ApplyHistoryRepository(db)
    }
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  function project() {
    return new ProjectsRepository(db).create({ path: projectPath, name: 'project' })
  }

  function makeSkill(name: string): string {
    const skillPath = path.join(scratchRoot, 'skills', name)
    fs.mkdirSync(skillPath, { recursive: true })
    fs.writeFileSync(path.join(skillPath, 'SKILL.md'), `# ${name}\n`)
    return skillPath
  }

  it('materializes skills from every bound role', () => {
    const roles = new RolesRepository(db)
    const teamRole = roles.create({ name: 'team' }).id
    const personalRole = roles.create({ name: 'personal' }).id
    new RoleSkillsRepository(db).replaceForRole(teamRole, [
      { skillSource: 'user', skillPath: makeSkill('drawio') }
    ])
    new RoleSkillsRepository(db).replaceForRole(personalRole, [
      { skillSource: 'user', skillPath: makeSkill('playwright') }
    ])

    const plan = buildApplyPlanForRoles(deps, project(), [
      { roleId: teamRole, origin: { kind: 'direct' }, priority: 0 },
      { roleId: personalRole, origin: { kind: 'direct' }, priority: 1 }
    ])

    const linked = plan.operations.map((operation) => path.basename(operation.path))
    expect(linked).toContain('drawio')
    expect(linked).toContain('playwright')
  })

  it('merges permissions from every bound role into settings.local.json', () => {
    const roles = new RolesRepository(db)
    const a = roles.create({ name: 'a' }).id
    const b = roles.create({ name: 'b' }).id
    const permissions = new RolePermissionsRepository(db)
    permissions.setForRole(a, { permissions: { allow: ['Read(*)'] } })
    permissions.setForRole(b, { permissions: { allow: ['Edit'] } })

    const plan = buildApplyPlanForRoles(deps, project(), [
      { roleId: a, origin: { kind: 'direct' }, priority: 0 },
      { roleId: b, origin: { kind: 'direct' }, priority: 1 }
    ])

    const settings = JSON.parse(plan.settingsFile.after)
    expect(settings.permissions.allow).toContain('Read(*)')
    expect(settings.permissions.allow).toContain('Edit')
  })

  // The organisation-wide rule has to survive the individual binding, or a
  // scope-level restriction means nothing.
  it('lets a deny from one role remove an allow granted by another', () => {
    const roles = new RolesRepository(db)
    const orgRole = roles.create({ name: 'org' }).id
    const personalRole = roles.create({ name: 'personal' }).id
    const permissions = new RolePermissionsRepository(db)
    permissions.setForRole(orgRole, { permissions: { deny: ['Bash(rm -rf*)'] } })
    permissions.setForRole(personalRole, { permissions: { allow: ['Bash(rm -rf*)', 'Read(*)'] } })

    const plan = buildApplyPlanForRoles(deps, project(), [
      { roleId: orgRole, origin: { kind: 'scope', path: '/work' }, priority: 0 },
      { roleId: personalRole, origin: { kind: 'direct' }, priority: 0 }
    ])

    const settings = JSON.parse(plan.settingsFile.after)
    expect(settings.permissions.allow).not.toContain('Bash(rm -rf*)')
    expect(settings.permissions.allow).toContain('Read(*)')
    expect(settings.permissions.deny).toContain('Bash(rm -rf*)')
  })

  it('refuses when two roles bind the same skill name to different paths', () => {
    const roles = new RolesRepository(db)
    const a = roles.create({ name: 'a' }).id
    const b = roles.create({ name: 'b' }).id
    const skills = new RoleSkillsRepository(db)
    const first = path.join(scratchRoot, 'one', 'playwright')
    const second = path.join(scratchRoot, 'two', 'playwright')
    for (const dir of [first, second]) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '# playwright\n')
    }
    skills.replaceForRole(a, [{ skillSource: 'user', skillPath: first }])
    skills.replaceForRole(b, [{ skillSource: 'user', skillPath: second }])

    expect(() =>
      buildApplyPlanForRoles(deps, project(), [
        { roleId: a, origin: { kind: 'group', name: 'ts' }, priority: 0 },
        { roleId: b, origin: { kind: 'direct' }, priority: 0 }
      ])
    ).toThrow(RoleCompositionConflictError)
  })

  it('reports which binding each materialized skill came from', () => {
    const roles = new RolesRepository(db)
    const teamRole = roles.create({ name: 'team' }).id
    new RoleSkillsRepository(db).replaceForRole(teamRole, [
      { skillSource: 'user', skillPath: makeSkill('drawio') }
    ])

    const plan = buildApplyPlanForRoles(deps, project(), [
      { roleId: teamRole, origin: { kind: 'scope', path: '/work' }, priority: 0 }
    ])

    expect(plan.origins).toEqual([
      { kind: 'skill', name: 'drawio', origin: { kind: 'scope', path: '/work' } }
    ])
  })

  // Existing callers pass one roleId. That path has to keep producing exactly
  // what it did before, or every applied project drifts on the next run.
  it('produces the same plan as the single-role entry point', () => {
    const roleId = new RolesRepository(db).create({ name: 'solo' }).id
    new RolePermissionsRepository(db).setForRole(roleId, { permissions: { allow: ['Edit'] } })
    const target = project()

    const single = buildApplyPlan(deps, target, roleId)
    const composed = buildApplyPlanForRoles(deps, target, [
      { roleId, origin: { kind: 'direct' }, priority: 0 }
    ])

    expect(composed.settingsFile.after).toBe(single.settingsFile.after)
    expect(composed.managed).toEqual(single.managed)
  })
})
