import { describe, expect, it } from 'vitest'
import {
  fromExportPayload,
  toExportPayload,
  RoleImportError,
  ROLE_EXPORT_VERSION,
  type RoleDetail
} from './role-export.js'

function makeRoleDetail(overrides: Partial<RoleDetail> = {}): RoleDetail {
  return {
    id: 1,
    name: 'frontend-dev',
    description: 'React/Vite 系プロジェクト用',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    skills: [{ id: 10, skillSource: 'user', skillPath: '/Users/x/.claude/skills/drawio' }],
    mcpServers: [
      {
        id: 20,
        name: 'github',
        command: { command: 'npx', args: ['-y', 'server-github'] },
        env: { TOKEN: 'secret_ref:mcp:github:TOKEN' }
      }
    ],
    agents: [
      {
        id: 30,
        name: 'reviewer',
        source: 'reference',
        sourcePath: '/Users/x/.claude/agents/reviewer.md',
        markdownBody: ''
      }
    ],
    permissions: { roleId: 1, permissions: { allow: ['Read(*)'], deny: [] } },
    ...overrides
  }
}

describe('toExportPayload', () => {
  it('includes every part of the role', () => {
    const detail = makeRoleDetail()
    const payload = toExportPayload(detail)

    expect(payload).toEqual({
      skillamRoleVersion: ROLE_EXPORT_VERSION,
      name: 'frontend-dev',
      description: 'React/Vite 系プロジェクト用',
      skills: [{ skillSource: 'user', skillPath: '/Users/x/.claude/skills/drawio' }],
      mcpServers: [
        {
          name: 'github',
          command: { command: 'npx', args: ['-y', 'server-github'] },
          env: { TOKEN: 'secret_ref:mcp:github:TOKEN' }
        }
      ],
      agents: [
        {
          name: 'reviewer',
          markdownBody: '',
          source: 'reference',
          sourcePath: '/Users/x/.claude/agents/reviewer.md'
        }
      ],
      permissions: { allow: ['Read(*)'], deny: [] }
    })
  })

  it('never serializes a plaintext-looking secret value — env values stay as secret_ref: references', () => {
    const detail = makeRoleDetail({
      mcpServers: [
        {
          id: 20,
          name: 'github',
          command: { command: 'npx', args: [] },
          env: { TOKEN: 'secret_ref:mcp:github:TOKEN', OTHER: 'secret_ref:mcp:github:OTHER' }
        }
      ]
    })
    const json = JSON.stringify(toExportPayload(detail))

    // Every env value present in the serialized output must be a secret_ref:
    // reference. This locks in the invariant that this module never resolves
    // references to plaintext — it only ever forwards what role_mcp_servers
    // already stored, which is always a reference string.
    expect(json).toContain('secret_ref:mcp:github:TOKEN')
    expect(json).toContain('secret_ref:mcp:github:OTHER')
    expect(json).not.toContain('ghp_')
    expect(json).not.toMatch(/"TOKEN":"(?!secret_ref:)/)
    expect(json).not.toMatch(/"OTHER":"(?!secret_ref:)/)
  })

  it('round-trips through export then import', () => {
    const detail = makeRoleDetail()
    const exported = toExportPayload(detail)
    const parsed = fromExportPayload(exported)

    expect(parsed).toEqual({
      name: 'frontend-dev',
      description: 'React/Vite 系プロジェクト用',
      skills: [{ skillSource: 'user', skillPath: '/Users/x/.claude/skills/drawio' }],
      mcpServers: [
        {
          name: 'github',
          command: { command: 'npx', args: ['-y', 'server-github'] },
          env: { TOKEN: 'secret_ref:mcp:github:TOKEN' }
        }
      ],
      agents: [
        {
          name: 'reviewer',
          markdownBody: '',
          source: 'reference',
          sourcePath: '/Users/x/.claude/agents/reviewer.md'
        }
      ],
      permissions: { allow: ['Read(*)'], deny: [] }
    })
  })

  it('handles null permissions', () => {
    const detail = makeRoleDetail({ permissions: null })
    const payload = toExportPayload(detail)
    expect(payload.permissions).toBeNull()
  })
})

describe('fromExportPayload', () => {
  it('rejects an unknown skillamRoleVersion', () => {
    expect(() =>
      fromExportPayload({
        skillamRoleVersion: 999,
        name: 'x',
        description: '',
        skills: [],
        mcpServers: [],
        agents: [],
        permissions: null
      })
    ).toThrow(RoleImportError)
  })

  it('rejects a non-object payload', () => {
    expect(() => fromExportPayload('not an object')).toThrow(RoleImportError)
    expect(() => fromExportPayload(null)).toThrow(RoleImportError)
    expect(() => fromExportPayload([1, 2, 3])).toThrow(RoleImportError)
    expect(() => fromExportPayload(42)).toThrow(RoleImportError)
  })

  it('rejects a payload missing name', () => {
    expect(() =>
      fromExportPayload({
        skillamRoleVersion: ROLE_EXPORT_VERSION,
        description: '',
        skills: [],
        mcpServers: [],
        agents: [],
        permissions: null
      })
    ).toThrow(RoleImportError)
  })

  it('rejects a payload with an empty name', () => {
    expect(() =>
      fromExportPayload({
        skillamRoleVersion: ROLE_EXPORT_VERSION,
        name: '   ',
        skills: [],
        mcpServers: [],
        agents: [],
        permissions: null
      })
    ).toThrow(RoleImportError)
  })

  it('imports a role whose secret reference does not resolve to anything — import does not validate secrets', () => {
    const parsed = fromExportPayload({
      skillamRoleVersion: ROLE_EXPORT_VERSION,
      name: 'orphan-secret-role',
      description: '',
      skills: [],
      mcpServers: [
        {
          name: 'github',
          command: { command: 'npx', args: [] },
          env: { TOKEN: 'secret_ref:mcp:github:TOKEN-that-does-not-exist' }
        }
      ],
      agents: [],
      permissions: null
    })

    expect(parsed.mcpServers).toEqual([
      {
        name: 'github',
        command: { command: 'npx', args: [] },
        env: { TOKEN: 'secret_ref:mcp:github:TOKEN-that-does-not-exist' }
      }
    ])
  })

  it('defaults missing skills/mcpServers/agents/permissions/description to empty values', () => {
    const parsed = fromExportPayload({
      skillamRoleVersion: ROLE_EXPORT_VERSION,
      name: 'minimal-role'
    })

    expect(parsed).toEqual({
      name: 'minimal-role',
      description: '',
      skills: [],
      mcpServers: [],
      agents: [],
      permissions: null
    })
  })

  it('rejects a skill missing skillPath', () => {
    expect(() =>
      fromExportPayload({
        skillamRoleVersion: ROLE_EXPORT_VERSION,
        name: 'x',
        skills: [{ skillSource: 'user' }]
      })
    ).toThrow(RoleImportError)
  })

  it('rejects an mcp server missing a string name', () => {
    expect(() =>
      fromExportPayload({
        skillamRoleVersion: ROLE_EXPORT_VERSION,
        name: 'x',
        mcpServers: [{ command: {} }]
      })
    ).toThrow(RoleImportError)
  })

  it('rejects an agent missing markdownBody', () => {
    expect(() =>
      fromExportPayload({
        skillamRoleVersion: ROLE_EXPORT_VERSION,
        name: 'x',
        agents: [{ name: 'reviewer', source: 'authored' }]
      })
    ).toThrow(RoleImportError)
  })
})
