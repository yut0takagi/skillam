import { describe, expect, it } from 'vitest'
import { EMPTY_MANAGED_STATE } from './managed-state.js'
import { planMcp } from './plan-mcp.js'

describe('planMcp', () => {
  it('writes a role server into an empty file', () => {
    const result = planMcp({
      currentMcpJson: {},
      roleServers: [{ name: 'github', command: { command: 'npx', args: ['-y', 'server'] }, env: {} }],
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.mcpJson).toEqual({
      mcpServers: { github: { command: 'npx', args: ['-y', 'server'] } }
    })
    expect(result.managedServers).toEqual(['github'])
  })

  it('attaches env when the role server has one', () => {
    const result = planMcp({
      currentMcpJson: {},
      roleServers: [
        { name: 'github', command: { command: 'npx' }, env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } }
      ],
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.mcpJson.mcpServers).toEqual({
      github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } }
    })
  })

  it('keeps a manually added server that skillam never managed', () => {
    const result = planMcp({
      currentMcpJson: { mcpServers: { mine: { command: 'node' } } },
      roleServers: [{ name: 'github', command: { command: 'npx' }, env: {} }],
      previous: EMPTY_MANAGED_STATE
    })

    expect(Object.keys(result.mcpJson.mcpServers as object).sort()).toEqual(['github', 'mine'])
  })

  it('removes a server that skillam applied last time but the role no longer has', () => {
    const result = planMcp({
      currentMcpJson: { mcpServers: { github: { command: 'npx' }, playwright: { command: 'npx' } } },
      roleServers: [{ name: 'github', command: { command: 'npx' }, env: {} }],
      previous: { ...EMPTY_MANAGED_STATE, mcpServers: ['github', 'playwright'] }
    })

    expect(result.mcpJson.mcpServers).toEqual({ github: { command: 'npx' } })
  })

  it('overwrites an existing server definition with the role definition', () => {
    const result = planMcp({
      currentMcpJson: { mcpServers: { github: { command: 'old', args: ['stale'] } } },
      roleServers: [{ name: 'github', command: { command: 'npx' }, env: {} }],
      previous: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] }
    })

    expect(result.mcpJson.mcpServers).toEqual({ github: { command: 'npx' } })
  })

  it('passes through unmanaged top-level keys', () => {
    const result = planMcp({
      currentMcpJson: { $schema: 'https://example.com/schema.json', mcpServers: {} },
      roleServers: [],
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.mcpJson.$schema).toBe('https://example.com/schema.json')
  })
})
