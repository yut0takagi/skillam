import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { ScopesRepository } from './scopes.repository.js'

describe('ScopesRepository', () => {
  let db: Database.Database
  let repo: ScopesRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new ScopesRepository(db)
  })

  it('creates a scope', () => {
    const scope = repo.create({ path: '/Users/example/work' })

    expect(scope).toMatchObject({ path: '/Users/example/work' })
    expect(scope.id).toBeGreaterThan(0)
  })

  // Stored paths are compared against project paths, which the projects
  // repository already normalizes. Normalizing on the way in keeps a trailing
  // slash from producing a scope that never matches anything.
  it('normalizes the path on the way in', () => {
    const scope = repo.create({ path: '/Users/example/work/' })

    expect(scope.path).toBe('/Users/example/work')
  })

  it('collapses relative segments when normalizing', () => {
    expect(repo.create({ path: '/Users/example/../example/work' }).path).toBe('/Users/example/work')
  })

  it('returns an empty list when no scopes exist', () => {
    expect(repo.list()).toEqual([])
  })

  it('lists scopes ordered by path', () => {
    repo.create({ path: '/Users/example/zebra' })
    repo.create({ path: '/Users/example/alpha' })

    expect(repo.list().map((scope) => scope.path)).toEqual([
      '/Users/example/alpha',
      '/Users/example/zebra'
    ])
  })

  it('gets a scope by id', () => {
    const created = repo.create({ path: '/Users/example/work' })

    expect(repo.getById(created.id)).toEqual(created)
  })

  it('returns undefined for an unknown id', () => {
    expect(repo.getById(9999)).toBeUndefined()
  })

  it('deletes a scope', () => {
    const created = repo.create({ path: '/Users/example/work' })

    expect(repo.delete(created.id)).toBe(true)
    expect(repo.getById(created.id)).toBeUndefined()
  })

  it('reports false when deleting an unknown scope', () => {
    expect(repo.delete(9999)).toBe(false)
  })

  it('rejects a duplicate path', () => {
    repo.create({ path: '/Users/example/work' })

    expect(() => repo.create({ path: '/Users/example/work' })).toThrow()
  })

  it('rejects a duplicate that differs only by a trailing slash', () => {
    repo.create({ path: '/Users/example/work' })

    expect(() => repo.create({ path: '/Users/example/work/' })).toThrow()
  })
})
