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

  it('replaces skills via PUT /roles/:id/skills and reflects them in GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: { skills: [{ skillSource: 'user', skillPath: '~/.claude/skills/brainstorming' }] }
    })
    expect(putResponse.statusCode).toBe(200)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().skills).toEqual([
      { id: expect.any(Number), skillSource: 'user', skillPath: '~/.claude/skills/brainstorming' }
    ])
  })

  it('returns 404 for PUT /roles/:id/skills when role is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/roles/999/skills',
      payload: { skills: [] }
    })

    expect(response.statusCode).toBe(404)
  })

  it('rejects POST /roles with no request body', async () => {
    const response = await app.inject({ method: 'POST', url: '/roles' })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id with no request body', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'PUT', url: `/roles/${id}` })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/skills with no request body', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'PUT', url: `/roles/${id}/skills` })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/skills when the body is an array instead of an object', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: []
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/skills when the skills key is missing', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  it('replaces mcp servers via PUT /roles/:id/mcp-servers and reflects them in GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/mcp-servers`,
      payload: {
        servers: [{ name: 'filesystem', command: { command: 'npx', args: [] }, env: {} }]
      }
    })
    expect(putResponse.statusCode).toBe(200)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().mcpServers).toEqual([
      { id: expect.any(Number), name: 'filesystem', command: { command: 'npx', args: [] }, env: {} }
    ])
  })

  it('returns 404 for PUT /roles/:id/mcp-servers when role is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/roles/999/mcp-servers',
      payload: { servers: [] }
    })

    expect(response.statusCode).toBe(404)
  })

  it('rejects PUT /roles/:id/mcp-servers when the body is missing', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-b' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'PUT', url: `/roles/${id}/mcp-servers` })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/mcp-servers when servers is not an array', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-c' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/mcp-servers`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns a clean 400 instead of a raw SQLite error for invalid skill_source values', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-d' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: { skills: [{ skillSource: 'bogus', skillPath: 'x' }] }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).not.toHaveProperty('code')
  })

  it('replaces agents via PUT /roles/:id/agents and reflects them in GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/agents`,
      payload: { agents: [{ name: 'code-reviewer', markdownBody: '# Reviewer', source: 'authored' }] }
    })
    expect(putResponse.statusCode).toBe(200)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().agents).toEqual([
      { id: expect.any(Number), name: 'code-reviewer', markdownBody: '# Reviewer', source: 'authored' }
    ])
  })

  it('returns 404 for PUT /roles/:id/agents when role is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/roles/999/agents',
      payload: { agents: [] }
    })

    expect(response.statusCode).toBe(404)
  })

  it('rejects PUT /roles/:id/agents when the body is missing', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-agents-b' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'PUT', url: `/roles/${id}/agents` })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/agents when agents is not an array', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-agents-c' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/agents`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns a clean 400 instead of a raw SQLite error for invalid agent source values', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-agents-d' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/agents`,
      payload: { agents: [{ name: 'x', markdownBody: 'y', source: 'bogus' }] }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).not.toHaveProperty('code')
  })
})
