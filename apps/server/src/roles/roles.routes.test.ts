import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'

describe('roles routes', () => {
  let db: Database.Database
  let app: FastifyInstance

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db)
  })

  it('creates a role via POST /roles', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/roles',
      payload: { name: 'frontend-dev', description: 'Frontend role' }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ name: 'frontend-dev', description: 'Frontend role' })
  })

  it('rejects POST /roles without a name', async () => {
    const response = await app.inject({ method: 'POST', url: '/roles', payload: {} })

    expect(response.statusCode).toBe(400)
  })

  it('rejects POST /roles with a non-string name', async () => {
    const response = await app.inject({ method: 'POST', url: '/roles', payload: { name: 12345 } })

    expect(response.statusCode).toBe(400)
  })

  it('rejects POST /roles with a duplicate name', async () => {
    await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dup-role' } })

    const response = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dup-role' } })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: expect.stringContaining('dup-role') })
  })

  it('lists roles via GET /roles', async () => {
    await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-b' } })

    const response = await app.inject({ method: 'GET', url: '/roles' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(2)
  })

  it('gets a single role via GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'GET', url: `/roles/${id}` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id, name: 'role-a' })
  })

  it('returns 404 for GET /roles/:id when missing', async () => {
    const response = await app.inject({ method: 'GET', url: '/roles/999' })

    expect(response.statusCode).toBe(404)
  })

  it('updates a role via PUT /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}`,
      payload: { description: 'updated' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id, description: 'updated' })
  })

  it('rejects PUT /roles/:id with a duplicate name', async () => {
    await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const createdB = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-b' } })
    const { id } = createdB.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}`,
      payload: { name: 'role-a' }
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: expect.stringContaining('role-a') })
  })

  it('deletes a role via DELETE /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'DELETE', url: `/roles/${id}` })

    expect(response.statusCode).toBe(204)
    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.statusCode).toBe(404)
  })
})
