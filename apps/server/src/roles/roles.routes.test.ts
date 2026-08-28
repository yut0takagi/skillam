import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'

describe('roles routes', () => {
  let db: Database.Database
  let app: FastifyInstance

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db)
  })

  it('creates a role via POST /roles', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/roles',
      payload: { name: 'frontend-dev', description: 'Frontend role' }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ name: 'frontend-dev', description: 'Frontend role' })
  })

  it('rejects POST /roles without a name', async () => {
    const response = await app.inject({ method: 'POST', url: '/roles', payload: {} })

    expect(response.statusCode).toBe(400)
  })

  it('rejects POST /roles with a non-string name', async () => {
    const response = await app.inject({ method: 'POST', url: '/roles', payload: { name: 12345 } })

    expect(response.statusCode).toBe(400)
  })

  it('rejects POST /roles with a non-string description', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/roles',
      payload: { name: 'role-x', description: true }
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects POST /roles with a duplicate name', async () => {
    await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dup-role' } })

    const response = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dup-role' } })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: expect.stringContaining('dup-role') })
  })

  it('lists roles via GET /roles', async () => {
    await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-b' } })

    const response = await app.inject({ method: 'GET', url: '/roles' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(2)
  })

  it('gets a single role via GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'GET', url: `/roles/${id}` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id, name: 'role-a' })
  })

  it('returns 404 for GET /roles/:id when missing', async () => {
    const response = await app.inject({ method: 'GET', url: '/roles/999' })

    expect(response.statusCode).toBe(404)
  })

  it('updates a role via PUT /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}`,
      payload: { description: 'updated' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id, description: 'updated' })
  })

  it('rejects PUT /roles/:id with a non-string description', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}`,
      payload: { description: [1, 2, 3] }
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id with a duplicate name', async () => {
    await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const createdB = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-b' } })
    const { id } = createdB.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}`,
      payload: { name: 'role-a' }
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: expect.stringContaining('role-a') })
  })

  it('deletes a role via DELETE /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'DELETE', url: `/roles/${id}` })

    expect(response.statusCode).toBe(204)
    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.statusCode).toBe(404)
  })

  it('replaces skills via PUT /roles/:id/skills and reflects them in GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: { skills: [{ skillSource: 'user', skillPath: '~/.claude/skills/brainstorming' }] }
    })
    expect(putResponse.statusCode).toBe(200)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().skills).toEqual([
      { id: expect.any(Number), skillSource: 'user', skillPath: '~/.claude/skills/brainstorming' }
    ])
  })

  it('returns 404 for PUT /roles/:id/skills when role is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/roles/999/skills',
      payload: { skills: [] }
    })

    expect(response.statusCode).toBe(404)
  })

  it('rejects POST /roles with no request body', async () => {
    const response = await app.inject({ method: 'POST', url: '/roles' })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id with no request body', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'PUT', url: `/roles/${id}` })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/skills with no request body', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'PUT', url: `/roles/${id}/skills` })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/skills when the body is an array instead of an object', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: []
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/skills when the skills key is missing', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/skills when a skill has a non-string skillPath', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-skills-e' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: { skills: [{ skillSource: 'user', skillPath: true }] }
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/skills when the skills array contains null (Array.find falsy-element regression)', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-skills-null' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: { skills: [null] }
    })

    expect(response.statusCode).toBe(400)
  })

  it('replaces mcp servers via PUT /roles/:id/mcp-servers and reflects them in GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/mcp-servers`,
      payload: {
        servers: [{ name: 'filesystem', command: { command: 'npx', args: [] }, env: {} }]
      }
    })
    expect(putResponse.statusCode).toBe(200)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().mcpServers).toEqual([
      { id: expect.any(Number), name: 'filesystem', command: { command: 'npx', args: [] }, env: {} }
    ])
  })

  it('returns 404 for PUT /roles/:id/mcp-servers when role is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/roles/999/mcp-servers',
      payload: { servers: [] }
    })

    expect(response.statusCode).toBe(404)
  })

  it('rejects PUT /roles/:id/mcp-servers when the body is missing', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-b' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'PUT', url: `/roles/${id}/mcp-servers` })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/mcp-servers when servers is not an array', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-c' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/mcp-servers`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/mcp-servers when a server has a non-string name (prevents silent SQLite coercion)', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-mcp-e' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/mcp-servers`,
      payload: { servers: [{ name: 123, command: { command: 'npx', args: [] }, env: {} }] }
    })

    expect(response.statusCode).toBe(400)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().mcpServers).toEqual([])
  })

  it('rejects PUT /roles/:id/mcp-servers when the servers array contains null (Array.find falsy-element regression)', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-mcp-null' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/mcp-servers`,
      payload: { servers: [null] }
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns a clean 400 instead of a raw SQLite error for invalid skill_source values', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-d' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: { skills: [{ skillSource: 'bogus', skillPath: 'x' }] }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).not.toHaveProperty('code')
  })

  it('replaces agents via PUT /roles/:id/agents and reflects them in GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/agents`,
      payload: { agents: [{ name: 'code-reviewer', markdownBody: '# Reviewer', source: 'authored' }] }
    })
    expect(putResponse.statusCode).toBe(200)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().agents).toEqual([
      {
        id: expect.any(Number),
        name: 'code-reviewer',
        markdownBody: '# Reviewer',
        source: 'authored',
        sourcePath: ''
      }
    ])
  })

  it('returns 404 for PUT /roles/:id/agents when role is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/roles/999/agents',
      payload: { agents: [] }
    })

    expect(response.statusCode).toBe(404)
  })

  it('rejects PUT /roles/:id/agents when the body is missing', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-agents-b' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'PUT', url: `/roles/${id}/agents` })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/agents when agents is not an array', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-agents-c' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/agents`,
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/agents when an agent has a non-string name', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-agents-e' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/agents`,
      payload: { agents: [{ name: true, markdownBody: '# Reviewer', source: 'authored' }] }
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects PUT /roles/:id/agents when the agents array contains null (Array.find falsy-element regression)', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-agents-null' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/agents`,
      payload: { agents: [null] }
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns a clean 400 instead of a raw SQLite error for invalid agent source values', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-agents-d' } })
    const { id } = created.json()

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/agents`,
      payload: { agents: [{ name: 'x', markdownBody: 'y', source: 'bogus' }] }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).not.toHaveProperty('code')
  })

  it('rejects a reference agent without a sourcePath', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'needs-path' } })
    const roleId = created.json().id

    const response = await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/agents`,
      payload: { agents: [{ name: 'reviewer', markdownBody: '', source: 'reference' }] }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('sourcePath')
  })

  it('sets permissions via PUT /roles/:id/permissions and reflects them in GET /roles/:id', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/roles/${id}/permissions`,
      payload: { permissions: { allow: ['Bash(git *)'] } }
    })
    expect(putResponse.statusCode).toBe(200)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().permissions).toEqual({
      roleId: id,
      permissions: { allow: ['Bash(git *)'] }
    })
  })

  it('returns null permissions in GET /roles/:id when never set', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-a' } })
    const { id } = created.json()

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${id}` })
    expect(getResponse.json().permissions).toBeNull()
  })

  it('returns 404 for PUT /roles/:id/permissions when role is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/roles/999/permissions',
      payload: { permissions: {} }
    })

    expect(response.statusCode).toBe(404)
  })

  it('rejects PUT /roles/:id/permissions when the body is missing', async () => {
    const created = await app.inject({ method: 'POST', url: '/roles', payload: { name: 'role-perms-b' } })
    const { id } = created.json()

    const response = await app.inject({ method: 'PUT', url: `/roles/${id}/permissions` })

    expect(response.statusCode).toBe(400)
  })

  it('exports a role via GET /roles/:id/export', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/roles',
      payload: { name: 'export-role', description: 'for export' }
    })
    const { id } = created.json()

    await app.inject({
      method: 'PUT',
      url: `/roles/${id}/skills`,
      payload: { skills: [{ skillSource: 'user', skillPath: '/Users/x/.claude/skills/drawio' }] }
    })
    await app.inject({
      method: 'PUT',
      url: `/roles/${id}/mcp-servers`,
      payload: {
        servers: [
          {
            name: 'github',
            command: { command: 'npx', args: [] },
            env: { TOKEN: 'secret_ref:mcp:github:TOKEN' }
          }
        ]
      }
    })
    await app.inject({
      method: 'PUT',
      url: `/roles/${id}/agents`,
      payload: {
        agents: [
          { name: 'reviewer', markdownBody: '# Reviewer', source: 'reference', sourcePath: '/Users/x/agent.md' }
        ]
      }
    })
    await app.inject({
      method: 'PUT',
      url: `/roles/${id}/permissions`,
      payload: { permissions: { allow: ['Read(*)'], deny: [] } }
    })

    const response = await app.inject({ method: 'GET', url: `/roles/${id}/export` })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body).toMatchObject({
      skillamRoleVersion: 1,
      name: 'export-role',
      description: 'for export',
      skills: [{ skillSource: 'user', skillPath: '/Users/x/.claude/skills/drawio' }],
      mcpServers: [
        {
          name: 'github',
          command: { command: 'npx', args: [] },
          env: { TOKEN: 'secret_ref:mcp:github:TOKEN' }
        }
      ],
      agents: [
        {
          name: 'reviewer',
          markdownBody: '# Reviewer',
          source: 'reference',
          sourcePath: '/Users/x/agent.md'
        }
      ],
      permissions: { allow: ['Read(*)'], deny: [] }
    })
    // The secret must survive export only as a reference, never resolved.
    expect(response.body).not.toContain('ghp_')
    expect(response.body).toContain('secret_ref:mcp:github:TOKEN')
  })

  it('returns 404 for GET /roles/:id/export when missing', async () => {
    const response = await app.inject({ method: 'GET', url: '/roles/999/export' })

    expect(response.statusCode).toBe(404)
  })

  it('imports a role via POST /roles/import, creating all four sub-resources (round-trip through HTTP)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/roles',
      payload: { name: 'source-role', description: 'original' }
    })
    const { id: sourceId } = created.json()

    await app.inject({
      method: 'PUT',
      url: `/roles/${sourceId}/skills`,
      payload: { skills: [{ skillSource: 'user', skillPath: '/Users/x/.claude/skills/drawio' }] }
    })
    await app.inject({
      method: 'PUT',
      url: `/roles/${sourceId}/mcp-servers`,
      payload: {
        servers: [
          {
            name: 'github',
            command: { command: 'npx', args: [] },
            env: { TOKEN: 'secret_ref:mcp:github:TOKEN' }
          }
        ]
      }
    })
    await app.inject({
      method: 'PUT',
      url: `/roles/${sourceId}/agents`,
      payload: {
        agents: [
          { name: 'reviewer', markdownBody: '# Reviewer', source: 'reference', sourcePath: '/Users/x/agent.md' }
        ]
      }
    })
    await app.inject({
      method: 'PUT',
      url: `/roles/${sourceId}/permissions`,
      payload: { permissions: { allow: ['Read(*)'], deny: [] } }
    })

    const exportResponse = await app.inject({ method: 'GET', url: `/roles/${sourceId}/export` })
    const payload = exportResponse.json()
    payload.name = 'imported-role'

    const importResponse = await app.inject({
      method: 'POST',
      url: '/roles/import',
      payload
    })

    expect(importResponse.statusCode).toBe(201)
    const importedRole = importResponse.json()
    expect(importedRole.name).toBe('imported-role')
    expect(importedRole.id).not.toBe(sourceId)

    const getResponse = await app.inject({ method: 'GET', url: `/roles/${importedRole.id}` })
    expect(getResponse.statusCode).toBe(200)
    const detail = getResponse.json()
    expect(detail.skills).toEqual([
      { id: expect.any(Number), skillSource: 'user', skillPath: '/Users/x/.claude/skills/drawio' }
    ])
    expect(detail.mcpServers).toEqual([
      {
        id: expect.any(Number),
        name: 'github',
        command: { command: 'npx', args: [] },
        env: { TOKEN: 'secret_ref:mcp:github:TOKEN' }
      }
    ])
    expect(detail.agents).toEqual([
      {
        id: expect.any(Number),
        name: 'reviewer',
        markdownBody: '# Reviewer',
        source: 'reference',
        sourcePath: '/Users/x/agent.md'
      }
    ])
    expect(detail.permissions).toEqual({
      roleId: importedRole.id,
      permissions: { allow: ['Read(*)'], deny: [] }
    })
  })

  it('rejects POST /roles/import with 409 when the name is already taken, and does not overwrite the existing role', async () => {
    await app.inject({
      method: 'POST',
      url: '/roles',
      payload: { name: 'taken-name', description: 'original description' }
    })

    const response = await app.inject({
      method: 'POST',
      url: '/roles/import',
      payload: {
        skillamRoleVersion: 1,
        name: 'taken-name',
        description: 'imported description',
        skills: [],
        mcpServers: [],
        agents: [],
        permissions: null
      }
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: expect.stringContaining('taken-name') })

    const listResponse = await app.inject({ method: 'GET', url: '/roles' })
    const roles = listResponse.json()
    const existing = roles.find((role: { name: string }) => role.name === 'taken-name')
    expect(existing.description).toBe('original description')
    expect(roles.filter((role: { name: string }) => role.name === 'taken-name')).toHaveLength(1)
  })

  it('rejects POST /roles/import with 400 on a malformed payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/roles/import',
      payload: { skillamRoleVersion: 1 }
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects POST /roles/import with 400 when skillamRoleVersion is unsupported', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/roles/import',
      payload: { skillamRoleVersion: 999, name: 'x' }
    })

    expect(response.statusCode).toBe(400)
  })
})
