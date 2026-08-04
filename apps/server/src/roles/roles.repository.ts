import type Database from 'better-sqlite3'
import type { CreateRoleInput, Role, UpdateRoleInput } from './roles.types.js'

interface RoleRow {
  id: number
  name: string
  description: string
  created_at: string
  updated_at: string
}

function toRole(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class RolesRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateRoleInput): Role {
    const row = this.db
      .prepare('INSERT INTO roles (name, description) VALUES (@name, @description) RETURNING *')
      .get({ name: input.name, description: input.description ?? '' }) as RoleRow
    return toRole(row)
  }

  list(): Role[] {
    const rows = this.db.prepare('SELECT * FROM roles ORDER BY name').all() as RoleRow[]
    return rows.map(toRole)
  }

  getById(id: number): Role | undefined {
    const row = this.db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as RoleRow | undefined
    return row ? toRole(row) : undefined
  }

  update(id: number, input: UpdateRoleInput): Role | undefined {
    const existing = this.getById(id)
    if (!existing) {
      return undefined
    }
    const row = this.db
      .prepare(
        `UPDATE roles
         SET name = @name, description = @description, updated_at = datetime('now')
         WHERE id = @id
         RETURNING *`
      )
      .get({
        id,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description
      }) as RoleRow
    return toRole(row)
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM roles WHERE id = ?').run(id)
    return result.changes > 0
  }
}
