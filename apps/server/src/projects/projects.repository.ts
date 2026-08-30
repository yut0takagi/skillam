import type Database from 'better-sqlite3'
import { normalizePath } from '../lib/paths.js'
import type { CreateProjectInput, Project, UpdateProjectInput } from './projects.types.js'

export interface ProjectRow {
  id: number
  path: string
  name: string
  auto_detected: number
  excluded: number
  last_applied_role_id: number | null
  last_applied_at: string | null
  created_at: string
  updated_at: string
}

// Exported so other repositories that join onto projects (group
// membership, and later scope matching) map rows the same way rather
// than each restating the column-to-field translation.
export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    autoDetected: row.auto_detected === 1,
    excluded: row.excluded === 1,
    lastAppliedRoleId: row.last_applied_role_id,
    lastAppliedAt: row.last_applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class ProjectsRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateProjectInput): Project {
    const normalizedPath = normalizePath(input.path)
    const row = this.db
      .prepare(
        `INSERT INTO projects (path, name, auto_detected, excluded)
         VALUES (@path, @name, @autoDetected, @excluded)
         RETURNING *`
      )
      .get({
        path: normalizedPath,
        name: input.name,
        autoDetected: input.autoDetected ? 1 : 0,
        excluded: input.excluded ? 1 : 0
      }) as ProjectRow
    return toProject(row)
  }

  list(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY path').all() as ProjectRow[]
    return rows.map(toProject)
  }

  getById(id: number): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | ProjectRow
      | undefined
    return row ? toProject(row) : undefined
  }

  listPaths(): Set<string> {
    const rows = this.db.prepare('SELECT path FROM projects').all() as { path: string }[]
    return new Set(rows.map((row) => row.path))
  }

  update(id: number, input: UpdateProjectInput): Project | undefined {
    const existing = this.getById(id)
    if (!existing) {
      return undefined
    }
    const row = this.db
      .prepare(
        `UPDATE projects
         SET name = @name, excluded = @excluded, updated_at = datetime('now')
         WHERE id = @id
         RETURNING *`
      )
      .get({
        id,
        name: input.name ?? existing.name,
        excluded: (input.excluded ?? existing.excluded) ? 1 : 0
      }) as ProjectRow
    return toProject(row)
  }

  markApplied(id: number, roleId: number): Project | undefined {
    const row = this.db
      .prepare(
        `UPDATE projects
         SET last_applied_role_id = @roleId, last_applied_at = datetime('now'), updated_at = datetime('now')
         WHERE id = @id
         RETURNING *`
      )
      .get({ id, roleId }) as ProjectRow | undefined
    return row ? toProject(row) : undefined
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    return result.changes > 0
  }
}
