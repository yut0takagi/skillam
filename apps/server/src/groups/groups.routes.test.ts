import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'

describe('groups routes', () => {
  let db: Database.Database
  let app: FastifyInstance
  let scratchRoot: string

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-groups-routes-test-')))
    app = buildApp(db)
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  async function createGroup(name: string, description?: string): Promise<number> {
    const response = await app.inject({ method: 'POST', url: '/groups', payload: { name, description } })
    return response.json().id
  }

  async function createRole(name: string): Promise<number> {
    return (await app.inject({ method: 'POST', url: '/roles', payload: { name } })).json().id
  }

  async function createProject(name: string): Promise<number> {
    const projectPath = path.join(scratchRoot, name)
    fs.mkdirSync(projectPath, { recursive: true })
    return (
      await app.inject({ method: 'POST', url: '/projects', payload: { path: projectPath, name } })
    ).json().id
  }

  it('creates a group via POST /groups', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/groups',
      payload: { name: 'typescript', description: 'TS を使う PJT' }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ name: 'typescript', description: 'TS を使う PJT' })
  })

  it('rejects POST /groups without a name', async () => {
    expect((await app.inject({ method: 'POST', url: '/groups', payload: {} })).statusCode).toBe(400)
  })

  it('rejects POST /groups with a blank name', async () => {
    const response = await app.inject({ method: 'POST', url: '/groups', payload: { name: '   ' } })

    expect(response.statusCode).toBe(400)
  })

  it('rejects POST /groups with a non-string description', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/groups',
      payload: { name: 'x', description: 12345 }
    })

    expect(response.statusCode).toBe(400)
  })

  it('reports 409 on a duplicate group name', async () => {
    await createGroup('typescript')

    const response = await app.inject({ method: 'POST', url: '/groups', payload: { name: 'typescript' } })

    expect(response.statusCode).toBe(409)
  })

  it('lists groups via GET /groups', async () => {
    await createGroup('zebra')
    await createGroup('alpha')

    const response = await app.inject({ method: 'GET', url: '/groups' })

    expect(response.json().map((group: { name: string }) => group.name)).toEqual(['alpha', 'zebra'])
  })

  it('gets one group via GET /groups/:id', async () => {
    const id = await createGroup('typescript')

    const response = await app.inject({ method: 'GET', url: `/groups/${id}` })

    expect(response.json()).toMatchObject({ id, name: 'typescript' })
  })

  it('reports 404 for an unknown group', async () => {
    expect((await app.inject({ method: 'GET', url: '/groups/9999' })).statusCode).toBe(404)
  })

  it('updates a group via PUT /groups/:id', async () => {
    const id = await createGroup('typescript', 'keep')

    const response = await app.inject({ method: 'PUT', url: `/groups/${id}`, payload: { name: 'ts' } })

    expect(response.json()).toMatchObject({ name: 'ts', description: 'keep' })
  })

  it('reports 404 when updating an unknown group', async () => {
    const response = await app.inject({ method: 'PUT', url: '/groups/9999', payload: { name: 'x' } })

    expect(response.statusCode).toBe(404)
  })

  it('reports 409 when renaming a group onto an existing name', async () => {
    await createGroup('typescript')
    const other = await createGroup('python')

    const response = await app.inject({
      method: 'PUT',
      url: `/groups/${other}`,
      payload: { name: 'typescript' }
    })

    expect(response.statusCode).toBe(409)
  })

  it('allows updating a group without changing its own name', async () => {
    const id = await createGroup('typescript')

    const response = await app.inject({
      method: 'PUT',
      url: `/groups/${id}`,
      payload: { name: 'typescript', description: 'changed' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().description).toBe('changed')
  })

  it('deletes a group via DELETE /groups/:id', async () => {
    const id = await createGroup('typescript')

    expect((await app.inject({ method: 'DELETE', url: `/groups/${id}` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/groups/${id}` })).statusCode).toBe(404)
  })

  it('reports 404 when deleting an unknown group', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/groups/9999' })).statusCode).toBe(404)
  })

  it('assigns roles to a group via PUT /groups/:id/roles', async () => {
    const groupId = await createGroup('typescript')
    const roleId = await createRole('dev')

    const response = await app.inject({
      method: 'PUT',
      url: `/groups/${groupId}/roles`,
      payload: { roleIds: [roleId] }
    })

    expect(response.json()).toEqual([{ roleId, priority: 0 }])
  })

  it('rejects role assignment referencing an unknown role', async () => {
    const groupId = await createGroup('typescript')

    const response = await app.inject({
      method: 'PUT',
      url: `/groups/${groupId}/roles`,
      payload: { roleIds: [9999] }
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects role assignment when roleIds is not an array', async () => {
    const groupId = await createGroup('typescript')

    const response = await app.inject({
      method: 'PUT',
      url: `/groups/${groupId}/roles`,
      payload: { roleIds: 'dev' }
    })

    expect(response.statusCode).toBe(400)
  })

  it('reports 404 when assigning roles to an unknown group', async () => {
    const response = await app.inject({ method: 'PUT', url: '/groups/9999/roles', payload: { roleIds: [] } })

    expect(response.statusCode).toBe(404)
  })

  it('lists a group’s roles via GET /groups/:id/roles', async () => {
    const groupId = await createGroup('typescript')
    const roleId = await createRole('dev')
    await app.inject({ method: 'PUT', url: `/groups/${groupId}/roles`, payload: { roleIds: [roleId] } })

    const response = await app.inject({ method: 'GET', url: `/groups/${groupId}/roles` })

    expect(response.json()).toEqual([{ roleId, priority: 0 }])
  })

  it('joins a project to groups via PUT /projects/:id/groups', async () => {
    const projectId = await createProject('a')
    const groupId = await createGroup('typescript')

    const response = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/groups`,
      payload: { groupIds: [groupId] }
    })

    expect(response.json().map((group: { id: number }) => group.id)).toEqual([groupId])
  })

  it('rejects joining an unknown group', async () => {
    const projectId = await createProject('b')

    const response = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/groups`,
      payload: { groupIds: [9999] }
    })

    expect(response.statusCode).toBe(400)
  })

  it('reports 404 when joining groups for an unknown project', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/projects/9999/groups',
      payload: { groupIds: [] }
    })

    expect(response.statusCode).toBe(404)
  })

  it('lists a project’s groups via GET /projects/:id/groups', async () => {
    const projectId = await createProject('c')
    const groupId = await createGroup('typescript')
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/groups`, payload: { groupIds: [groupId] } })

    const response = await app.inject({ method: 'GET', url: `/projects/${projectId}/groups` })

    expect(response.json().map((group: { name: string }) => group.name)).toEqual(['typescript'])
  })

  it('lists a group’s projects via GET /groups/:id/projects', async () => {
    const projectId = await createProject('d')
    const groupId = await createGroup('typescript')
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/groups`, payload: { groupIds: [groupId] } })

    const response = await app.inject({ method: 'GET', url: `/groups/${groupId}/projects` })

    expect(response.json().map((project: { id: number }) => project.id)).toEqual([projectId])
  })

  // Deleting a group must not take the projects or roles it linked with it —
  // only the binding path disappears.
  it('keeps projects and roles when their group is deleted', async () => {
    const projectId = await createProject('e')
    const roleId = await createRole('dev')
    const groupId = await createGroup('typescript')
    await app.inject({ method: 'PUT', url: `/groups/${groupId}/roles`, payload: { roleIds: [roleId] } })
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/groups`, payload: { groupIds: [groupId] } })

    await app.inject({ method: 'DELETE', url: `/groups/${groupId}` })

    expect((await app.inject({ method: 'GET', url: `/projects/${projectId}` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/roles/${roleId}` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/projects/${projectId}/groups` })).json()).toEqual([])
  })
})
