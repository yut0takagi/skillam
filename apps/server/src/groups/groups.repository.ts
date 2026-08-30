import type Database from 'better-sqlite3'
import type { CreateGroupInput, Group, UpdateGroupInput } from './groups.types.js'

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

export class GroupsRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateGroupInput): Group {
    const row = this.db
      .prepare('INSERT INTO groups (name, description) VALUES (@name, @description) RETURNING *')
      .get({ name: input.name, description: input.description ?? '' }) as GroupRow
    return toGroup(row)
  }

  list(): Group[] {
    const rows = this.db.prepare('SELECT * FROM groups ORDER BY name').all() as GroupRow[]
    return rows.map(toGroup)
  }

  getById(id: number): Group | undefined {
    const row = this.db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRow | undefined
    return row ? toGroup(row) : undefined
  }

  update(id: number, input: UpdateGroupInput): Group | undefined {
    const existing = this.getById(id)
    if (!existing) {
      return undefined
    }
    const row = this.db
      .prepare(
        `UPDATE groups
         SET name = @name, description = @description
         WHERE id = @id
         RETURNING *`
      )
      .get({
        id,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description
      }) as GroupRow
    return toGroup(row)
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM groups WHERE id = ?').run(id)
    return result.changes > 0
  }
}
