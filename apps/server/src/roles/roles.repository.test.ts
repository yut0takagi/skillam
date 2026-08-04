import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from './roles.repository.js'

describe('RolesRepository', () => {
  let db: Database.Database
  let repo: RolesRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new RolesRepository(db)
  })

  it('creates and retrieves a role', () => {
    const created = repo.create({ name: 'frontend-dev', description: 'Frontend development role' })

    expect(created.id).toBeGreaterThan(0)
    expect(created.name).toBe('frontend-dev')

    const fetched = repo.getById(created.id)
    expect(fetched).toEqual(created)
  })

  it('lists roles ordered by name', () => {
    repo.create({ name: 'zeta' })
    repo.create({ name: 'alpha' })

    const roles = repo.list()

    expect(roles.map((r) => r.name)).toEqual(['alpha', 'zeta'])
  })

  it('updates a role', () => {
    const created = repo.create({ name: 'original' })

    const updated = repo.update(created.id, { description: 'new description' })

    expect(updated?.name).toBe('original')
    expect(updated?.description).toBe('new description')
  })

  it('returns undefined when updating a missing role', () => {
    expect(repo.update(999, { name: 'x' })).toBeUndefined()
  })

  it('deletes a role', () => {
    const created = repo.create({ name: 'to-delete' })

    const deleted = repo.delete(created.id)

    expect(deleted).toBe(true)
    expect(repo.getById(created.id)).toBeUndefined()
  })
})
