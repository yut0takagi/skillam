import { describe, expect, it } from 'vitest'
import {
  EMPTY_MANAGED_STATE,
  parseManagedState,
  serializeManagedState,
  staleEntries
} from './managed-state.js'

describe('parseManagedState', () => {
  it('returns the empty state for null', () => {
    expect(parseManagedState(null)).toEqual(EMPTY_MANAGED_STATE)
  })

  it('returns the empty state for malformed JSON', () => {
    expect(parseManagedState('{not json')).toEqual(EMPTY_MANAGED_STATE)
  })

  it('fills missing keys with empty arrays', () => {
    expect(parseManagedState('{"mcpServers":["github"]}')).toEqual({
      mcpServers: ['github'],
      materialized: [],
      permissionAllow: [],
      permissionDeny: []
    })
  })

  it('drops non-string entries', () => {
    expect(parseManagedState('{"mcpServers":["github",42,null]}').mcpServers).toEqual(['github'])
  })
})

describe('serializeManagedState', () => {
  it('round-trips through parseManagedState', () => {
    const state = {
      mcpServers: ['github'],
      materialized: ['.claude/skills/drawio'],
      permissionAllow: ['Edit'],
      permissionDeny: ['Bash(rm:*)']
    }

    expect(parseManagedState(serializeManagedState(state))).toEqual(state)
  })
})

describe('staleEntries', () => {
  it('returns entries that were managed before but are not desired now', () => {
    expect(staleEntries(['github', 'playwright'], ['github'])).toEqual(['playwright'])
  })

  it('returns an empty array when everything is still desired', () => {
    expect(staleEntries(['github'], ['github', 'memory'])).toEqual([])
  })
})
