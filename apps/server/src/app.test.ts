import { describe, expect, it } from 'vitest'
import { openDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { buildApp } from './app.js'

describe('GET /health', () => {
  it('returns status ok', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})

describe('error handler', () => {
  it('returns 400 (not 500) when the framework itself rejects a malformed JSON body', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({
      method: 'POST',
      url: '/roles',
      headers: { 'content-type': 'application/json' },
      payload: 'not valid json{'
    })

    expect(response.statusCode).toBe(400)
  })
})
