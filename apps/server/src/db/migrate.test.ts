import { describe, expect, it } from 'vitest'
import { openDb } from './client.js'
import { runMigrations } from './migrate.js'

function tableNames(db: ReturnType<typeof openDb>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (row) => row.name
  )
}

function columnNames(db: ReturnType<typeof openDb>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name)
}

describe('runMigrations', () => {
  it('creates the roles, role_*, project, and secrets tables', () => {
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
        'projects',
        'secrets'
      ])
    )
    db.close()
  })

  it('is idempotent when run twice', () => {
    const db = openDb(':memory:')

    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()

    const { count } = db.prepare('SELECT COUNT(*) AS count FROM _migrations').get() as { count: number }
    expect(count).toBe(4)

    db.close()
  })

  it('creates the apply tables and columns', () => {
    const db = openDb(':memory:')

    runMigrations(db)

    expect(tableNames(db)).toEqual(expect.arrayContaining(['project_roles', 'apply_history']))
    expect(columnNames(db, 'projects')).toEqual(
      expect.arrayContaining(['last_applied_role_id', 'last_applied_at'])
    )
    expect(columnNames(db, 'role_agents')).toContain('source_path')

    db.close()
  })
})
