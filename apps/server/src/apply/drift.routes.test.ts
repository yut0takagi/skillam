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

describe('drift routes', () => {
  let db: Database.Database
  let app: FastifyInstance
  let scratchRoot: string
  let projectPath: string
  let projectId: number
  let roleId: number

  beforeEach(async () => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-drift-routes-test-')))
    projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })
    app = buildApp(db, new InMemoryKeychainClient())

    projectId = (
      await app.inject({ method: 'POST', url: '/projects', payload: { path: projectPath, name: 'p' } })
    ).json().id
    roleId = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dev' } })).json().id
    await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/permissions`,
      payload: { permissions: { allow: ['Edit'] } }
    })
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  it('reports no drift right after a clean apply', async () => {
    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })

    const response = await app.inject({ method: 'GET', url: `/projects/${projectId}/drift` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(
      expect.objectContaining({ projectId, projectPath, hasDrift: false, items: [] })
    )
    expect(response.json().lastAppliedAt).not.toBeNull()
  })

  it('reports drift when a recorded permission is removed from settings.json', async () => {
    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })

    const settingsPath = path.join(projectPath, '.claude', 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: [] } }))

    const response = await app.inject({ method: 'GET', url: `/projects/${projectId}/drift` })

    expect(response.statusCode).toBe(200)
    expect(response.json().hasDrift).toBe(true)
    expect(response.json().items).toEqual([
      expect.objectContaining({ kind: 'permission-missing', target: 'Edit' })
    ])
  })

  it('reports no drift for a project that was never applied', async () => {
    const response = await app.inject({ method: 'GET', url: `/projects/${projectId}/drift` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      projectId,
      projectPath,
      hasDrift: false,
      items: [],
      lastAppliedAt: null
    })
  })

  it('returns 404 for an unknown project', async () => {
    const response = await app.inject({ method: 'GET', url: '/projects/9999/drift' })

    expect(response.statusCode).toBe(404)
  })

  it('returns 409 when settings.json cannot be parsed', async () => {
    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.json'), '{ broken')

    const response = await app.inject({ method: 'GET', url: `/projects/${projectId}/drift` })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toContain('settings.json')
  })

  it('lists drift reports for every registered project', async () => {
    const secondPath = path.join(scratchRoot, 'project-2')
    fs.mkdirSync(secondPath, { recursive: true })
    const secondId = (
      await app.inject({ method: 'POST', url: '/projects', payload: { path: secondPath, name: 'p2' } })
    ).json().id

    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })

    const response = await app.inject({ method: 'GET', url: '/drift' })

    expect(response.statusCode).toBe(200)
    const body = response.json() as Array<{ projectId: number; hasDrift: boolean }>
    expect(body).toHaveLength(2)
    expect(body.find((r) => r.projectId === projectId)).toEqual(
      expect.objectContaining({ hasDrift: false })
    )
    expect(body.find((r) => r.projectId === secondId)).toEqual(
      expect.objectContaining({ hasDrift: false, lastAppliedAt: null })
    )
  })

  it('includes a broken project in GET /drift with an error marker instead of failing the whole list', async () => {
    const secondPath = path.join(scratchRoot, 'project-2')
    fs.mkdirSync(secondPath, { recursive: true })
    const secondRoleId = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dev2' } })).json()
      .id
    await app.inject({
      method: 'PUT',
      url: `/roles/${secondRoleId}/permissions`,
      payload: { permissions: { allow: ['Edit'] } }
    })
    const secondId = (
      await app.inject({ method: 'POST', url: '/projects', payload: { path: secondPath, name: 'p2' } })
    ).json().id
    await app.inject({ method: 'POST', url: `/projects/${secondId}/apply`, payload: { roleId: secondRoleId } })
    fs.writeFileSync(path.join(secondPath, '.claude', 'settings.json'), '{ broken')

    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })

    const response = await app.inject({ method: 'GET', url: '/drift' })

    expect(response.statusCode).toBe(200)
    const body = response.json() as Array<{ projectId: number; hasDrift: boolean; items: unknown[] }>
    expect(body).toHaveLength(2)
    expect(body.find((r) => r.projectId === projectId)).toEqual(
      expect.objectContaining({ hasDrift: false })
    )
    const broken = body.find((r) => r.projectId === secondId)
    expect(broken?.hasDrift).toBe(true)
    expect(broken?.items).toEqual([
      expect.objectContaining({
        kind: 'config-unreadable',
        target: path.join(secondPath, '.claude', 'settings.json')
      })
    ])
  })

  it('omits excluded projects from GET /drift', async () => {
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}`,
      payload: { excluded: true }
    })

    const response = await app.inject({ method: 'GET', url: '/drift' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })
})
