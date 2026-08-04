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
        // The route registers/walks `root` in its raw form above, but the scan
        // handler canonicalizes roots before walking (to line up with the
        // canonicalized paths POST /projects stores), so returned candidate
        // paths carry the canonical prefix (e.g. /private/var on macOS) even
        // though `root` itself was never canonicalized.
        expect(response.json()).toEqual([
          { path: fs.realpathSync.native(projectB), name: 'project-b' }
        ])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('does not resurface a project as a candidate after it is marked excluded via PUT', async () => {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const path = await import('node:path')

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-scan-exclude-test-'))
      const projectDir = path.join(root, 'project-x')
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true })

      try {
        await app.inject({ method: 'POST', url: '/auto-detect-roots', payload: { path: root } })

        const initialScan = await app.inject({ method: 'GET', url: '/projects/scan' })
        // See comment in the previous test: the scan handler canonicalizes
        // roots before walking, so the returned candidate path carries the
        // canonical prefix even though `root`/`projectDir` were never
        // canonicalized themselves.
        expect(initialScan.json()).toEqual([
          { path: fs.realpathSync.native(projectDir), name: 'project-x' }
        ])

        const registered = await app.inject({
          method: 'POST',
          url: '/projects',
          payload: { path: projectDir, name: 'project-x', autoDetected: true }
        })
        const { id } = registered.json()

        const scanAfterRegister = await app.inject({ method: 'GET', url: '/projects/scan' })
        expect(scanAfterRegister.json()).toEqual([])

        const updateResponse = await app.inject({
          method: 'PUT',
          url: `/projects/${id}`,
          payload: { excluded: true }
        })
        expect(updateResponse.json()).toMatchObject({ excluded: true })

        const scanAfterExclude = await app.inject({ method: 'GET', url: '/projects/scan' })
        expect(scanAfterExclude.json()).toEqual([])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('does not resurface a registered project after scanning via a non-canonical auto-detect root', async () => {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const path = await import('node:path')

      // os.tmpdir() returns a non-canonical path on macOS (/var/... is a
      // symlink to /private/var/...) — register it RAW, without resolving,
      // to match how a real user would register a root.
      const rawRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-scan-canon-test-'))
      const projectDir = path.join(rawRoot, 'project-y')
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true })

      try {
        await app.inject({ method: 'POST', url: '/auto-detect-roots', payload: { path: rawRoot } })

        const firstScan = await app.inject({ method: 'GET', url: '/projects/scan' })
        expect(firstScan.json()).toHaveLength(1)
        const candidate = firstScan.json()[0]

        const registered = await app.inject({
          method: 'POST',
          url: '/projects',
          payload: { path: candidate.path, name: candidate.name, autoDetected: true }
        })
        expect(registered.statusCode).toBe(201)

        const secondScan = await app.inject({ method: 'GET', url: '/projects/scan' })
        expect(secondScan.json()).toEqual([])
      } finally {
        fs.rmSync(rawRoot, { recursive: true, force: true })
      }
    })
  })

  describe('projects CRUD', () => {
    it('registers a project via POST /projects when the path exists on disk', async () => {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const path = await import('node:path')
      // Canonicalize the fixture path (see comments on the scan tests above) so the
      // assertion below matches what POST /projects now stores via
      // fs.realpathSync.native, independent of macOS's /var -> /private/var symlink.
      const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-project-crud-test-')))

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

    it('rejects registering the same directory twice under different case (case-insensitive filesystem)', async () => {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const path = await import('node:path')
      // Canonicalize the base temp dir itself (see comments on earlier fixtures) so
      // the route's fs.realpathSync.native output can be compared by plain string
      // equality below, isolating the assertion to the case-folding behavior this
      // test targets rather than macOS's unrelated /var -> /private/var symlink.
      const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-case-dup-test-')))
      const realProjectDir = path.join(dir, 'myproject')
      fs.mkdirSync(realProjectDir)
      const differentlyCasedPath = path.join(dir, 'MYPROJECT')

      try {
        const first = await app.inject({
          method: 'POST',
          url: '/projects',
          payload: { path: differentlyCasedPath, name: 'a' }
        })
        expect(first.statusCode).toBe(201)
        // The stored path should be the real on-disk casing, not the differently-cased input
        expect(first.json().path).toBe(realProjectDir)

        const second = await app.inject({
          method: 'POST',
          url: '/projects',
          payload: { path: realProjectDir, name: 'b' }
        })
        expect(second.statusCode).toBe(400)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
