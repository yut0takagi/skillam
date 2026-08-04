// apps/server/src/catalog/catalog.routes.test.ts
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

describe('catalog routes', () => {
  let db: Database.Database
  let app: FastifyInstance
  let scratchRoot: string

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db, new InMemoryKeychainClient())
    // Canonicalize immediately so later path comparisons against what
    // POST /projects stores (which canonicalizes via fs.realpathSync.native)
    // aren't broken by macOS's /var -> /private/var symlink, matching the
    // convention used in projects.routes.test.ts.
    scratchRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-catalog-routes-test-'))
    )
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  describe('GET /catalog/skills', () => {
    // NOTE: /catalog/skills also scans the real ~/.claude/skills and
    // ~/.claude/plugins/cache on the machine running the tests (that's the
    // whole point of the route), so on a developer machine with real Claude
    // Code skills/plugins installed the response is never actually []. These
    // assertions filter to source: 'project-local' (or assert its absence)
    // so the test verifies this route's own logic — wiring registered
    // project paths into scanSkills — independent of whatever else happens
    // to be installed on the host machine.
    it('returns no project-local entries when nothing is registered', async () => {
      const response = await app.inject({ method: 'GET', url: '/catalog/skills' })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body.some((entry: { source: string }) => entry.source === 'project-local')).toBe(false)
    })

    it('finds skills under a registered project once a project is registered', async () => {
      const projectPath = path.join(scratchRoot, 'my-project')
      const skillDir = path.join(projectPath, '.claude', 'skills', 'demo')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: demo\ndescription: A demo skill\n---\n\nBody\n'
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'my-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/skills' })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      const projectLocalEntries = body.filter(
        (entry: { source: string }) => entry.source === 'project-local'
      )
      expect(projectLocalEntries).toEqual([
        {
          source: 'project-local',
          name: 'demo',
          description: 'A demo skill',
          path: skillDir
        }
      ])
    })
  })

  describe('GET /catalog/agents', () => {
    it('finds agents under a registered project', async () => {
      const projectPath = path.join(scratchRoot, 'agent-project')
      const agentsDir = path.join(projectPath, '.claude', 'agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(
        path.join(agentsDir, 'reviewer.md'),
        '---\nname: reviewer\ndescription: Reviews things\n---\n\nBody\n'
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'agent-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/agents' })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      // Filtered for the same reason as the /catalog/skills tests above:
      // the route also scans the real ~/.claude/agents and plugins cache.
      const projectLocalEntries = body.filter(
        (entry: { source: string }) => entry.source === 'project-local'
      )
      expect(projectLocalEntries).toHaveLength(1)
      expect(projectLocalEntries[0]).toMatchObject({
        source: 'project-local',
        name: 'reviewer',
        description: 'Reviews things'
      })
    })
  })

  describe('GET /catalog/permissions', () => {
    it('finds a permissions block under a registered project', async () => {
      const projectPath = path.join(scratchRoot, 'perms-project')
      fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.claude', 'settings.json'),
        JSON.stringify({ permissions: { allow: ['Edit'] } })
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'perms-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/permissions' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([
        { source: 'project-local', projectPath, permissions: { allow: ['Edit'] } }
      ])
    })

    it('returns an empty array when no registered project has a permissions block', async () => {
      const response = await app.inject({ method: 'GET', url: '/catalog/permissions' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([])
    })
  })
})
