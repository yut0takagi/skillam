import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'
import { InMemoryKeychainClient } from '../secrets/in-memory-keychain-client.js'

describe('project roles routes', () => {
  let db: Database.Database
  let app: FastifyInstance
  let scratchRoot: string
  let projectId: number
  let roleId: number

  beforeEach(async () => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db, new InMemoryKeychainClient())

    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-project-roles-route-test-'))
    const project = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: { path: scratchRoot, name: 'p' }
    })
    projectId = project.json().id

    const role = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dev' } })
    roleId = role.json().id
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  it('returns an empty list before any role is assigned', async () => {
    const response = await app.inject({ method: 'GET', url: `/projects/${projectId}/roles` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })

  it('assigns roles to a project', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [roleId] }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([{ roleId, priority: 0 }])
  })

  it('returns 404 for an unknown project', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/projects/9999/roles',
      payload: { roleIds: [roleId] }
    })

    expect(response.statusCode).toBe(404)
  })

  it('returns 400 when a role id does not exist', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [9999] }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('9999')
  })

  it('returns 400 when roleIds is not an array', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: 'dev' }
    })

    expect(response.statusCode).toBe(400)
  })

  it('accepts the same role id twice and stores it once', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/roles`,
      payload: { roleIds: [roleId, roleId] }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([{ roleId, priority: 0 }])
  })
})
