import { describe, expect, it } from 'vitest'
import { extractSecretsFromEnv, looksLikePlaceholder } from './secret-extraction.js'

describe('looksLikePlaceholder', () => {
  it('treats an empty string as a placeholder', () => {
    expect(looksLikePlaceholder('')).toBe(true)
  })

  it('treats whitespace-only as a placeholder', () => {
    expect(looksLikePlaceholder('   ')).toBe(true)
  })

  it('treats TODO-prefixed values as placeholders', () => {
    expect(looksLikePlaceholder('TODO_SET_YOUR_TOKEN')).toBe(true)
    expect(looksLikePlaceholder('todo-fill-this-in')).toBe(true)
  })

  it('treats YOUR_-prefixed values as placeholders', () => {
    expect(looksLikePlaceholder('YOUR_API_KEY_HERE')).toBe(true)
  })

  it('treats angle-bracket placeholders as placeholders', () => {
    expect(looksLikePlaceholder('<your-token>')).toBe(true)
  })

  it('treats ${...}-style template placeholders as placeholders', () => {
    expect(looksLikePlaceholder('${API_KEY}')).toBe(true)
  })

  it('treats CHANGEME as a placeholder', () => {
    expect(looksLikePlaceholder('CHANGEME')).toBe(true)
    expect(looksLikePlaceholder('change_me')).toBe(true)
  })

  it('does not treat a real-looking token as a placeholder', () => {
    expect(looksLikePlaceholder('ghp_1234567890abcdefABCDEF')).toBe(false)
  })

  it('does not treat a file path as a placeholder', () => {
    expect(looksLikePlaceholder('/Users/example/credentials.json')).toBe(false)
  })
})

describe('extractSecretsFromEnv', () => {
  it('returns the env unchanged when there are no non-placeholder values', () => {
    const result = extractSecretsFromEnv('my-server', { API_KEY: 'TODO_SET_YOUR_TOKEN', EMPTY: '' })

    expect(result.sanitizedEnv).toEqual({ API_KEY: 'TODO_SET_YOUR_TOKEN', EMPTY: '' })
    expect(result.secretsToStore).toEqual([])
  })

  it('extracts a real-looking value and replaces it with a secret_ref', () => {
    const result = extractSecretsFromEnv('my-server', { GITHUB_TOKEN: 'ghp_realtoken123' })

    expect(result.secretsToStore).toEqual([
      { refName: 'mcp:my-server:GITHUB_TOKEN', value: 'ghp_realtoken123' }
    ])
    expect(result.sanitizedEnv).toEqual({ GITHUB_TOKEN: 'secret_ref:mcp:my-server:GITHUB_TOKEN' })
  })

  it('handles a mix of real and placeholder values in one env object', () => {
    const result = extractSecretsFromEnv('mixed-server', {
      REAL_SECRET: 'sk-abc123real',
      PLACEHOLDER: 'YOUR_KEY_HERE',
      PATH_LIKE: '/Users/example/creds.json'
    })

    expect(result.sanitizedEnv).toEqual({
      REAL_SECRET: 'secret_ref:mcp:mixed-server:REAL_SECRET',
      PLACEHOLDER: 'YOUR_KEY_HERE',
      PATH_LIKE: 'secret_ref:mcp:mixed-server:PATH_LIKE'
    })
    expect(result.secretsToStore).toEqual([
      { refName: 'mcp:mixed-server:REAL_SECRET', value: 'sk-abc123real' },
      { refName: 'mcp:mixed-server:PATH_LIKE', value: '/Users/example/creds.json' }
    ])
  })

  it('returns an empty env unchanged', () => {
    const result = extractSecretsFromEnv('empty-server', {})

    expect(result.sanitizedEnv).toEqual({})
    expect(result.secretsToStore).toEqual([])
  })
})
