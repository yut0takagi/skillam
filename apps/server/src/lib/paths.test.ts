import { describe, expect, it } from 'vitest'
import { normalizePath } from './paths.js'

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
