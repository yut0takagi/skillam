import { describe, expect, it } from 'vitest'
import { composeRoles, RoleCompositionConflictError, type RoleBinding } from './compose-roles.js'

function binding(overrides: Partial<RoleBinding> & Pick<RoleBinding, 'roleId'>): RoleBinding {
  return {
    origin: { kind: 'direct' },
    priority: 0,
    skills: [],
    agents: [],
    mcpServers: [],
    permissions: {},
    ...overrides
  }
}

describe('composeRoles', () => {
  it('returns empty material when nothing is bound', () => {
    const composed = composeRoles([])

    expect(composed.skills).toEqual([])
    expect(composed.agents).toEqual([])
    expect(composed.mcpServers).toEqual([])
    expect(composed.permissions).toEqual({ allow: [], deny: [] })
  })

  it('passes a single binding through unchanged', () => {
    const composed = composeRoles([
      binding({
        roleId: 1,
        skills: [{ skillSource: 'user', skillPath: '/skills/drawio' }],
        permissions: { allow: ['Read(*)'] }
      })
    ])

    expect(composed.skills).toEqual([
      { name: 'drawio', skillSource: 'user', skillPath: '/skills/drawio', origin: { kind: 'direct' } }
    ])
    expect(composed.permissions.allow).toEqual(['Read(*)'])
  })

  it('unions material from several bindings', () => {
    const composed = composeRoles([
      binding({ roleId: 1, skills: [{ skillSource: 'user', skillPath: '/skills/a' }] }),
      binding({ roleId: 2, skills: [{ skillSource: 'user', skillPath: '/skills/b' }] })
    ])

    expect(composed.skills.map((skill) => skill.name)).toEqual(['a', 'b'])
  })
})

describe('composeRoles — ordering', () => {
  // Scope is the weakest because it lands on a project merely by where the
  // directory sits; direct is the strongest because someone chose this exact
  // project. Ordering only decides which origin gets reported for a duplicate.
  it('orders scope before group before direct', () => {
    const composed = composeRoles([
      binding({ roleId: 3, origin: { kind: 'direct' }, skills: [{ skillSource: 'user', skillPath: '/s/c' }] }),
      binding({
        roleId: 1,
        origin: { kind: 'scope', path: '/work' },
        skills: [{ skillSource: 'user', skillPath: '/s/a' }]
      }),
      binding({
        roleId: 2,
        origin: { kind: 'group', name: 'ts' },
        skills: [{ skillSource: 'user', skillPath: '/s/b' }]
      })
    ])

    expect(composed.skills.map((skill) => skill.name)).toEqual(['a', 'b', 'c'])
  })

  it('orders a deeper scope after a shallower one', () => {
    const composed = composeRoles([
      binding({
        roleId: 2,
        origin: { kind: 'scope', path: '/work/company' },
        skills: [{ skillSource: 'user', skillPath: '/s/deep' }]
      }),
      binding({
        roleId: 1,
        origin: { kind: 'scope', path: '/work' },
        skills: [{ skillSource: 'user', skillPath: '/s/shallow' }]
      })
    ])

    expect(composed.skills.map((skill) => skill.name)).toEqual(['shallow', 'deep'])
  })

  it('orders by priority within the same origin kind', () => {
    const composed = composeRoles([
      binding({ roleId: 2, priority: 5, skills: [{ skillSource: 'user', skillPath: '/s/late' }] }),
      binding({ roleId: 1, priority: 1, skills: [{ skillSource: 'user', skillPath: '/s/early' }] })
    ])

    expect(composed.skills.map((skill) => skill.name)).toEqual(['early', 'late'])
  })
})

describe('composeRoles — permissions', () => {
  it('unions allow across bindings', () => {
    const composed = composeRoles([
      binding({ roleId: 1, permissions: { allow: ['Read(*)'] } }),
      binding({ roleId: 2, permissions: { allow: ['Write(*)'] } })
    ])

    expect(composed.permissions.allow).toEqual(['Read(*)', 'Write(*)'])
  })

  it('does not repeat an entry that several bindings allow', () => {
    const composed = composeRoles([
      binding({ roleId: 1, permissions: { allow: ['Read(*)'] } }),
      binding({ roleId: 2, permissions: { allow: ['Read(*)'] } })
    ])

    expect(composed.permissions.allow).toEqual(['Read(*)'])
  })

  // The one place the precedence order is deliberately inverted. A scope-level
  // deny has to survive a direct-level allow, or an organisation rule could be
  // voided by the individual it constrains.
  it('removes an entry from allow when any binding denies it', () => {
    const composed = composeRoles([
      binding({
        roleId: 1,
        origin: { kind: 'scope', path: '/work' },
        permissions: { deny: ['Bash(rm -rf*)'] }
      }),
      binding({
        roleId: 2,
        origin: { kind: 'direct' },
        permissions: { allow: ['Bash(rm -rf*)', 'Read(*)'] }
      })
    ])

    expect(composed.permissions.allow).toEqual(['Read(*)'])
    expect(composed.permissions.deny).toEqual(['Bash(rm -rf*)'])
  })

  it('reports what a deny took out of allow so the removal is visible', () => {
    const composed = composeRoles([
      binding({ roleId: 1, origin: { kind: 'scope', path: '/work' }, permissions: { deny: ['Bash(rm*)'] } }),
      binding({ roleId: 2, permissions: { allow: ['Bash(rm*)'] } })
    ])

    expect(composed.suppressedAllow).toEqual([
      { entry: 'Bash(rm*)', deniedBy: { kind: 'scope', path: '/work' } }
    ])
  })

  it('leaves suppressedAllow empty when no deny overlaps an allow', () => {
    const composed = composeRoles([binding({ roleId: 1, permissions: { allow: ['Read(*)'] } })])

    expect(composed.suppressedAllow).toEqual([])
  })
})

describe('composeRoles — conflicts', () => {
  it('folds a skill that two bindings contribute identically', () => {
    const composed = composeRoles([
      binding({ roleId: 1, skills: [{ skillSource: 'user', skillPath: '/skills/drawio' }] }),
      binding({ roleId: 2, skills: [{ skillSource: 'user', skillPath: '/skills/drawio' }] })
    ])

    expect(composed.skills).toHaveLength(1)
  })

  // Picking a winner by precedence would install a skill the user never chose
  // and give them no signal it happened: the preview shows the resulting diff,
  // not the fact that two bindings disagreed.
  it('refuses when two bindings give the same skill name different paths', () => {
    expect(() =>
      composeRoles([
        binding({
          roleId: 1,
          origin: { kind: 'group', name: 'ts' },
          skills: [{ skillSource: 'user', skillPath: '/a/playwright' }]
        }),
        binding({
          roleId: 2,
          origin: { kind: 'direct' },
          skills: [{ skillSource: 'user', skillPath: '/b/playwright' }]
        })
      ])
    ).toThrow(RoleCompositionConflictError)
  })

  it('names the conflicting item and both origins in the error', () => {
    let error: RoleCompositionConflictError | undefined
    try {
      composeRoles([
        binding({
          roleId: 1,
          origin: { kind: 'group', name: 'ts' },
          skills: [{ skillSource: 'user', skillPath: '/a/playwright' }]
        }),
        binding({
          roleId: 2,
          origin: { kind: 'direct' },
          skills: [{ skillSource: 'user', skillPath: '/b/playwright' }]
        })
      ])
    } catch (thrown) {
      error = thrown as RoleCompositionConflictError
    }

    expect(error).toBeInstanceOf(RoleCompositionConflictError)
    expect(error?.conflicts).toEqual([
      {
        kind: 'skill',
        name: 'playwright',
        origins: [
          { kind: 'group', name: 'ts' },
          { kind: 'direct' }
        ]
      }
    ])
    expect(error?.message).toContain('playwright')
  })

  it('folds an agent two bindings contribute identically', () => {
    const agent = { name: 'reviewer', markdownBody: 'body', source: 'authored' as const, sourcePath: '' }
    const composed = composeRoles([
      binding({ roleId: 1, agents: [agent] }),
      binding({ roleId: 2, agents: [agent] })
    ])

    expect(composed.agents).toHaveLength(1)
  })

  it('refuses when two bindings give the same agent name different bodies', () => {
    expect(() =>
      composeRoles([
        binding({
          roleId: 1,
          agents: [{ name: 'reviewer', markdownBody: 'one', source: 'authored', sourcePath: '' }]
        }),
        binding({
          roleId: 2,
          agents: [{ name: 'reviewer', markdownBody: 'two', source: 'authored', sourcePath: '' }]
        })
      ])
    ).toThrow(RoleCompositionConflictError)
  })

  it('folds an mcp server two bindings contribute identically', () => {
    const server = { name: 'fs', command: 'npx fs', env: { ROOT: '/a' } }
    const composed = composeRoles([
      binding({ roleId: 1, mcpServers: [server] }),
      binding({ roleId: 2, mcpServers: [server] })
    ])

    expect(composed.mcpServers).toHaveLength(1)
  })

  it('refuses when two bindings give the same mcp server a different command', () => {
    expect(() =>
      composeRoles([
        binding({ roleId: 1, mcpServers: [{ name: 'fs', command: 'npx a', env: {} }] }),
        binding({ roleId: 2, mcpServers: [{ name: 'fs', command: 'npx b', env: {} }] })
      ])
    ).toThrow(RoleCompositionConflictError)
  })

  // env carries secret references, so two bindings pointing the same server at
  // different credentials is exactly the kind of silent difference that must
  // not be resolved by precedence.
  it('refuses when two bindings give the same mcp server a different env', () => {
    expect(() =>
      composeRoles([
        binding({ roleId: 1, mcpServers: [{ name: 'fs', command: 'npx fs', env: { ROOT: '/a' } }] }),
        binding({ roleId: 2, mcpServers: [{ name: 'fs', command: 'npx fs', env: { ROOT: '/b' } }] })
      ])
    ).toThrow(RoleCompositionConflictError)
  })

  it('reports every conflict rather than stopping at the first', () => {
    let error: RoleCompositionConflictError | undefined
    try {
      composeRoles([
        binding({
          roleId: 1,
          skills: [{ skillSource: 'user', skillPath: '/a/one' }],
          mcpServers: [{ name: 'fs', command: 'npx a', env: {} }]
        }),
        binding({
          roleId: 2,
          skills: [{ skillSource: 'user', skillPath: '/b/one' }],
          mcpServers: [{ name: 'fs', command: 'npx b', env: {} }]
        })
      ])
    } catch (thrown) {
      error = thrown as RoleCompositionConflictError
    }

    expect(error?.conflicts.map((conflict) => conflict.kind)).toEqual(['skill', 'mcpServer'])
  })
})
