// apps/server/src/catalog/permissions-scanner.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanPermissions } from './permissions-scanner.js'

describe('scanPermissions', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-permissions-scanner-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('reads a permissions block from a project settings.json', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(*)'], deny: ['Bash(rm -rf /*)'] } })
    )

    const result = scanPermissions({ projectPaths: [projectPath] })

    expect(result).toEqual([
      {
        source: 'project-local',
        projectPath,
        permissions: { allow: ['Bash(*)'], deny: ['Bash(rm -rf /*)'] }
      }
    ])
  })

  it('skips a project with no settings.json', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(projectPath, { recursive: true })

    const result = scanPermissions({ projectPaths: [projectPath] })

    expect(result).toEqual([])
  })

  it('skips a project whose settings.json has no permissions key', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { x: true } })
    )

    const result = scanPermissions({ projectPaths: [projectPath] })

    expect(result).toEqual([])
  })

  it('handles malformed JSON without throwing', () => {
    const projectPath = path.join(root, 'my-project')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.json'), '{ not valid')

    expect(() => scanPermissions({ projectPaths: [projectPath] })).not.toThrow()
    expect(scanPermissions({ projectPaths: [projectPath] })).toEqual([])
  })

  it('handles multiple projects independently', () => {
    const projectA = path.join(root, 'a')
    const projectB = path.join(root, 'b')
    fs.mkdirSync(path.join(projectA, '.claude'), { recursive: true })
    fs.mkdirSync(path.join(projectB, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectA, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Edit'] } })
    )
    fs.writeFileSync(path.join(projectB, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: {} }))

    const result = scanPermissions({ projectPaths: [projectA, projectB] })

    expect(result).toEqual([
      { source: 'project-local', projectPath: projectA, permissions: { allow: ['Edit'] } }
    ])
  })

  function writeLocalSettings(projectName: string, content: string): string {
    const projectPath = path.join(root, projectName)
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.local.json'), content)
    return projectPath
  }

  // skillam writes its own permissions to settings.local.json, so a scan that
  // only reads settings.json cannot see what skillam itself applied.
  it('returns the permissions object from settings.local.json', () => {
    const projectPath = writeLocalSettings('local-only', JSON.stringify({ permissions: { allow: ['Edit'] } }))

    expect(scanPermissions({ projectPaths: [projectPath] })).toEqual([
      { source: 'project-local', projectPath, permissions: { allow: ['Edit'] } }
    ])
  })

  it('reports both files when a project has settings.json and settings.local.json', () => {
    const projectPath = path.join(root, 'both')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash'] } })
    )
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Edit'] } })
    )

    const candidates = scanPermissions({ projectPaths: [projectPath] })

    expect(candidates.map((candidate) => candidate.permissions)).toEqual([
      { allow: ['Bash'] },
      { allow: ['Edit'] }
    ])
  })

  it('still reads settings.json when settings.local.json is not valid JSON', () => {
    const projectPath = path.join(root, 'broken-local')
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash'] } })
    )
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.local.json'), '{ not json')

    expect(scanPermissions({ projectPaths: [projectPath] })).toEqual([
      { source: 'project-local', projectPath, permissions: { allow: ['Bash'] } }
    ])
  })
})
