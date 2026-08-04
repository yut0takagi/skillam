import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanForCandidates } from './scanner.js'

describe('scanForCandidates', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-scanner-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function makeDir(...segments: string[]): string {
    const dir = path.join(root, ...segments)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  it('finds a directory with a .git marker', () => {
    const projectDir = makeDir('project-a')
    fs.mkdirSync(path.join(projectDir, '.git'))

    const candidates = scanForCandidates([root], new Set())

    expect(candidates).toEqual([{ path: projectDir, name: 'project-a' }])
  })

  it('finds a directory with a .claude marker', () => {
    const projectDir = makeDir('project-b')
    fs.mkdirSync(path.join(projectDir, '.claude'))

    const candidates = scanForCandidates([root], new Set())

    expect(candidates).toEqual([{ path: projectDir, name: 'project-b' }])
  })

  it('finds nested projects several directories deep', () => {
    const nested = makeDir('workspace', 'nested', 'project-c')
    fs.mkdirSync(path.join(nested, '.git'))

    const candidates = scanForCandidates([root], new Set())

    expect(candidates).toEqual([{ path: nested, name: 'project-c' }])
  })

  it('does not recurse into node_modules', () => {
    const trap = makeDir('node_modules', 'some-package')
    fs.mkdirSync(path.join(trap, '.git'))
    const realProject = makeDir('project-d')
    fs.mkdirSync(path.join(realProject, '.git'))

    const candidates = scanForCandidates([root], new Set())

    expect(candidates).toEqual([{ path: realProject, name: 'project-d' }])
  })

  it('does not recurse further once a project marker is found', () => {
    const outer = makeDir('outer')
    fs.mkdirSync(path.join(outer, '.git'))
    fs.mkdirSync(path.join(outer, 'inner'))
    fs.mkdirSync(path.join(outer, 'inner', '.git'))

    const candidates = scanForCandidates([root], new Set())

    expect(candidates).toEqual([{ path: outer, name: 'outer' }])
  })

  it('excludes paths already known', () => {
    const projectDir = makeDir('project-e')
    fs.mkdirSync(path.join(projectDir, '.git'))

    const candidates = scanForCandidates([root], new Set([projectDir]))

    expect(candidates).toEqual([])
  })

  it('returns an empty array when nothing matches', () => {
    makeDir('just-a-folder')

    expect(scanForCandidates([root], new Set())).toEqual([])
  })
})
