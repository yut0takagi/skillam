import { describe, expect, it } from 'vitest'
import { diffLines } from './diff.js'

describe('diffLines', () => {
  it('marks every line as added when the file did not exist', () => {
    expect(diffLines(null, 'a\nb\n')).toEqual([
      { kind: 'added', text: 'a' },
      { kind: 'added', text: 'b' }
    ])
  })

  it('marks unchanged lines as context', () => {
    expect(diffLines('a\nb\n', 'a\nb\n')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'context', text: 'b' }
    ])
  })

  it('marks a removed line', () => {
    expect(diffLines('a\nb\n', 'a\n')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' }
    ])
  })

  it('marks a replaced line as removed then added', () => {
    expect(diffLines('a\n', 'b\n')).toEqual([
      { kind: 'removed', text: 'a' },
      { kind: 'added', text: 'b' }
    ])
  })

  it('ignores a trailing newline difference only', () => {
    expect(diffLines('a\n', 'a')).toEqual([{ kind: 'context', text: 'a' }])
  })

  it('returns an empty list for two empty files', () => {
    expect(diffLines('', '')).toEqual([])
  })

  it('preserves blank lines inside a file', () => {
    expect(diffLines(null, 'a\n\nb\n')).toEqual([
      { kind: 'added', text: 'a' },
      { kind: 'added', text: '' },
      { kind: 'added', text: 'b' }
    ])
  })
})
