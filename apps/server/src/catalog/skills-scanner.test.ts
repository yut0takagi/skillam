// apps/server/src/catalog/skills-scanner.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanSkills } from './skills-scanner.js'

describe('scanSkills', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-skills-scanner-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function writeSkill(dir: string, name: string, description: string): void {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody text.\n`
    )
  }

  it('finds a user-level skill directly under the skills root', () => {
    const userSkillsRoot = path.join(root, 'user-skills')
    writeSkill(path.join(userSkillsRoot, 'drawio'), 'drawio', 'Create diagrams')

    const result = scanSkills({ userSkillsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'user',
        name: 'drawio',
        description: 'Create diagrams',
        path: path.join(userSkillsRoot, 'drawio')
      }
    ])
  })

  it('skips a user-level entry that has no SKILL.md', () => {
    const userSkillsRoot = path.join(root, 'user-skills')
    fs.mkdirSync(path.join(userSkillsRoot, 'learned'), { recursive: true })

    const result = scanSkills({ userSkillsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([])
  })

  it('finds a plugin skill at a shallow depth', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    writeSkill(
      path.join(pluginsCacheRoot, 'some-plugin', 'skills', 'my-skill'),
      'my-skill',
      'A shallow plugin skill'
    )

    const result = scanSkills({ userSkillsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'plugin',
        name: 'my-skill',
        description: 'A shallow plugin skill',
        path: path.join(pluginsCacheRoot, 'some-plugin', 'skills', 'my-skill')
      }
    ])
  })

  it('finds a plugin skill nested several directories deep (marketplace/plugin/version/skills)', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    writeSkill(
      path.join(pluginsCacheRoot, 'some-marketplace', 'some-plugin', '1.0.0', 'skills', 'deep-skill'),
      'deep-skill',
      'A deeply nested plugin skill'
    )

    const result = scanSkills({ userSkillsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'plugin',
        name: 'deep-skill',
        description: 'A deeply nested plugin skill',
        path: path.join(
          pluginsCacheRoot,
          'some-marketplace',
          'some-plugin',
          '1.0.0',
          'skills',
          'deep-skill'
        )
      }
    ])
  })

  it('finds a project-local skill', () => {
    const projectPath = path.join(root, 'my-project')
    writeSkill(
      path.join(projectPath, '.claude', 'skills', 'project-skill'),
      'project-skill',
      'A project-local skill'
    )

    const result = scanSkills({
      userSkillsRoot: undefined,
      pluginsCacheRoot: undefined,
      projectPaths: [projectPath]
    })

    expect(result).toEqual([
      {
        source: 'project-local',
        name: 'project-skill',
        description: 'A project-local skill',
        path: path.join(projectPath, '.claude', 'skills', 'project-skill')
      }
    ])
  })

  it('follows a symlinked user-level skill directory', () => {
    const userSkillsRoot = path.join(root, 'user-skills')
    const realSkillDir = path.join(root, 'external-skill-location')
    writeSkill(realSkillDir, 'linked-skill', 'A symlinked skill')
    fs.mkdirSync(userSkillsRoot, { recursive: true })
    fs.symlinkSync(realSkillDir, path.join(userSkillsRoot, 'linked-skill'))

    const result = scanSkills({ userSkillsRoot, pluginsCacheRoot: undefined, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'user',
        name: 'linked-skill',
        description: 'A symlinked skill',
        path: path.join(userSkillsRoot, 'linked-skill')
      }
    ])
  })

  it('finds a plugin skill reached through a symlinked intermediate directory', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    const realPluginLocation = path.join(root, 'real-plugin-location')
    writeSkill(
      path.join(realPluginLocation, 'skills', 'symlinked-plugin-skill'),
      'symlinked-plugin-skill',
      'Reached via a symlinked plugin dir'
    )
    fs.mkdirSync(pluginsCacheRoot, { recursive: true })
    fs.symlinkSync(realPluginLocation, path.join(pluginsCacheRoot, 'some-plugin'))

    const result = scanSkills({ userSkillsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result).toEqual([
      {
        source: 'plugin',
        name: 'symlinked-plugin-skill',
        description: 'Reached via a symlinked plugin dir',
        path: path.join(pluginsCacheRoot, 'some-plugin', 'skills', 'symlinked-plugin-skill')
      }
    ])
  })

  it('does not descend into dot-prefixed directories while searching for plugin skills', () => {
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    writeSkill(
      path.join(pluginsCacheRoot, 'some-plugin', '.hidden-tool', 'skills', 'not-claude-code'),
      'not-claude-code',
      'Should not be found'
    )

    const result = scanSkills({ userSkillsRoot: undefined, pluginsCacheRoot, projectPaths: [] })

    expect(result).toEqual([])
  })

  it('returns results for multiple sources combined, each tagged correctly', () => {
    const userSkillsRoot = path.join(root, 'user-skills')
    const pluginsCacheRoot = path.join(root, 'plugins-cache')
    const projectPath = path.join(root, 'my-project')
    writeSkill(path.join(userSkillsRoot, 'a'), 'a', 'user skill')
    writeSkill(path.join(pluginsCacheRoot, 'p', 'skills', 'b'), 'b', 'plugin skill')
    writeSkill(path.join(projectPath, '.claude', 'skills', 'c'), 'c', 'project skill')

    const result = scanSkills({ userSkillsRoot, pluginsCacheRoot, projectPaths: [projectPath] })

    expect(result.map((r) => [r.source, r.name]).sort()).toEqual([
      ['plugin', 'b'],
      ['project-local', 'c'],
      ['user', 'a']
    ])
  })

  it('returns an empty array when the roots do not exist', () => {
    const result = scanSkills({
      userSkillsRoot: path.join(root, 'does-not-exist'),
      pluginsCacheRoot: path.join(root, 'also-does-not-exist'),
      projectPaths: [path.join(root, 'no-project-here')]
    })

    expect(result).toEqual([])
  })
})
