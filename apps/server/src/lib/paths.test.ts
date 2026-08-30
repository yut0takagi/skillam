import { describe, expect, it } from 'vitest'
import { isPathWithin, normalizePath } from './paths.js'

describe('normalizePath', () => {
  it('leaves an already-normalized absolute path unchanged', () => {
    expect(normalizePath('/Users/example/Develop')).toBe('/Users/example/Develop')
  })

  it('strips a trailing slash', () => {
    expect(normalizePath('/Users/example/Develop/')).toBe('/Users/example/Develop')
  })

  it('strips multiple trailing slashes', () => {
    expect(normalizePath('/Users/example/Develop///')).toBe('/Users/example/Develop')
  })

  it('collapses redundant separators and relative segments', () => {
    expect(normalizePath('/Users//example/./Develop/../Develop')).toBe('/Users/example/Develop')
  })

  it('returns the root path unchanged', () => {
    expect(normalizePath('/')).toBe('/')
  })
})

describe('isPathWithin', () => {
  it('matches a directory against itself', () => {
    expect(isPathWithin('/Users/example/work', '/Users/example/work')).toBe(true)
  })

  it('matches a direct child', () => {
    expect(isPathWithin('/Users/example/work/app', '/Users/example/work')).toBe(true)
  })

  it('matches a deeply nested descendant', () => {
    expect(isPathWithin('/Users/example/work/a/b/c', '/Users/example/work')).toBe(true)
  })

  // The whole reason this is not a startsWith call. A scope on ~/work must not
  // reach into ~/workspace, which shares its prefix but is a sibling.
  it('does not match a sibling sharing the same prefix', () => {
    expect(isPathWithin('/Users/example/workspace', '/Users/example/work')).toBe(false)
  })

  it('does not match a sibling whose prefix extends further', () => {
    expect(isPathWithin('/Users/example/work-old/app', '/Users/example/work')).toBe(false)
  })

  it('does not match a parent of the root', () => {
    expect(isPathWithin('/Users/example', '/Users/example/work')).toBe(false)
  })

  it('does not match an unrelated path', () => {
    expect(isPathWithin('/tmp/other', '/Users/example/work')).toBe(false)
  })

  it('treats everything as within the filesystem root', () => {
    expect(isPathWithin('/Users/example/work', '/')).toBe(true)
  })

  it('ignores a trailing slash on the root', () => {
    expect(isPathWithin('/Users/example/work/app', '/Users/example/work/')).toBe(true)
  })

  it('normalizes relative segments before comparing', () => {
    expect(isPathWithin('/Users/example/work/../workspace', '/Users/example/work')).toBe(false)
  })
})
