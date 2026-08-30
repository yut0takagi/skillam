import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from '../roles/roles.repository.js'
import { ScopesRepository } from './scopes.repository.js'
import { ScopeRolesRepository } from './scope-roles.repository.js'

describe('ScopeRolesRepository', () => {
  let db: Database.Database
  let repo: ScopeRolesRepository
  let scopes: ScopesRepository
  let scopeId: number
  let roleIds: number[]

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new ScopeRolesRepository(db)
    scopes = new ScopesRepository(db)
    scopeId = scopes.create({ path: '/Users/example/work' }).id
    const roles = new RolesRepository(db)
    roleIds = [roles.create({ name: 'a' }).id, roles.create({ name: 'b' }).id]
  })

  function createProject(projectPath: string): number {
    const row = db
      .prepare('INSERT INTO projects (path, name) VALUES (?, ?) RETURNING id')
      .get(projectPath, 'p') as { id: number }
    return row.id
  }

  it('returns an empty list for a scope with no roles', () => {
    expect(repo.listForScope(scopeId)).toEqual([])
  })

  it('stores assignments with priority following the given order', () => {
    const saved = repo.replaceForScope(scopeId, [roleIds[1], roleIds[0]])

    expect(saved).toEqual([
      { roleId: roleIds[1], priority: 0 },
      { roleId: roleIds[0], priority: 1 }
    ])
  })

  it('replaces previous assignments instead of appending', () => {
    repo.replaceForScope(scopeId, [roleIds[0], roleIds[1]])

    expect(repo.replaceForScope(scopeId, [roleIds[1]])).toEqual([{ roleId: roleIds[1], priority: 0 }])
  })

  it('deduplicates repeated role ids', () => {
    const saved = repo.replaceForScope(scopeId, [roleIds[0], roleIds[0], roleIds[1]])

    expect(saved).toEqual([
      { roleId: roleIds[0], priority: 0 },
      { roleId: roleIds[1], priority: 1 }
    ])
  })

  it('keeps one scope’s roles out of another’s', () => {
    const other = scopes.create({ path: '/Users/example/other' }).id
    repo.replaceForScope(scopeId, [roleIds[0]])

    repo.replaceForScope(other, [roleIds[1]])

    expect(repo.listForScope(scopeId)).toEqual([{ roleId: roleIds[0], priority: 0 }])
  })

  it('matches a project sitting directly under the scope', () => {
    repo.replaceForScope(scopeId, [roleIds[0]])
    const projectId = createProject('/Users/example/work/app')

    expect(repo.listForProject(projectId)).toEqual([
      { roleId: roleIds[0], priority: 0, scopeId, scopePath: '/Users/example/work' }
    ])
  })

  it('matches a deeply nested project', () => {
    repo.replaceForScope(scopeId, [roleIds[0]])
    const projectId = createProject('/Users/example/work/team/app')

    expect(repo.listForProject(projectId)).toHaveLength(1)
  })

  it('matches a project at the scope path itself', () => {
    repo.replaceForScope(scopeId, [roleIds[0]])
    const projectId = createProject('/Users/example/work')

    expect(repo.listForProject(projectId)).toHaveLength(1)
  })

  // The trap this whole path-matching design exists to avoid: a scope on
  // ~/work must not capture ~/workspace, which merely shares its prefix.
  it('does not match a sibling directory sharing the scope’s prefix', () => {
    repo.replaceForScope(scopeId, [roleIds[0]])
    const projectId = createProject('/Users/example/workspace/app')

    expect(repo.listForProject(projectId)).toEqual([])
  })

  it('does not match a project outside the scope', () => {
    repo.replaceForScope(scopeId, [roleIds[0]])
    const projectId = createProject('/Users/example/other/app')

    expect(repo.listForProject(projectId)).toEqual([])
  })

  it('does not match a parent of the scope', () => {
    repo.replaceForScope(scopeId, [roleIds[0]])
    const projectId = createProject('/Users/example')

    expect(repo.listForProject(projectId)).toEqual([])
  })

  // Both scopes legitimately contain the project. composeRoles ranks the
  // deeper one as stronger, so both have to reach it.
  it('returns every scope containing the project, shallowest first', () => {
    const parent = scopes.create({ path: '/Users' }).id
    repo.replaceForScope(parent, [roleIds[0]])
    repo.replaceForScope(scopeId, [roleIds[1]])
    const projectId = createProject('/Users/example/work/app')

    expect(repo.listForProject(projectId).map((binding) => binding.scopePath)).toEqual([
      '/Users',
      '/Users/example/work'
    ])
  })

  it('returns nothing when no scope contains the project', () => {
    const projectId = createProject('/tmp/elsewhere')

    expect(repo.listForProject(projectId)).toEqual([])
  })

  it('returns nothing for an unknown project', () => {
    repo.replaceForScope(scopeId, [roleIds[0]])

    expect(repo.listForProject(9999)).toEqual([])
  })

  it('ignores scopes that contain the project but have no roles', () => {
    const projectId = createProject('/Users/example/work/app')

    expect(repo.listForProject(projectId)).toEqual([])
  })
})
