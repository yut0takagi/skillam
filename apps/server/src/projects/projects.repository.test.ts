import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { ProjectsRepository } from './projects.repository.js'

describe('ProjectsRepository', () => {
  let db: Database.Database
  let repo: ProjectsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new ProjectsRepository(db)
  })

  it('creates a project with defaults', () => {
    const created = repo.create({ path: '/Users/example/Develop/foo', name: 'foo' })

    expect(created).toMatchObject({
      path: '/Users/example/Develop/foo',
      name: 'foo',
      autoDetected: false,
      excluded: false
    })
  })

  it('creates a project with autoDetected and excluded set', () => {
    const created = repo.create({
      path: '/Users/example/Develop/bar',
      name: 'bar',
      autoDetected: true,
      excluded: true
    })

    expect(created.autoDetected).toBe(true)
    expect(created.excluded).toBe(true)
  })

  it('normalizes a trailing slash on the path', () => {
    const created = repo.create({ path: '/Users/example/Develop/foo/', name: 'foo' })

    expect(created.path).toBe('/Users/example/Develop/foo')
  })

  it('rejects a path that normalizes to an already-registered path', () => {
    repo.create({ path: '/Users/example/Develop/foo/', name: 'foo' })

    expect(() => repo.create({ path: '/Users/example/Develop/foo', name: 'foo-again' })).toThrow()
  })

  it('lists projects ordered by path', () => {
    repo.create({ path: '/z/proj', name: 'z' })
    repo.create({ path: '/a/proj', name: 'a' })

    expect(repo.list().map((p) => p.path)).toEqual(['/a/proj', '/z/proj'])
  })

  it('gets a project by id', () => {
    const created = repo.create({ path: '/Users/example/Develop/foo', name: 'foo' })

    expect(repo.getById(created.id)).toEqual(created)
  })

  it('returns undefined for a missing project', () => {
    expect(repo.getById(999)).toBeUndefined()
  })

  it('lists all registered paths', () => {
    repo.create({ path: '/a/proj', name: 'a' })
    repo.create({ path: '/b/proj', name: 'b', excluded: true })

    expect(repo.listPaths()).toEqual(new Set(['/a/proj', '/b/proj']))
  })

  it('updates a project name and excluded flag', () => {
    const created = repo.create({ path: '/Users/example/Develop/foo', name: 'foo' })

    const updated = repo.update(created.id, { name: 'renamed', excluded: true })

    expect(updated?.name).toBe('renamed')
    expect(updated?.excluded).toBe(true)
    expect(updated?.path).toBe('/Users/example/Develop/foo')
  })

  it('returns undefined when updating a missing project', () => {
    expect(repo.update(999, { name: 'x' })).toBeUndefined()
  })

  it('deletes a project', () => {
    const created = repo.create({ path: '/Users/example/Develop/foo', name: 'foo' })

    expect(repo.delete(created.id)).toBe(true)
    expect(repo.getById(created.id)).toBeUndefined()
  })
})
