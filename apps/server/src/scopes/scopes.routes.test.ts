import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'

describe('scopes routes', () => {
  let db: Database.Database
  let app: FastifyInstance

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db)
  })

  async function createScope(scopePath: string): Promise<number> {
    return (await app.inject({ method: 'POST', url: '/scopes', payload: { path: scopePath } })).json().id
  }

  async function createRole(name: string): Promise<number> {
    return (await app.inject({ method: 'POST', url: '/roles', payload: { name } })).json().id
  }

  it('creates a scope via POST /scopes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/scopes',
      payload: { path: '/Users/example/work' }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ path: '/Users/example/work' })
  })

  it('rejects POST /scopes without a path', async () => {
    expect((await app.inject({ method: 'POST', url: '/scopes', payload: {} })).statusCode).toBe(400)
  })

  it('rejects POST /scopes with a blank path', async () => {
    const response = await app.inject({ method: 'POST', url: '/scopes', payload: { path: '  ' } })

    expect(response.statusCode).toBe(400)
  })

  // A relative scope could never match an absolute project path, so storing
  // one would create a scope that silently does nothing.
  it('rejects a relative path', async () => {
    const response = await app.inject({ method: 'POST', url: '/scopes', payload: { path: 'work/app' } })

    expect(response.statusCode).toBe(400)
  })

  it('reports 409 on a duplicate path', async () => {
    await createScope('/Users/example/work')

    const response = await app.inject({
      method: 'POST',
      url: '/scopes',
      payload: { path: '/Users/example/work' }
    })

    expect(response.statusCode).toBe(409)
  })

  it('reports 409 on a duplicate that differs only by a trailing slash', async () => {
    await createScope('/Users/example/work')

    const response = await app.inject({
      method: 'POST',
      url: '/scopes',
      payload: { path: '/Users/example/work/' }
    })

    expect(response.statusCode).toBe(409)
  })

  it('lists scopes ordered by path', async () => {
    await createScope('/Users/example/zebra')
    await createScope('/Users/example/alpha')

    const response = await app.inject({ method: 'GET', url: '/scopes' })

    expect(response.json().map((scope: { path: string }) => scope.path)).toEqual([
      '/Users/example/alpha',
      '/Users/example/zebra'
    ])
  })

  it('gets one scope via GET /scopes/:id', async () => {
    const id = await createScope('/Users/example/work')

    expect((await app.inject({ method: 'GET', url: `/scopes/${id}` })).json()).toMatchObject({
      id,
      path: '/Users/example/work'
    })
  })

  it('reports 404 for an unknown scope', async () => {
    expect((await app.inject({ method: 'GET', url: '/scopes/9999' })).statusCode).toBe(404)
  })

  it('deletes a scope via DELETE /scopes/:id', async () => {
    const id = await createScope('/Users/example/work')

    expect((await app.inject({ method: 'DELETE', url: `/scopes/${id}` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/scopes/${id}` })).statusCode).toBe(404)
  })

  it('reports 404 when deleting an unknown scope', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/scopes/9999' })).statusCode).toBe(404)
  })

  it('assigns roles to a scope via PUT /scopes/:id/roles', async () => {
    const scopeId = await createScope('/Users/example/work')
    const roleId = await createRole('company')

    const response = await app.inject({
      method: 'PUT',
      url: `/scopes/${scopeId}/roles`,
      payload: { roleIds: [roleId] }
    })

    expect(response.json()).toEqual([{ roleId, priority: 0 }])
  })

  it('rejects role assignment referencing an unknown role', async () => {
    const scopeId = await createScope('/Users/example/work')

    const response = await app.inject({
      method: 'PUT',
      url: `/scopes/${scopeId}/roles`,
      payload: { roleIds: [9999] }
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects role assignment when roleIds is not an array', async () => {
    const scopeId = await createScope('/Users/example/work')

    const response = await app.inject({
      method: 'PUT',
      url: `/scopes/${scopeId}/roles`,
      payload: { roleIds: 'company' }
    })

    expect(response.statusCode).toBe(400)
  })

  it('reports 404 when assigning roles to an unknown scope', async () => {
    const response = await app.inject({ method: 'PUT', url: '/scopes/9999/roles', payload: { roleIds: [] } })

    expect(response.statusCode).toBe(404)
  })

  it('lists a scope’s roles via GET /scopes/:id/roles', async () => {
    const scopeId = await createScope('/Users/example/work')
    const roleId = await createRole('company')
    await app.inject({ method: 'PUT', url: `/scopes/${scopeId}/roles`, payload: { roleIds: [roleId] } })

    expect((await app.inject({ method: 'GET', url: `/scopes/${scopeId}/roles` })).json()).toEqual([
      { roleId, priority: 0 }
    ])
  })

  it('keeps roles when their scope is deleted', async () => {
    const scopeId = await createScope('/Users/example/work')
    const roleId = await createRole('company')
    await app.inject({ method: 'PUT', url: `/scopes/${scopeId}/roles`, payload: { roleIds: [roleId] } })

    await app.inject({ method: 'DELETE', url: `/scopes/${scopeId}` })

    expect((await app.inject({ method: 'GET', url: `/roles/${roleId}` })).statusCode).toBe(200)
  })
})
