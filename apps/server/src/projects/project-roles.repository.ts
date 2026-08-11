import type Database from 'better-sqlite3'
import type { ProjectRole } from './project-roles.types.js'

interface ProjectRoleRow {
  role_id: number
  priority: number
}

export class ProjectRolesRepository {
  constructor(private readonly db: Database.Database) {}

  listForProject(projectId: number): ProjectRole[] {
    const rows = this.db
      .prepare('SELECT role_id, priority FROM project_roles WHERE project_id = ? ORDER BY priority')
      .all(projectId) as ProjectRoleRow[]
    return rows.map((row) => ({ roleId: row.role_id, priority: row.priority }))
  }

  replaceForProject(projectId: number, roleIds: number[]): ProjectRole[] {
    const replace = this.db.transaction((ids: number[]) => {
      this.db.prepare('DELETE FROM project_roles WHERE project_id = ?').run(projectId)
      const insert = this.db.prepare(
        'INSERT INTO project_roles (project_id, role_id, priority) VALUES (?, ?, ?)'
      )
      ids.forEach((roleId, index) => {
        insert.run(projectId, roleId, index)
      })
    })
    replace(roleIds)
    return this.listForProject(projectId)
  }
}
