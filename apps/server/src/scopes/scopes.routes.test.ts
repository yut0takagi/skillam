import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'

describe('scopes routes', () => {
  let db: Database.Database
  let app: FastifyInstance
  let scratchRoot: string

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-scopes-routes-test-')))
    app = buildApp(db)
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
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


  // Projects must exist on disk: POST /projects canonicalizes the path and
  // rejects anything that isn't a real directory.
  async function createProject(relativePath: string): Promise<number> {
    const projectPath = path.join(scratchRoot, relativePath)
    fs.mkdirSync(projectPath, { recursive: true })
    return (
      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: path.basename(relativePath) }
      })
    ).json().id
  }

  // A scope matches by path alone, so nothing on screen says which projects it
  // reaches. Registering or deleting one is otherwise a change with an
  // invisible blast radius.
  it('lists the projects a scope reaches via GET /scopes/:id/projects', async () => {
    const scopeId = await createScope(path.join(scratchRoot, 'work'))
    const inside = await createProject('work/app')
    await createProject('personal/app')

    const response = await app.inject({ method: 'GET', url: `/scopes/${scopeId}/projects` })

    expect(response.statusCode).toBe(200)
    expect(response.json().map((project: { id: number }) => project.id)).toEqual([inside])
  })

  // The same boundary isPathWithin guards: 'work-notes' starts with 'work' as
  // a string but is not underneath it.
  it('does not match a sibling directory sharing a prefix', async () => {
    const scopeId = await createScope(path.join(scratchRoot, 'work'))
    await createProject('work-notes/app')

    expect((await app.inject({ method: 'GET', url: `/scopes/${scopeId}/projects` })).json()).toEqual([])
  })

  // Excluded projects still match the path. They are reported so someone can
  // see why a role is not arriving, rather than wondering where the project
  // went.
  it('includes excluded projects', async () => {
    const scopeId = await createScope(path.join(scratchRoot, 'work'))
    const projectId = await createProject('work/app')
    await app.inject({ method: 'PUT', url: `/projects/${projectId}`, payload: { excluded: true } })

    const response = await app.inject({ method: 'GET', url: `/scopes/${scopeId}/projects` })

    expect(response.json()).toMatchObject([{ id: projectId, excluded: true }])
  })

  // Reaching a project is a property of the path, not of the bindings. A scope
  // with no roles yet still has an answer to "what would this affect?".
  it('reports reached projects even when the scope binds no roles', async () => {
    const scopeId = await createScope(path.join(scratchRoot, 'work'))
    const projectId = await createProject('work/app')

    expect((await app.inject({ method: 'GET', url: `/scopes/${scopeId}/projects` })).json()).toMatchObject([
      { id: projectId }
    ])
  })

  it('reports 404 for GET /scopes/:id/projects on an unknown scope', async () => {
    const scopeId = await createScope(path.join(scratchRoot, 'work'))

    expect(
      (await app.inject({ method: 'GET', url: `/scopes/${scopeId + 1}/projects` })).statusCode
    ).toBe(404)
  })

})
