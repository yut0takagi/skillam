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
})
