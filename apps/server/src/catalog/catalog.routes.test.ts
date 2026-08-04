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
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-catalog-routes-test-')))
    app = buildApp(db, new InMemoryKeychainClient(), {
      userSkillsRoot: path.join(scratchRoot, 'user-skills'),
      userAgentsRoot: path.join(scratchRoot, 'user-agents'),
      pluginsCacheRoot: path.join(scratchRoot, 'plugins-cache')
    })
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  describe('GET /catalog/skills', () => {
    it('returns an empty array when nothing is registered and env vars are unset', async () => {
      const response = await app.inject({ method: 'GET', url: '/catalog/skills' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([])
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
      expect(response.json()).toEqual([
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
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({ source: 'project-local', name: 'reviewer', description: 'Reviews things' })
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
