import type Database from 'better-sqlite3'
import { isPathWithin, normalizePath } from '../lib/paths.js'
import { toProject, type ProjectRow } from '../projects/projects.repository.js'
import type { Project } from '../projects/projects.types.js'
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

  // Every project sitting under this scope's path.
  //
  // Containment runs in TypeScript for the same reason it does in
  // ScopeRolesRepository: SQL's LIKE would match a sibling that merely shares
  // a prefix, and a boundary-correct pattern needs escaping anyway.
  //
  // Reaching a project depends on the path alone, so this deliberately does
  // not join scope_roles — a scope with no roles bound yet still has an answer
  // to "what would this affect?". Excluded projects are included too: the path
  // matches, and hiding them turns "excluded on purpose" into "missing for no
  // visible reason".
  listProjectsForScope(id: number): Project[] | undefined {
    const scope = this.getById(id)
    if (!scope) {
      return undefined
    }
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY path').all() as ProjectRow[]
    return rows.filter((row) => isPathWithin(row.path, scope.path)).map(toProject)
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM scopes WHERE id = ?').run(id).changes > 0
  }
}
