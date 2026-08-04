// apps/server/src/catalog/mcp-servers-scanner.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanMcpServers } from './mcp-servers-scanner.js'

describe('scanMcpServers', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-mcp-scanner-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('reads user-level servers from the claudeJsonPath\'s mcpServers key', () => {
    const claudeJsonPath = path.join(root, '.claude.json')
    fs.writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        someUnrelatedKey: 'ignored',
        mcpServers: {
          filesystem: { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'], env: {} }
        }
      })
    )

    const result = scanMcpServers({ claudeJsonPath, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'user',
        name: 'filesystem',
        command: { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'], env: {} }
      }
    ])
  })

  it('reads an http-type user-level server without a command/args shape', () => {
    const claudeJsonPath = path.join(root, '.claude.json')
    fs.writeFileSync(
      claudeJsonPath,
      JSON.stringify({ mcpServers: { notion: { type: 'http', url: 'https://mcp.notion.com/mcp' } } })
    )

    const result = scanMcpServers({ claudeJsonPath, projectPaths: [] })

    expect(result).toEqual([
      { source: 'user', name: 'notion', command: { type: 'http', url: 'https://mcp.notion.com/mcp' } }
    ])
  })

  it('returns an empty array when claudeJsonPath does not exist', () => {
    const result = scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [] })

    expect(result).toEqual([])
  })

  it('returns an empty array when claudeJsonPath has no mcpServers key', () => {
    const claudeJsonPath = path.join(root, '.claude.json')
    fs.writeFileSync(claudeJsonPath, JSON.stringify({ someOtherKey: true }))

    const result = scanMcpServers({ claudeJsonPath, projectPaths: [] })

    expect(result).toEqual([])
  })

  it('reads project-level servers from .mcp.json', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(projectPath, { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { local: { command: 'node', args: ['start.mjs'] } } })
    )

    const result = scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })

    expect(result).toEqual([
      { source: 'project-local', name: 'local', command: { command: 'node', args: ['start.mjs'] } }
    ])
  })

  it('reads project-level servers from .claude/settings.json when .mcp.json is absent', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { fromSettings: { command: 'python3', args: ['server.py'] } } })
    )

    const result = scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })

    expect(result).toEqual([
      { source: 'project-local', name: 'fromSettings', command: { command: 'python3', args: ['server.py'] } }
    ])
  })

  it('merges .mcp.json and .claude/settings.json servers for the same project without duplicating a name defined in both (prefers .mcp.json)', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { shared: { command: 'from-mcp-json' } } })
    )
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({
        mcpServers: { shared: { command: 'from-settings-json' }, onlyInSettings: { command: 'x' } }
      })
    )

    const result = scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })

    expect(result).toEqual([
      { source: 'project-local', name: 'shared', command: { command: 'from-mcp-json' } },
      { source: 'project-local', name: 'onlyInSettings', command: { command: 'x' } }
    ])
  })

  it('handles a project with neither file gracefully', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(projectPath, { recursive: true })

    const result = scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })

    expect(result).toEqual([])
  })

  it('handles malformed JSON in a project file without throwing', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(projectPath, { recursive: true })
    fs.writeFileSync(path.join(projectPath, '.mcp.json'), '{ not valid json')

    expect(() =>
      scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })
    ).not.toThrow()
    expect(
      scanMcpServers({ claudeJsonPath: path.join(root, 'missing.json'), projectPaths: [projectPath] })
    ).toEqual([])
  })
})
