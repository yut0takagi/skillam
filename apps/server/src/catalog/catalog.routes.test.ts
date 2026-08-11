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
      pluginsCacheRoot: path.join(scratchRoot, 'plugins-cache'),
      claudeJsonPath: path.join(scratchRoot, '.claude.json')
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

  describe('GET /catalog/mcp-servers', () => {
    it('extracts a real-looking env value into secrets and returns a secret_ref in its place', async () => {
      const projectPath = path.join(scratchRoot, 'mcp-project')
      fs.mkdirSync(projectPath, { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            github: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_realvalue1234567890' }
            }
          }
        })
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'mcp-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/mcp-servers' })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body).toHaveLength(1)
      expect(body[0].source).toBe('project-local')
      expect(body[0].name).toBe('github')
      expect(body[0].command.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
        'secret_ref:mcp:github:GITHUB_PERSONAL_ACCESS_TOKEN'
      )
      expect(JSON.stringify(body)).not.toContain('ghp_realvalue1234567890')

      const secretsResponse = await app.inject({ method: 'GET', url: '/secrets' })
      expect(secretsResponse.json()).toEqual([
        expect.objectContaining({ refName: 'mcp:github:GITHUB_PERSONAL_ACCESS_TOKEN' })
      ])

      const secretId = secretsResponse.json()[0].id
      const revealResponse = await app.inject({ method: 'POST', url: `/secrets/${secretId}/reveal` })
      expect(revealResponse.json()).toEqual({ value: 'ghp_realvalue1234567890' })
    })

    it('leaves a placeholder env value untouched and does not create a secret', async () => {
      const projectPath = path.join(scratchRoot, 'placeholder-project')
      fs.mkdirSync(projectPath, { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.mcp.json'),
        JSON.stringify({
          mcpServers: { x: { command: 'npx', env: { TOKEN: 'TODO_SET_YOUR_TOKEN' } } }
        })
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'placeholder-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/mcp-servers' })

      expect(response.json()[0].command.env.TOKEN).toBe('TODO_SET_YOUR_TOKEN')

      const secretsResponse = await app.inject({ method: 'GET', url: '/secrets' })
      expect(secretsResponse.json()).toEqual([])
    })

    it('does not create a duplicate secret on a second scan of the same server', async () => {
      const projectPath = path.join(scratchRoot, 'rescan-project')
      fs.mkdirSync(projectPath, { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.mcp.json'),
        JSON.stringify({ mcpServers: { svc: { command: 'x', env: { KEY: 'realvalue123456' } } } })
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'rescan-project' }
      })

      await app.inject({ method: 'GET', url: '/catalog/mcp-servers' })
      await app.inject({ method: 'GET', url: '/catalog/mcp-servers' })

      const secretsResponse = await app.inject({ method: 'GET', url: '/secrets' })
      expect(secretsResponse.json()).toHaveLength(1)
    })

    it('returns a server with no env untouched (no secrets, no crash)', async () => {
      const projectPath = path.join(scratchRoot, 'no-env-project')
      fs.mkdirSync(projectPath, { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.mcp.json'),
        JSON.stringify({ mcpServers: { simple: { command: 'node', args: ['start.js'] } } })
      )

      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { path: projectPath, name: 'no-env-project' }
      })

      const response = await app.inject({ method: 'GET', url: '/catalog/mcp-servers' })

      expect(response.statusCode).toBe(200)
      expect(response.json()[0].command).toEqual({ command: 'node', args: ['start.js'] })
    })
  })
})
