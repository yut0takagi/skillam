import path from 'node:path'
import type Database from 'better-sqlite3'
import type { AutoDetectRoot, CreateAutoDetectRootInput } from './auto-detect-roots.types.js'

interface AutoDetectRootRow {
  id: number
  path: string
  created_at: string
}

function toAutoDetectRoot(row: AutoDetectRootRow): AutoDetectRoot {
  return {
    id: row.id,
    path: row.path,
    createdAt: row.created_at
  }
}

export class AutoDetectRootsRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateAutoDetectRootInput): AutoDetectRoot {
    const normalizedPath = path.normalize(input.path).replace(/\/+$/, '') || '/'
    const row = this.db
      .prepare('INSERT INTO auto_detect_roots (path) VALUES (?) RETURNING *')
      .get(normalizedPath) as AutoDetectRootRow
    return toAutoDetectRoot(row)
  }

  list(): AutoDetectRoot[] {
    const rows = this.db
      .prepare('SELECT * FROM auto_detect_roots ORDER BY path')
      .all() as AutoDetectRootRow[]
    return rows.map(toAutoDetectRoot)
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM auto_detect_roots WHERE id = ?').run(id)
    return result.changes > 0
  }
}
