import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from './roles.repository.js'
import { RoleSkillsRepository } from './role-skills.repository.js'

describe('RoleSkillsRepository', () => {
  let db: Database.Database
  let roleId: number
  let repo: RoleSkillsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    roleId = new RolesRepository(db).create({ name: 'test-role' }).id
    repo = new RoleSkillsRepository(db)
  })

  it('returns an empty list for a role with no skills', () => {
    expect(repo.listForRole(roleId)).toEqual([])
  })

  it('replaces the skill list for a role', () => {
    repo.replaceForRole(roleId, [{ skillSource: 'user', skillPath: '~/.claude/skills/brainstorming' }])

    const result = repo.replaceForRole(roleId, [
      { skillSource: 'plugin', skillPath: 'everything-claude-code/docs' }
    ])

    expect(result).toEqual([
      { id: expect.any(Number), skillSource: 'plugin', skillPath: 'everything-claude-code/docs' }
    ])
  })
})
