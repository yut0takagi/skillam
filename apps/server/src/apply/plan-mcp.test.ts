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

  it('treats a string command as the command field instead of dropping it', () => {
    const result = planMcp({
      currentMcpJson: {},
      roleServers: [{ name: 'github', command: 'npx', env: { TOKEN: 'x' } }],
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.mcpJson.mcpServers).toEqual({ github: { command: 'npx', env: { TOKEN: 'x' } } })
  })

  it('lets the role env win over an env embedded in the command object', () => {
    const result = planMcp({
      currentMcpJson: {},
      roleServers: [
        { name: 'github', command: { command: 'npx', env: { OLD: 'stale' } }, env: { TOKEN: 'new' } }
      ],
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.mcpJson.mcpServers).toEqual({ github: { command: 'npx', env: { TOKEN: 'new' } } })
  })

  it('records the definitions it wrote for its own servers', () => {
    const result = planMcp({
      currentMcpJson: { mcpServers: { handmade: { command: 'user-tool' } } },
      roleServers: [{ name: 'github', command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } }],
      previous: EMPTY_MANAGED_STATE
    })

    // The user's own server is written back to disk untouched but must not
    // enter the record: drift detection only reports what skillam wrote.
    expect(result.managedDefinitions).toEqual({
      github: { command: 'npx', envKeys: ['TOKEN'] }
    })
  })

  // The recorded definition must not alias the object handed to the executor.
  // If it did, resolveSecretRefs (or any later in-place edit) could rewrite
  // the record's `secret_ref:` placeholder into a decrypted value, putting a
  // plaintext secret into apply_history and breaking the comparison that
  // drift detection relies on.
  it('does not share mutable state between the record and the written json', () => {
    const result = planMcp({
      currentMcpJson: {},
      roleServers: [{ name: 'github', command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } }],
      previous: EMPTY_MANAGED_STATE
    })

    const written = (result.mcpJson.mcpServers as Record<string, Record<string, unknown>>).github
    written.env = { TOKEN: 'decrypted-value' }
    written.command = 'tampered'

    expect(result.managedDefinitions).toEqual({
      github: { command: 'npx', envKeys: ['TOKEN'] }
    })
  })

  // Role env values are raw unless they came through the catalog import path,
  // and this record is persisted to apply_history — so values must never
  // appear in it, whatever they look like.
  it('records env key names without their values', () => {
    const result = planMcp({
      currentMcpJson: {},
      roleServers: [
        { name: 'github', command: { command: 'npx', env: { EMBEDDED: 'raw-embedded' } }, env: {} }
      ],
      previous: EMPTY_MANAGED_STATE
    })

    expect(JSON.stringify(result.managedDefinitions)).not.toContain('raw-embedded')
    expect(result.managedDefinitions).toEqual({ github: { command: 'npx', envKeys: ['EMBEDDED'] } })
  })
})
