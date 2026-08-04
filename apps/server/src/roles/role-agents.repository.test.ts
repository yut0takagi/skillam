import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from './roles.repository.js'
import { RoleAgentsRepository } from './role-agents.repository.js'

describe('RoleAgentsRepository', () => {
  let db: Database.Database
  let roleId: number
  let repo: RoleAgentsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    roleId = new RolesRepository(db).create({ name: 'test-role' }).id
    repo = new RoleAgentsRepository(db)
  })

  it('returns an empty list for a role with no agents', () => {
    expect(repo.listForRole(roleId)).toEqual([])
  })

  it('replaces the agent list for a role', () => {
    const result = repo.replaceForRole(roleId, [
      { name: 'code-reviewer', markdownBody: '# Code Reviewer\n...', source: 'reference' }
    ])

    expect(result).toEqual([
      {
        id: expect.any(Number),
        name: 'code-reviewer',
        markdownBody: '# Code Reviewer\n...',
        source: 'reference'
      }
    ])
  })
})
