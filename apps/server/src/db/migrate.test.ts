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

  it('allows deleting a role that a project has already applied', () => {
    const db = openDb(':memory:')
    runMigrations(db)
    db.prepare("INSERT INTO roles (name) VALUES ('dev')").run()
    db.prepare("INSERT INTO projects (path, name) VALUES ('/tmp/x', 'x')").run()
    db.prepare('UPDATE projects SET last_applied_role_id = 1').run()

    expect(() => db.prepare('DELETE FROM roles WHERE id = 1').run()).not.toThrow()
    expect(
      (db.prepare('SELECT last_applied_role_id AS roleId FROM projects').get() as { roleId: number | null }).roleId
    ).toBeNull()

    db.close()
  })

  it('keeps apply history when its role is deleted', () => {
    const db = openDb(':memory:')
    runMigrations(db)
    db.prepare("INSERT INTO roles (name) VALUES ('dev')").run()
    db.prepare("INSERT INTO projects (path, name) VALUES ('/tmp/x', 'x')").run()
    db.prepare(
      "INSERT INTO apply_history (project_id, role_id, managed_json, status) VALUES (1, 1, '{\"mcpServers\":[\"github\"]}', 'success')"
    ).run()

    db.prepare('DELETE FROM roles WHERE id = 1').run()

    const rows = db.prepare('SELECT role_id AS roleId, managed_json AS managedJson FROM apply_history').all() as {
      roleId: number | null
      managedJson: string
    }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].roleId).toBeNull()
    expect(rows[0].managedJson).toBe('{"mcpServers":["github"]}')

    db.close()
  })
})
