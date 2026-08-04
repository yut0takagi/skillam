import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'
import { InMemoryKeychainClient } from './in-memory-keychain-client.js'

describe('secrets routes', () => {
  let db: Database.Database
  let app: FastifyInstance

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db, new InMemoryKeychainClient())
  })

  it('creates a secret via POST /secrets and does not echo the plaintext value back', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'github-token', value: 'ghp_realvalue' }
    })

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body).toMatchObject({ refName: 'github-token' })
    expect(body).not.toHaveProperty('value')
    expect(JSON.stringify(body)).not.toContain('ghp_realvalue')
  })

  it('rejects POST /secrets without a refName', async () => {
    const response = await app.inject({ method: 'POST', url: '/secrets', payload: { value: 'x' } })

    expect(response.statusCode).toBe(400)
  })

  it('rejects POST /secrets without a value', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'x' }
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a duplicate refName', async () => {
    await app.inject({ method: 'POST', url: '/secrets', payload: { refName: 'dup', value: 'a' } })

    const response = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'dup', value: 'b' }
    })

    expect(response.statusCode).toBe(400)
  })

  it('trims whitespace from refName before storing and returning it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: '  github-token  ', value: 'ghp_realvalue' }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ refName: 'github-token' })

    const listResponse = await app.inject({ method: 'GET', url: '/secrets' })
    expect(listResponse.json()).toMatchObject([{ refName: 'github-token' }])
  })

  it('rejects a duplicate refName that differs only by whitespace padding', async () => {
    await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: '  padded-dup  ', value: 'a' }
    })

    const unpadded = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'padded-dup', value: 'b' }
    })
    expect(unpadded.statusCode).toBe(400)

    const differentlyPadded = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'padded-dup   ', value: 'c' }
    })
    expect(differentlyPadded.statusCode).toBe(400)
  })

  it('lists secrets via GET /secrets without leaking encrypted or plaintext values', async () => {
    await app.inject({ method: 'POST', url: '/secrets', payload: { refName: 'a', value: 'x' } })
    await app.inject({ method: 'POST', url: '/secrets', payload: { refName: 'b', value: 'y' } })

    const response = await app.inject({ method: 'GET', url: '/secrets' })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body).toHaveLength(2)
    for (const secret of body) {
      expect(secret).not.toHaveProperty('value')
      expect(secret).not.toHaveProperty('encryptedValue')
    }
  })

  it('gets a single secret via GET /secrets/:id without its value', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'a', value: 'x' }
    })
    const { id } = created.json()

    const response = await app.inject({ method: 'GET', url: `/secrets/${id}` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id, refName: 'a' })
    expect(response.json()).not.toHaveProperty('value')
  })

  it('returns 404 for GET /secrets/:id when missing', async () => {
    const response = await app.inject({ method: 'GET', url: '/secrets/999' })

    expect(response.statusCode).toBe(404)
  })

  it('deletes a secret via DELETE /secrets/:id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'a', value: 'x' }
    })
    const { id } = created.json()

    const response = await app.inject({ method: 'DELETE', url: `/secrets/${id}` })

    expect(response.statusCode).toBe(204)
    const getResponse = await app.inject({ method: 'GET', url: `/secrets/${id}` })
    expect(getResponse.statusCode).toBe(404)
  })

  it('returns 404 for DELETE /secrets/:id when missing', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/secrets/999' })

    expect(response.statusCode).toBe(404)
  })

  it('updates a secret value via PUT /secrets/:id and the new value round-trips through reveal', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'rotates', value: 'original-value' }
    })
    const { id } = created.json()

    const updateResponse = await app.inject({
      method: 'PUT',
      url: `/secrets/${id}`,
      payload: { value: 'rotated-value' }
    })
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json()).not.toHaveProperty('value')

    const revealResponse = await app.inject({ method: 'POST', url: `/secrets/${id}/reveal` })
    expect(revealResponse.json()).toEqual({ value: 'rotated-value' })
  })

  it('returns 404 for PUT /secrets/:id when missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/secrets/999',
      payload: { value: 'x' }
    })

    expect(response.statusCode).toBe(404)
  })

  it('rejects PUT /secrets/:id without a value', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'a', value: 'x' }
    })
    const { id } = created.json()

    const response = await app.inject({ method: 'PUT', url: `/secrets/${id}`, payload: {} })

    expect(response.statusCode).toBe(400)
  })

  it('reveals the decrypted value via POST /secrets/:id/reveal', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'reveal-me', value: 'the-real-secret' }
    })
    const { id } = created.json()

    const response = await app.inject({ method: 'POST', url: `/secrets/${id}/reveal` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ value: 'the-real-secret' })
  })

  it('returns 404 for POST /secrets/:id/reveal when missing', async () => {
    const response = await app.inject({ method: 'POST', url: '/secrets/999/reveal' })

    expect(response.statusCode).toBe(404)
  })
})
