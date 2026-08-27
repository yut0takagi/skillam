import { describe, expect, it } from 'vitest'
import { openDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { buildApp } from './app.js'
import { KeychainAccessError } from './secrets/keychain-client.js'
import { InMemoryKeychainClient } from './secrets/in-memory-keychain-client.js'

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

describe('CORS', () => {
  it('allows the vite dev server origin', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' }
    })

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('allows the write methods the web ui needs', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/projects/1/roles',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PUT'
      }
    })

    const allowed = String(response.headers['access-control-allow-methods'])
    expect(allowed).toContain('PUT')
    expect(allowed).toContain('DELETE')
  })

  it('does not allow an unrelated origin', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.com' }
    })

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
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

  it('returns 503 with a clear message when a KeychainAccessError is thrown', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db, new InMemoryKeychainClient())
    app.get('/__test-keychain-error', async () => {
      throw new KeychainAccessError('simulated failure')
    })

    const response = await app.inject({ method: 'GET', url: '/__test-keychain-error' })

    expect(response.statusCode).toBe(503)
    expect(response.json().error).toContain('キーチェーン')
  })
})
