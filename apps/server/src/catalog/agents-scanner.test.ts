// apps/server/src/catalog/agents-scanner.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanAgents } from './agents-scanner.js'

describe('scanAgents', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-agents-scanner-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function writeAgent(dir: string, filename: string, name: string, description: string): void {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, filename),
      `---\nname: ${name}\ndescription: ${description}\ntools: Read, Write\ncolor: cyan\n---\n\n<role>\nBody text.\n</role>\n`
    )
  }

  it('finds a user-level agent', () => {
    const userAgentsRoot = path.join(root, 'user-agents')
    writeAgent(userAgentsRoot, 'reviewer.md', 'reviewer', 'Reviews code')

    const result = scanAgents({ userAgentsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'user',
        name: 'reviewer',
        description: 'Reviews code',
        markdownBody: fs.readFileSync(path.join(userAgentsRoot, 'reviewer.md'), 'utf-8'),
        path: path.join(userAgentsRoot, 'reviewer.md')
      }
    ])
  })

  it('ignores non-markdown files in the agents root', () => {
    const userAgentsRoot = path.join(root, 'user-agents')
    fs.mkdirSync(userAgentsRoot, { recursive: true })
    fs.writeFileSync(path.join(userAgentsRoot, 'notes.txt'), 'not an agent')

    const result = scanAgents({ userAgentsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([])
  })

  it('finds a plugin agent at a shallow depth', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    writeAgent(path.join(pluginsCacheRoot, 'some-plugin', 'agents'), 'helper.md', 'helper', 'Helps out')

    const result = scanAgents({ userAgentsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'plugin',
        name: 'helper',
        description: 'Helps out',
        markdownBody: fs.readFileSync(
          path.join(pluginsCacheRoot, 'some-plugin', 'agents', 'helper.md'),
          'utf-8'
        ),
        path: path.join(pluginsCacheRoot, 'some-plugin', 'agents', 'helper.md')
      }
    ])
  })

  it('does not descend into dot-prefixed tool directories (e.g. a bundled .codex/agents)', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    writeAgent(
      path.join(pluginsCacheRoot, 'some-plugin', '.codex', 'agents'),
      'codex-agent.md',
      'codex-agent',
      'Not for Claude Code'
    )
    writeAgent(
      path.join(pluginsCacheRoot, 'some-plugin', 'agents'),
      'real-agent.md',
      'real-agent',
      'For Claude Code'
    )

    const result = scanAgents({ userAgentsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result.map((r) => r.name)).toEqual(['real-agent'])
  })

  it('finds a project-local agent', () => {
    const projectPath = path.join(root, 'my-project')
    writeAgent(path.join(projectPath, '.claude', 'agents'), 'local.md', 'local', 'A project agent')

    const result = scanAgents({
      userAgentsRoot: undefined,
      pluginsCacheRoot: undefined,
      projectPaths: [projectPath]
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ source: 'project-local', name: 'local' })
  })

  it('skips a markdown file with no name in frontmatter', () => {
    const userAgentsRoot = path.join(root, 'user-agents')
    fs.mkdirSync(userAgentsRoot, { recursive: true })
    fs.writeFileSync(path.join(userAgentsRoot, 'broken.md'), '---\ndescription: no name here\n---\nbody')

    const result = scanAgents({ userAgentsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([])
  })

  it('finds a plugin agent reached through a symlinked intermediate directory', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    const realPluginLocation = path.join(root, 'real-plugin-location')
    writeAgent(path.join(realPluginLocation, 'agents'), 'symlinked.md', 'symlinked-agent', 'Reached via a symlinked plugin dir')
    fs.mkdirSync(pluginsCacheRoot, { recursive: true })
    fs.symlinkSync(realPluginLocation, path.join(pluginsCacheRoot, 'some-plugin'))

    const result = scanAgents({ userAgentsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ source: 'plugin', name: 'symlinked-agent' })
  })

  it('returns an empty array when the roots do not exist', () => {
    const result = scanAgents({
      userAgentsRoot: path.join(root, 'does-not-exist'),
      pluginsCacheRoot: path.join(root, 'also-does-not-exist'),
      projectPaths: [path.join(root, 'no-project-here')]
    })

    expect(result).toEqual([])
  })
})
