import { describe, expect, it } from 'vitest'
import { detectDrift } from './detect-drift.js'
import { EMPTY_MANAGED_STATE, type ManagedState } from './managed-state.js'

describe('detectDrift', () => {
  it('reports no drift when nothing is managed', () => {
    const result = detectDrift({
      managed: EMPTY_MANAGED_STATE,
      settings: {},
      mcpJson: {},
      current: {}
    })

    expect(result).toEqual({ hasDrift: false, items: [] })
  })

  it('reports permission-missing when a recorded allow entry is gone from settings', () => {
    const managed: ManagedState = { ...EMPTY_MANAGED_STATE, permissionAllow: ['Read(*)'] }

    const result = detectDrift({
      managed,
      settings: { permissions: { allow: [] } },
      mcpJson: {},
      current: {}
    })

    expect(result.hasDrift).toBe(true)
    expect(result.items).toEqual([
      {
        kind: 'permission-missing',
        target: 'Read(*)',
        detail: expect.stringContaining('Read(*)')
      }
    ])
  })

  it('reports no drift when the recorded entry is present alongside a user-added one', () => {
    const managed: ManagedState = { ...EMPTY_MANAGED_STATE, permissionAllow: ['Read(*)'] }

    const result = detectDrift({
      managed,
      settings: { permissions: { allow: ['Read(*)', 'Bash(git:*)'] } },
      mcpJson: {},
      current: {}
    })

    expect(result).toEqual({ hasDrift: false, items: [] })
  })

  it('reports permission-missing when a recorded deny entry is gone from settings', () => {
    const managed: ManagedState = { ...EMPTY_MANAGED_STATE, permissionDeny: ['Bash(rm:*)'] }

    const result = detectDrift({
      managed,
      settings: { permissions: { deny: [] } },
      mcpJson: {},
      current: {}
    })

    expect(result.hasDrift).toBe(true)
    expect(result.items).toEqual([
      {
        kind: 'permission-missing',
        target: 'Bash(rm:*)',
        detail: expect.stringContaining('Bash(rm:*)')
      }
    ])
  })

  it('reports mcp-server-missing when a recorded server is gone', () => {
    const managed: ManagedState = { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] }

    const result = detectDrift({
      managed,
      settings: {},
      mcpJson: { mcpServers: {} },
      current: {}
    })

    expect(result.hasDrift).toBe(true)
    expect(result.items).toEqual([
      {
        kind: 'mcp-server-missing',
        target: 'github',
        detail: expect.stringContaining('github')
      }
    ])
  })

  it('reports no drift when the recorded server is present alongside a user-added one', () => {
    const managed: ManagedState = { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] }

    const result = detectDrift({
      managed,
      settings: {},
      mcpJson: { mcpServers: { github: {}, 'my-local': {} } },
      current: {}
    })

    expect(result).toEqual({ hasDrift: false, items: [] })
  })

  it('reports materialized-missing when a recorded path is absent from current', () => {
    const managed: ManagedState = { ...EMPTY_MANAGED_STATE, materialized: ['.claude/skills/drawio'] }

    const result = detectDrift({
      managed,
      settings: {},
      mcpJson: {},
      current: {}
    })

    expect(result.hasDrift).toBe(true)
    expect(result.items).toEqual([
      {
        kind: 'materialized-missing',
        target: '.claude/skills/drawio',
        detail: expect.stringContaining('.claude/skills/drawio')
      }
    ])
  })

  it('reports materialized-changed when a recorded path is now a real directory (other)', () => {
    const managed: ManagedState = { ...EMPTY_MANAGED_STATE, materialized: ['.claude/skills/drawio'] }

    const result = detectDrift({
      managed,
      settings: {},
      mcpJson: {},
      current: { '.claude/skills/drawio': { kind: 'other' } }
    })

    expect(result.hasDrift).toBe(true)
    expect(result.items).toEqual([
      {
        kind: 'materialized-changed',
        target: '.claude/skills/drawio',
        detail: expect.stringContaining('.claude/skills/drawio')
      }
    ])
  })

  it('reports no drift when a recorded path is still a symlink', () => {
    const managed: ManagedState = { ...EMPTY_MANAGED_STATE, materialized: ['.claude/skills/drawio'] }

    const result = detectDrift({
      managed,
      settings: {},
      mcpJson: {},
      current: { '.claude/skills/drawio': { kind: 'link', target: '/home/u/.claude/skills/drawio' } }
    })

    expect(result).toEqual({ hasDrift: false, items: [] })
  })

  // Decision: managed.materialized does not record which kind (link vs file)
  // an entry was written as — skills are links, authored agents are files,
  // and both are equally legitimate outcomes of a normal apply. Without a
  // recorded "expected kind" to compare against, treating `file` as drift
  // would false-positive on every authored agent, which is exactly the kind
  // of permanent nag this tool must not produce. So `file` is treated the
  // same as `link`: present in some skillam-legitimate shape, therefore fine.
  // Only "gone" (materialized-missing) or "replaced by something skillam
  // never writes, e.g. a real directory" (materialized-changed, kind:'other')
  // are reported.
  it('reports no drift when a recorded path is now a file', () => {
    const managed: ManagedState = { ...EMPTY_MANAGED_STATE, materialized: ['.claude/agents/reviewer.md'] }

    const result = detectDrift({
      managed,
      settings: {},
      mcpJson: {},
      current: { '.claude/agents/reviewer.md': { kind: 'file', content: '# reviewer' } }
    })

    expect(result).toEqual({ hasDrift: false, items: [] })
  })

  it('reports every drift item at once, not just the first', () => {
    const managed: ManagedState = {
      mcpServers: ['github'],
      materialized: ['.claude/skills/drawio'],
      permissionAllow: ['Read(*)'],
      permissionDeny: ['Bash(rm:*)']
    }

    const result = detectDrift({
      managed,
      settings: { permissions: { allow: [], deny: [] } },
      mcpJson: { mcpServers: {} },
      current: {}
    })

    expect(result.hasDrift).toBe(true)
    expect(result.items).toHaveLength(4)
    expect(result.items.map((item) => item.kind).sort()).toEqual(
      ['materialized-missing', 'mcp-server-missing', 'permission-missing', 'permission-missing'].sort()
    )
  })

  it('treats a missing permissions object as drift for every recorded entry', () => {
    const managed: ManagedState = {
      ...EMPTY_MANAGED_STATE,
      permissionAllow: ['Read(*)'],
      permissionDeny: ['Bash(rm:*)']
    }

    const result = detectDrift({
      managed,
      settings: {},
      mcpJson: {},
      current: {}
    })

    expect(result.hasDrift).toBe(true)
    expect(result.items).toEqual(
      expect.arrayContaining([
        { kind: 'permission-missing', target: 'Read(*)', detail: expect.stringContaining('Read(*)') },
        { kind: 'permission-missing', target: 'Bash(rm:*)', detail: expect.stringContaining('Bash(rm:*)') }
      ])
    )
    expect(result.items).toHaveLength(2)
  })
})
