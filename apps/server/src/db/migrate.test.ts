import { describe, expect, it } from 'vitest'
import { openDb } from './client.js'
import { runMigrations } from './migrate.js'

function tableNames(db: ReturnType<typeof openDb>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (row) => row.name
  )
}

describe('runMigrations', () => {
  it('creates the roles, role_*, and project tables', () => {
    const db = openDb(':memory:')

    runMigrations(db)

    const names = tableNames(db)
    expect(names).toEqual(
      expect.arrayContaining([
        'roles',
        'role_skills',
        'role_mcp_servers',
        'role_agents',
        'role_permissions',
        'auto_detect_roots',
        'projects'
      ])
    )
    db.close()
  })

  it('is idempotent when run twice', () => {
    const db = openDb(':memory:')

    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()

    const { count } = db.prepare('SELECT COUNT(*) AS count FROM _migrations').get() as { count: number }
    expect(count).toBe(2)

    db.close()
  })
})
