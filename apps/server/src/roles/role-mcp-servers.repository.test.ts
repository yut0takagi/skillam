import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from './roles.repository.js'
import { RoleMcpServersRepository } from './role-mcp-servers.repository.js'

describe('RoleMcpServersRepository', () => {
  let db: Database.Database
  let roleId: number
  let repo: RoleMcpServersRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    roleId = new RolesRepository(db).create({ name: 'test-role' }).id
    repo = new RoleMcpServersRepository(db)
  })

  it('returns an empty list for a role with no mcp servers', () => {
    expect(repo.listForRole(roleId)).toEqual([])
  })

  it('replaces the mcp server list for a role', () => {
    const result = repo.replaceForRole(roleId, [
      {
        name: 'filesystem',
        command: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
        env: { ALLOWED_DIR: '${SKILLAM_PROJECT_ROOT}' }
      }
    ])

    expect(result).toEqual([
      {
        id: expect.any(Number),
        name: 'filesystem',
        command: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
        env: { ALLOWED_DIR: '${SKILLAM_PROJECT_ROOT}' }
      }
    ])
  })

  it('defaults env to an empty object when omitted', () => {
    const result = repo.replaceForRole(roleId, [{ name: 'no-env', command: { command: 'true' } }])
    expect(result[0].env).toEqual({})
  })
})
