import { describe, expect, it } from 'vitest'
import { openDb, resolveDbPath } from './client.js'

describe('openDb', () => {
  it('opens an in-memory database with foreign keys enabled', () => {
    const db = openDb(':memory:')

    const fkEnabled = db.pragma('foreign_keys', { simple: true })

    expect(fkEnabled).toBe(1)
    db.close()
  })
})

describe('resolveDbPath', () => {
  it('honors SKILLAM_DB_PATH when set', () => {
    process.env.SKILLAM_DB_PATH = '/tmp/skillam-test.db'

    expect(resolveDbPath()).toBe('/tmp/skillam-test.db')

    delete process.env.SKILLAM_DB_PATH
  })

  it('defaults to ~/.skillam/skillam.db', () => {
    delete process.env.SKILLAM_DB_PATH

    expect(resolveDbPath().endsWith('.skillam/skillam.db')).toBe(true)
  })
})
