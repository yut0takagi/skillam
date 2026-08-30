import type Database from 'better-sqlite3'
import { normalizePath } from '../lib/paths.js'
import type { CreateScopeInput, Scope } from './scopes.types.js'

interface ScopeRow {
  id: number
  path: string
  created_at: string
}

function toScope(row: ScopeRow): Scope {
  return {
    id: row.id,
    path: row.path,
    createdAt: row.created_at
  }
}

export class ScopesRepository {
  constructor(private readonly db: Database.Database) {}

  // Normalized on the way in, the same as projects.path. A scope stored with a
  // trailing slash would be compared against normalized project paths and
  // never match anything, and the UNIQUE constraint would treat '/a' and '/a/'
  // as two different scopes.
  create(input: CreateScopeInput): Scope {
    const row = this.db
      .prepare('INSERT INTO scopes (path) VALUES (?) RETURNING *')
      .get(normalizePath(input.path)) as ScopeRow
    return toScope(row)
  }

  list(): Scope[] {
    const rows = this.db.prepare('SELECT * FROM scopes ORDER BY path').all() as ScopeRow[]
    return rows.map(toScope)
  }

  getById(id: number): Scope | undefined {
    const row = this.db.prepare('SELECT * FROM scopes WHERE id = ?').get(id) as ScopeRow | undefined
    return row ? toScope(row) : undefined
  }

  getByPath(scopePath: string): Scope | undefined {
    const row = this.db.prepare('SELECT * FROM scopes WHERE path = ?').get(normalizePath(scopePath)) as
      | ScopeRow
      | undefined
    return row ? toScope(row) : undefined
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM scopes WHERE id = ?').run(id).changes > 0
  }
}
