import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { AutoDetectRootsRepository } from './auto-detect-roots.repository.js'

describe('AutoDetectRootsRepository', () => {
  let db: Database.Database
  let repo: AutoDetectRootsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new AutoDetectRootsRepository(db)
  })

  it('returns an empty list when no roots are registered', () => {
    expect(repo.list()).toEqual([])
  })

  it('creates and lists a root', () => {
    const created = repo.create({ path: '/Users/example/Develop' })

    expect(created.id).toBeGreaterThan(0)
    expect(created.path).toBe('/Users/example/Develop')

    expect(repo.list()).toEqual([created])
  })

  it('lists roots ordered by path', () => {
    repo.create({ path: '/z/root' })
    repo.create({ path: '/a/root' })

    const roots = repo.list()

    expect(roots.map((r) => r.path)).toEqual(['/a/root', '/z/root'])
  })

  it('deletes a root', () => {
    const created = repo.create({ path: '/Users/example/Develop' })

    const deleted = repo.delete(created.id)

    expect(deleted).toBe(true)
    expect(repo.list()).toEqual([])
  })

  it('returns false when deleting a missing root', () => {
    expect(repo.delete(999)).toBe(false)
  })

  it('normalizes a trailing slash so it matches the un-slashed equivalent', () => {
    const created = repo.create({ path: '/Users/example/Develop/' })

    expect(created.path).toBe('/Users/example/Develop')
  })

  it('rejects a path that normalizes to an already-registered path', () => {
    repo.create({ path: '/Users/example/Develop/' })

    expect(() => repo.create({ path: '/Users/example/Develop' })).toThrow()
  })
})
