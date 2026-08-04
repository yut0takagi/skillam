import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { SecretsRepository } from './secrets.repository.js'

describe('SecretsRepository', () => {
  let db: Database.Database
  let repo: SecretsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new SecretsRepository(db)
  })

  it('creates and retrieves a secret by id', () => {
    const created = repo.create({ refName: 'github-token', encryptedValue: 'enc:abc' })

    expect(created.refName).toBe('github-token')
    expect(created.encryptedValue).toBe('enc:abc')

    expect(repo.getById(created.id)).toEqual(created)
  })

  it('retrieves a secret by ref name', () => {
    const created = repo.create({ refName: 'github-token', encryptedValue: 'enc:abc' })

    expect(repo.getByRefName('github-token')).toEqual(created)
  })

  it('returns undefined for a missing ref name', () => {
    expect(repo.getByRefName('does-not-exist')).toBeUndefined()
  })

  it('lists secrets ordered by ref name, without requiring the caller to touch encrypted values', () => {
    repo.create({ refName: 'zeta', encryptedValue: 'enc:z' })
    repo.create({ refName: 'alpha', encryptedValue: 'enc:a' })

    expect(repo.list().map((s) => s.refName)).toEqual(['alpha', 'zeta'])
  })

  it('rejects creating a second secret with the same ref name', () => {
    repo.create({ refName: 'github-token', encryptedValue: 'enc:abc' })

    expect(() => repo.create({ refName: 'github-token', encryptedValue: 'enc:xyz' })).toThrow()
  })

  it('updates the encrypted value for an existing secret', () => {
    const created = repo.create({ refName: 'github-token', encryptedValue: 'enc:abc' })

    const updated = repo.update(created.id, { encryptedValue: 'enc:rotated' })

    expect(updated?.encryptedValue).toBe('enc:rotated')
    expect(updated?.refName).toBe('github-token')
  })

  it('returns undefined when updating a missing secret', () => {
    expect(repo.update(999, { encryptedValue: 'x' })).toBeUndefined()
  })

  it('deletes a secret', () => {
    const created = repo.create({ refName: 'github-token', encryptedValue: 'enc:abc' })

    expect(repo.delete(created.id)).toBe(true)
    expect(repo.getById(created.id)).toBeUndefined()
  })

  it('returns false when deleting a missing secret', () => {
    expect(repo.delete(999)).toBe(false)
  })
})
