import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from './roles.repository.js'
import { RolePermissionsRepository } from './role-permissions.repository.js'

describe('RolePermissionsRepository', () => {
  let db: Database.Database
  let roleId: number
  let repo: RolePermissionsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    roleId = new RolesRepository(db).create({ name: 'test-role' }).id
    repo = new RolePermissionsRepository(db)
  })

  it('returns undefined when no permissions are set', () => {
    expect(repo.getForRole(roleId)).toBeUndefined()
  })

  it('sets and retrieves permissions for a role', () => {
    const set = repo.setForRole(roleId, { permissions: { allow: ['Bash(git *)'], deny: [] } })

    expect(set).toEqual({ roleId, permissions: { allow: ['Bash(git *)'], deny: [] } })
    expect(repo.getForRole(roleId)).toEqual(set)
  })

  it('overwrites permissions on a second call', () => {
    repo.setForRole(roleId, { permissions: { allow: ['Bash(git *)'] } })

    const updated = repo.setForRole(roleId, { permissions: { allow: ['Edit'] } })

    expect(updated.permissions).toEqual({ allow: ['Edit'] })
  })
})
