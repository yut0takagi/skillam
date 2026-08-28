import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileOrNull, readJsonObject, readCurrentEntry, UnreadableConfigError } from './project-state.js'

describe('project-state', () => {
  let root: string

  beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-state-test-')))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('returns null for a file that does not exist', () => {
    expect(readFileOrNull(path.join(root, 'nope.json'))).toBeNull()
  })

  it('reads an existing file', () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'hi')
    expect(readFileOrNull(path.join(root, 'a.txt'))).toBe('hi')
  })

  it('treats a missing file as an empty object', () => {
    expect(readJsonObject(null, '/x.json')).toEqual({})
  })

  it('refuses to interpret a file that is not valid json', () => {
    expect(() => readJsonObject('{ broken', '/x.json')).toThrow(UnreadableConfigError)
  })

  it('refuses to interpret json that is not an object', () => {
    expect(() => readJsonObject('[1,2]', '/x.json')).toThrow(UnreadableConfigError)
  })

  it('reports a symlink with its target', () => {
    const target = path.join(root, 'target')
    fs.mkdirSync(target)
    fs.symlinkSync(target, path.join(root, 'link'))

    expect(readCurrentEntry(root, 'link')).toEqual({ kind: 'link', target })
  })

  it('reports a regular file with its content', () => {
    fs.writeFileSync(path.join(root, 'f.md'), '# hi')

    expect(readCurrentEntry(root, 'f.md')).toEqual({ kind: 'file', content: '# hi' })
  })

  it('reports a real directory as other, not as an empty file', () => {
    fs.mkdirSync(path.join(root, 'dir'))

    expect(readCurrentEntry(root, 'dir')).toEqual({ kind: 'other' })
  })

  it('returns undefined for a path that does not exist', () => {
    expect(readCurrentEntry(root, 'gone')).toBeUndefined()
  })
})
