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
    expect(count).toBe(6)

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

  it('creates the group tables', () => {
    const db = openDb(':memory:')

    runMigrations(db)

    expect(tableNames(db)).toEqual(
      expect.arrayContaining(['groups', 'project_groups', 'group_roles'])
    )

    db.close()
  })

  it('rejects a duplicate group name', () => {
    const db = openDb(':memory:')
    runMigrations(db)
    db.prepare("INSERT INTO groups (name) VALUES ('typescript')").run()

    expect(() => db.prepare("INSERT INTO groups (name) VALUES ('typescript')").run()).toThrow()

    db.close()
  })

  it('drops memberships and bindings when a group is deleted', () => {
    const db = openDb(':memory:')
    runMigrations(db)
    db.prepare("INSERT INTO roles (name) VALUES ('dev')").run()
    db.prepare("INSERT INTO projects (path, name) VALUES ('/tmp/x', 'x')").run()
    db.prepare("INSERT INTO groups (name) VALUES ('typescript')").run()
    db.prepare('INSERT INTO project_groups (project_id, group_id) VALUES (1, 1)').run()
    db.prepare('INSERT INTO group_roles (group_id, role_id) VALUES (1, 1)').run()

    db.prepare('DELETE FROM groups WHERE id = 1').run()

    expect(db.prepare('SELECT COUNT(*) AS c FROM project_groups').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM group_roles').get()).toEqual({ c: 0 })
    // The role and project themselves are untouched — a group is a binding
    // path, not an owner.
    expect(db.prepare('SELECT COUNT(*) AS c FROM roles').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM projects').get()).toEqual({ c: 1 })

    db.close()
  })

  it('drops group bindings when their role is deleted', () => {
    const db = openDb(':memory:')
    runMigrations(db)
    db.prepare("INSERT INTO roles (name) VALUES ('dev')").run()
    db.prepare("INSERT INTO groups (name) VALUES ('typescript')").run()
    db.prepare('INSERT INTO group_roles (group_id, role_id) VALUES (1, 1)').run()

    db.prepare('DELETE FROM roles WHERE id = 1').run()

    expect(db.prepare('SELECT COUNT(*) AS c FROM group_roles').get()).toEqual({ c: 0 })

    db.close()
  })

  it('creates the scope tables', () => {
    const db = openDb(':memory:')

    runMigrations(db)

    expect(tableNames(db)).toEqual(expect.arrayContaining(['scopes', 'scope_roles']))

    db.close()
  })

  it('rejects a duplicate scope path', () => {
    const db = openDb(':memory:')
    runMigrations(db)
    db.prepare("INSERT INTO scopes (path) VALUES ('/Users/example/work')").run()

    expect(() => db.prepare("INSERT INTO scopes (path) VALUES ('/Users/example/work')").run()).toThrow()

    db.close()
  })

  it('drops scope bindings when the scope is deleted', () => {
    const db = openDb(':memory:')
    runMigrations(db)
    db.prepare("INSERT INTO roles (name) VALUES ('dev')").run()
    db.prepare("INSERT INTO scopes (path) VALUES ('/Users/example/work')").run()
    db.prepare('INSERT INTO scope_roles (scope_id, role_id) VALUES (1, 1)').run()

    db.prepare('DELETE FROM scopes WHERE id = 1').run()

    expect(db.prepare('SELECT COUNT(*) AS c FROM scope_roles').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM roles').get()).toEqual({ c: 1 })

    db.close()
  })

  it('drops scope bindings when their role is deleted', () => {
    const db = openDb(':memory:')
    runMigrations(db)
    db.prepare("INSERT INTO roles (name) VALUES ('dev')").run()
    db.prepare("INSERT INTO scopes (path) VALUES ('/Users/example/work')").run()
    db.prepare('INSERT INTO scope_roles (scope_id, role_id) VALUES (1, 1)').run()

    db.prepare('DELETE FROM roles WHERE id = 1').run()

    expect(db.prepare('SELECT COUNT(*) AS c FROM scope_roles').get()).toEqual({ c: 0 })

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
