import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'

describe('projects routes', () => {
  let db: Database.Database
  let app: FastifyInstance

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db)
  })

  describe('auto-detect roots', () => {
    it('creates a root via POST /auto-detect-roots', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auto-detect-roots',
        payload: { path: '/Users/example/Develop' }
      })

      expect(response.statusCode).toBe(201)
      expect(response.json()).toMatchObject({ path: '/Users/example/Develop' })
    })

    it('rejects POST /auto-detect-roots without a path', async () => {
      const response = await app.inject({ method: 'POST', url: '/auto-detect-roots', payload: {} })

      expect(response.statusCode).toBe(400)
    })

    it('rejects POST /auto-detect-roots with no body', async () => {
      const response = await app.inject({ method: 'POST', url: '/auto-detect-roots' })

      expect(response.statusCode).toBe(400)
    })

    it('rejects a duplicate root path', async () => {
      await app.inject({
        method: 'POST',
        url: '/auto-detect-roots',
        payload: { path: '/Users/example/Develop' }
      })

      const response = await app.inject({
        method: 'POST',
        url: '/auto-detect-roots',
        payload: { path: '/Users/example/Develop' }
      })

      expect(response.statusCode).toBe(400)
    })

    it('lists roots via GET /auto-detect-roots', async () => {
      await app.inject({ method: 'POST', url: '/auto-detect-roots', payload: { path: '/a' } })
      await app.inject({ method: 'POST', url: '/auto-detect-roots', payload: { path: '/b' } })

      const response = await app.inject({ method: 'GET', url: '/auto-detect-roots' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toHaveLength(2)
    })

    it('deletes a root via DELETE /auto-detect-roots/:id', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/auto-detect-roots',
        payload: { path: '/Users/example/Develop' }
      })
      const { id } = created.json()

      const response = await app.inject({ method: 'DELETE', url: `/auto-detect-roots/${id}` })

      expect(response.statusCode).toBe(204)
      const listResponse = await app.inject({ method: 'GET', url: '/auto-detect-roots' })
      expect(listResponse.json()).toEqual([])
    })

    it('returns 404 deleting a missing root', async () => {
      const response = await app.inject({ method: 'DELETE', url: '/auto-detect-roots/999' })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('scan', () => {
    it('returns an empty array when no roots are registered', async () => {
      const response = await app.inject({ method: 'GET', url: '/projects/scan' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([])
    })

    // Expected to fail until Task 7 adds POST /projects — this test registers
    // project-a via POST /projects before asserting it's excluded from the scan.
    it('finds candidates under a registered root and excludes already-known paths', async () => {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const path = await import('node:path')

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-scan-route-test-'))
      const projectA = path.join(root, 'project-a')
      const projectB = path.join(root, 'project-b')
      fs.mkdirSync(path.join(projectA, '.git'), { recursive: true })
      fs.mkdirSync(path.join(projectB, '.claude'), { recursive: true })

      try {
        await app.inject({ method: 'POST', url: '/auto-detect-roots', payload: { path: root } })
        await app.inject({
          method: 'POST',
          url: '/projects',
          payload: { path: projectA, name: 'project-a', autoDetected: true }
        })

        const response = await app.inject({ method: 'GET', url: '/projects/scan' })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual([{ path: projectB, name: 'project-b' }])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe('projects CRUD', () => {
    it('registers a project via POST /projects when the path exists on disk', async () => {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const path = await import('node:path')
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-project-crud-test-'))

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/projects',
          payload: { path: dir, name: 'my-project' }
        })

        expect(response.statusCode).toBe(201)
        expect(response.json()).toMatchObject({
          path: dir,
          name: 'my-project',
          autoDetected: false,
          excluded: false
        })
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    it('rejects POST /projects when the path does not exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/definitely/does/not/exist/anywhere', name: 'ghost' }
      })

      expect(response.statusCode).toBe(400)
    })

    it('rejects POST /projects without a name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/tmp' }
      })

      expect(response.statusCode).toBe(400)
    })

    it('rejects POST /projects when autoDetected is not a boolean', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/tmp', name: 'x', autoDetected: 'yes' }
      })

      expect(response.statusCode).toBe(400)
    })

    it('lists projects via GET /projects', async () => {
      await app.inject({ method: 'POST', url: '/projects', payload: { path: '/tmp', name: 'tmp' } })

      const response = await app.inject({ method: 'GET', url: '/projects' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toHaveLength(1)
    })

    it('gets a single project via GET /projects/:id', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/tmp', name: 'tmp' }
      })
      const { id } = created.json()

      const response = await app.inject({ method: 'GET', url: `/projects/${id}` })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ id, name: 'tmp' })
    })

    it('returns 404 for GET /projects/:id when missing', async () => {
      const response = await app.inject({ method: 'GET', url: '/projects/999' })

      expect(response.statusCode).toBe(404)
    })

    it('updates a project via PUT /projects/:id', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/tmp', name: 'tmp' }
      })
      const { id } = created.json()

      const response = await app.inject({
        method: 'PUT',
        url: `/projects/${id}`,
        payload: { name: 'renamed', excluded: true }
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ id, name: 'renamed', excluded: true })
    })

    it('returns 404 for PUT /projects/:id when missing', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/projects/999',
        payload: { name: 'x' }
      })

      expect(response.statusCode).toBe(404)
    })

    it('deletes a project via DELETE /projects/:id', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: '/tmp', name: 'tmp' }
      })
      const { id } = created.json()

      const response = await app.inject({ method: 'DELETE', url: `/projects/${id}` })

      expect(response.statusCode).toBe(204)
      const getResponse = await app.inject({ method: 'GET', url: `/projects/${id}` })
      expect(getResponse.statusCode).toBe(404)
    })

    it('returns 404 for DELETE /projects/:id when missing', async () => {
      const response = await app.inject({ method: 'DELETE', url: '/projects/999' })

      expect(response.statusCode).toBe(404)
    })
  })
})
