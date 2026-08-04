// apps/server/src/catalog/scan-helpers.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findDirsNamed, parseFrontmatterField } from './scan-helpers.js'

describe('parseFrontmatterField', () => {
  it('extracts a simple field', () => {
    const content = '---\nname: my-thing\ndescription: does stuff\n---\n\nBody.\n'
    expect(parseFrontmatterField(content, 'name')).toBe('my-thing')
  })

  it('extracts a field whose value contains a colon', () => {
    const content = '---\nname: my-thing\ndescription: Use when X: do Y\n---\n\nBody.\n'
    expect(parseFrontmatterField(content, 'description')).toBe('Use when X: do Y')
  })

  it('returns undefined when the field is absent', () => {
    const content = '---\nname: my-thing\n---\n\nBody.\n'
    expect(parseFrontmatterField(content, 'description')).toBeUndefined()
  })
})

describe('findDirsNamed', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-scan-helpers-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('finds a target directory at a shallow depth', () => {
    const searchRoot = path.join(root, 'search-root')
    fs.mkdirSync(path.join(searchRoot, 'some-container', 'widgets'), { recursive: true })

    const result = findDirsNamed(searchRoot, 'widgets')

    expect(result).toEqual([path.join(searchRoot, 'some-container', 'widgets')])
  })

  it('finds a target directory nested several levels deep', () => {
    const searchRoot = path.join(root, 'search-root')
    fs.mkdirSync(
      path.join(searchRoot, 'a', 'b', 'c', 'd', 'widgets'),
      { recursive: true }
    )

    const result = findDirsNamed(searchRoot, 'widgets')

    expect(result).toEqual([path.join(searchRoot, 'a', 'b', 'c', 'd', 'widgets')])
  })

  it('does not descend into dot-prefixed directories', () => {
    const searchRoot = path.join(root, 'search-root')
    fs.mkdirSync(path.join(searchRoot, '.hidden', 'widgets'), { recursive: true })

    const result = findDirsNamed(searchRoot, 'widgets')

    expect(result).toEqual([])
  })

  it('follows a symlinked intermediate directory to find the target dir', () => {
    const searchRoot = path.join(root, 'search-root')
    const realLocation = path.join(root, 'real-location')
    fs.mkdirSync(path.join(realLocation, 'widgets'), { recursive: true })
    fs.mkdirSync(searchRoot, { recursive: true })
    fs.symlinkSync(realLocation, path.join(searchRoot, 'linked'))

    const result = findDirsNamed(searchRoot, 'widgets')

    expect(result).toEqual([path.join(searchRoot, 'linked', 'widgets')])
  })

  it('respects the depth bound and does not find a directory beyond maxDepth', () => {
    const searchRoot = path.join(root, 'search-root')
    // 5 levels of nesting before the target dir: a/b/c/d/e/widgets
    fs.mkdirSync(path.join(searchRoot, 'a', 'b', 'c', 'd', 'e', 'widgets'), { recursive: true })

    const result = findDirsNamed(searchRoot, 'widgets', 2)

    expect(result).toEqual([])
  })

  it('finds the directory when maxDepth is sufficient', () => {
    const searchRoot = path.join(root, 'search-root')
    fs.mkdirSync(path.join(searchRoot, 'a', 'b', 'widgets'), { recursive: true })

    const result = findDirsNamed(searchRoot, 'widgets', 2)

    expect(result).toEqual([path.join(searchRoot, 'a', 'b', 'widgets')])
  })

  it('returns an empty array for a nonexistent root', () => {
    const result = findDirsNamed(path.join(root, 'does-not-exist'), 'widgets')

    expect(result).toEqual([])
  })

  it('defaults maxDepth to 8, matching the previous scanner behavior', () => {
    const searchRoot = path.join(root, 'search-root')
    // 8 levels of intermediate directories before the target dir (depth 8 from root).
    const deepPath = path.join(searchRoot, '1', '2', '3', '4', '5', '6', '7', '8', 'widgets')
    fs.mkdirSync(deepPath, { recursive: true })

    const result = findDirsNamed(searchRoot, 'widgets')

    expect(result).toEqual([deepPath])
  })
})
