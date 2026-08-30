import type Database from 'better-sqlite3'
import { isPathWithin } from '../lib/paths.js'
import type { ProjectScopeRole, ScopeRole } from './scopes.types.js'

interface ScopeRoleRow {
  role_id: number
  priority: number
}

interface ScopeBindingRow extends ScopeRoleRow {
  scope_id: number
  scope_path: string
}

export class ScopeRolesRepository {
  constructor(private readonly db: Database.Database) {}

  listForScope(scopeId: number): ScopeRole[] {
    const rows = this.db
      .prepare('SELECT role_id, priority FROM scope_roles WHERE scope_id = ? ORDER BY priority')
      .all(scopeId) as ScopeRoleRow[]
    return rows.map((row) => ({ roleId: row.role_id, priority: row.priority }))
  }

  // Every binding reaching this project because it sits under a scope.
  //
  // The containment test runs in TypeScript rather than SQL: SQL's LIKE would
  // match '/Users/me/workspace' against a '/Users/me/work' scope, and building
  // a boundary-correct pattern means escaping the path anyway. Scopes are
  // few — roots someone deliberately registered — so scanning them costs
  // nothing next to getting the boundary wrong.
  //
  // A project can sit under several nested scopes at once; all of them apply,
  // and composeRoles ranks the deeper path as the stronger one.
  listForProject(projectId: number): ProjectScopeRole[] {
    const project = this.db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as
      | { path: string }
      | undefined
    if (!project) {
      return []
    }
    const rows = this.db
      .prepare(
        `SELECT sr.role_id, sr.priority, s.id AS scope_id, s.path AS scope_path
         FROM scope_roles sr
         JOIN scopes s ON s.id = sr.scope_id
         ORDER BY s.path, sr.priority`
      )
      .all() as ScopeBindingRow[]
    return rows
      .filter((row) => isPathWithin(project.path, row.scope_path))
      .map((row) => ({
        roleId: row.role_id,
        priority: row.priority,
        scopeId: row.scope_id,
        scopePath: row.scope_path
      }))
  }

  replaceForScope(scopeId: number, roleIds: number[]): ScopeRole[] {
    const uniqueRoleIds = Array.from(new Set(roleIds))
    const replace = this.db.transaction((ids: number[]) => {
      this.db.prepare('DELETE FROM scope_roles WHERE scope_id = ?').run(scopeId)
      const insert = this.db.prepare(
        'INSERT INTO scope_roles (scope_id, role_id, priority) VALUES (?, ?, ?)'
      )
      ids.forEach((roleId, index) => {
        insert.run(scopeId, roleId, index)
      })
    })
    replace(uniqueRoleIds)
    return this.listForScope(scopeId)
  }
}
