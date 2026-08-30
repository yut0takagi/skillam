import type Database from 'better-sqlite3'
import { toProject, type ProjectRow } from '../projects/projects.repository.js'
import type { Project } from '../projects/projects.types.js'
import type { Group } from './groups.types.js'

interface GroupRow {
  id: number
  name: string
  description: string
  created_at: string
}

function toGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at
  }
}

export class ProjectGroupsRepository {
  constructor(private readonly db: Database.Database) {}

  listForProject(projectId: number): Group[] {
    const rows = this.db
      .prepare(
        `SELECT g.* FROM groups g
         JOIN project_groups pg ON pg.group_id = g.id
         WHERE pg.project_id = ?
         ORDER BY g.name`
      )
      .all(projectId) as GroupRow[]
    return rows.map(toGroup)
  }

  listForGroup(groupId: number): Project[] {
    const rows = this.db
      .prepare(
        `SELECT p.* FROM projects p
         JOIN project_groups pg ON pg.project_id = p.id
         WHERE pg.group_id = ?
         ORDER BY p.path`
      )
      .all(groupId) as ProjectRow[]
    return rows.map(toProject)
  }

  replaceForProject(projectId: number, groupIds: number[]): Group[] {
    const uniqueGroupIds = Array.from(new Set(groupIds))
    const replace = this.db.transaction((ids: number[]) => {
      this.db.prepare('DELETE FROM project_groups WHERE project_id = ?').run(projectId)
      const insert = this.db.prepare('INSERT INTO project_groups (project_id, group_id) VALUES (?, ?)')
      for (const groupId of ids) {
        insert.run(projectId, groupId)
      }
    })
    replace(uniqueGroupIds)
    return this.listForProject(projectId)
  }
}
