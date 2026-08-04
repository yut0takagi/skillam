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
})
