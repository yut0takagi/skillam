import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { GroupsRepository } from './groups.repository.js'

describe('GroupsRepository', () => {
  let db: Database.Database
  let repo: GroupsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new GroupsRepository(db)
  })

  it('creates a group with a default empty description', () => {
    const group = repo.create({ name: 'typescript' })

    expect(group).toMatchObject({ name: 'typescript', description: '' })
    expect(group.id).toBeGreaterThan(0)
  })

  it('creates a group with a description', () => {
    const group = repo.create({ name: 'typescript', description: 'TS を使う PJT' })

    expect(group.description).toBe('TS を使う PJT')
  })

  it('returns an empty list when no groups exist', () => {
    expect(repo.list()).toEqual([])
  })

  it('lists groups ordered by name', () => {
    repo.create({ name: 'zebra' })
    repo.create({ name: 'alpha' })

    expect(repo.list().map((group) => group.name)).toEqual(['alpha', 'zebra'])
  })

  it('gets a group by id', () => {
    const created = repo.create({ name: 'typescript' })

    expect(repo.getById(created.id)).toEqual(created)
  })

  it('returns undefined for an unknown id', () => {
    expect(repo.getById(9999)).toBeUndefined()
  })

  it('updates a group name', () => {
    const created = repo.create({ name: 'typescript', description: 'keep' })

    const updated = repo.update(created.id, { name: 'ts' })

    expect(updated).toMatchObject({ id: created.id, name: 'ts', description: 'keep' })
  })

  it('leaves fields absent from the update untouched', () => {
    const created = repo.create({ name: 'typescript', description: 'keep' })

    const updated = repo.update(created.id, { description: 'changed' })

    expect(updated).toMatchObject({ name: 'typescript', description: 'changed' })
  })

  it('returns undefined when updating an unknown group', () => {
    expect(repo.update(9999, { name: 'x' })).toBeUndefined()
  })

  it('deletes a group', () => {
    const created = repo.create({ name: 'typescript' })

    expect(repo.delete(created.id)).toBe(true)
    expect(repo.getById(created.id)).toBeUndefined()
  })

  it('reports false when deleting an unknown group', () => {
    expect(repo.delete(9999)).toBe(false)
  })

  it('rejects a duplicate name', () => {
    repo.create({ name: 'typescript' })

    expect(() => repo.create({ name: 'typescript' })).toThrow()
  })
})
