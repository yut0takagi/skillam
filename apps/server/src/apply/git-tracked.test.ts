import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listTrackedPaths, isTracked } from './git-tracked.js'

let repo: string

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-git-'))
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('listTrackedPaths', () => {
  it('reports a committed .claude/settings.json as tracked', () => {
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), '{}')
    git('add', '.claude/settings.json')
    git('commit', '-qm', 'add settings')

    const tracked = listTrackedPaths(repo)

    expect(tracked).toContain('.claude/settings.json')
  })

  it('does not report an untracked file', () => {
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), '{}')

    expect(listTrackedPaths(repo)).not.toContain('.claude/settings.json')
  })

  // A non-repo must not be reported as "everything tracked" — that would make
  // every apply outside git fail closed for no reason.
  it('returns an empty list outside a git repository', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-plain-'))
    try {
      expect(listTrackedPaths(plain)).toEqual([])
    } finally {
      fs.rmSync(plain, { recursive: true, force: true })
    }
  })
})

describe('isTracked', () => {
  it('matches a file tracked under a parent directory path', () => {
    expect(isTracked(['.claude/settings.json'], '.claude/settings.json')).toBe(true)
  })

  it('does not match a sibling with a shared prefix', () => {
    expect(isTracked(['.claude/settings.json'], '.claude/settings.local.json')).toBe(false)
  })

  // skills/ is materialized as a directory symlink; git tracks the files
  // beneath it, so the check must look for descendants too.
  it('matches a directory whose descendants are tracked', () => {
    expect(isTracked(['.claude/skills/foo/SKILL.md'], '.claude/skills/foo')).toBe(true)
  })
})
