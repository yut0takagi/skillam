import type Database from 'better-sqlite3'
import type { GroupRole, ProjectGroupRole } from './groups.types.js'

interface GroupRoleRow {
  role_id: number
  priority: number
}

interface ProjectGroupRoleRow extends GroupRoleRow {
  group_id: number
  group_name: string
}

export class GroupRolesRepository {
  constructor(private readonly db: Database.Database) {}

  listForGroup(groupId: number): GroupRole[] {
    const rows = this.db
      .prepare('SELECT role_id, priority FROM group_roles WHERE group_id = ? ORDER BY priority')
      .all(groupId) as GroupRoleRow[]
    return rows.map((row) => ({ roleId: row.role_id, priority: row.priority }))
  }

  // Every binding reaching this project through any of its groups, in one
  // query. Ordered by group name then priority so an apply composes the same
  // way on every run — composition is order-sensitive only where it reports a
  // conflict, but a stable order keeps previews and diffs from churning.
  listForProject(projectId: number): ProjectGroupRole[] {
    const rows = this.db
      .prepare(
        `SELECT gr.role_id, gr.priority, g.id AS group_id, g.name AS group_name
         FROM group_roles gr
         JOIN groups g ON g.id = gr.group_id
         JOIN project_groups pg ON pg.group_id = g.id
         WHERE pg.project_id = ?
         ORDER BY g.name, gr.priority`
      )
      .all(projectId) as ProjectGroupRoleRow[]
    return rows.map((row) => ({
      roleId: row.role_id,
      priority: row.priority,
      groupId: row.group_id,
      groupName: row.group_name
    }))
  }

  replaceForGroup(groupId: number, roleIds: number[]): GroupRole[] {
    const uniqueRoleIds = Array.from(new Set(roleIds))
    const replace = this.db.transaction((ids: number[]) => {
      this.db.prepare('DELETE FROM group_roles WHERE group_id = ?').run(groupId)
      const insert = this.db.prepare(
        'INSERT INTO group_roles (group_id, role_id, priority) VALUES (?, ?, ?)'
      )
      ids.forEach((roleId, index) => {
        insert.run(groupId, roleId, index)
      })
    })
    replace(uniqueRoleIds)
    return this.listForGroup(groupId)
  }
}
