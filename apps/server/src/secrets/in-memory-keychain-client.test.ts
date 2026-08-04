import { describe, expect, it } from 'vitest'
import { InMemoryKeychainClient } from './in-memory-keychain-client.js'

describe('InMemoryKeychainClient', () => {
  it('returns undefined for a password that was never set', () => {
    const client = new InMemoryKeychainClient()

    expect(client.getPassword('skillam', 'master-key')).toBeUndefined()
  })

  it('stores and retrieves a password', () => {
    const client = new InMemoryKeychainClient()

    client.setPassword('skillam', 'master-key', 'super-secret-value')

    expect(client.getPassword('skillam', 'master-key')).toBe('super-secret-value')
  })

  it('scopes passwords by both service and account', () => {
    const client = new InMemoryKeychainClient()

    client.setPassword('skillam', 'account-a', 'value-a')
    client.setPassword('skillam', 'account-b', 'value-b')
    client.setPassword('other-service', 'account-a', 'value-c')

    expect(client.getPassword('skillam', 'account-a')).toBe('value-a')
    expect(client.getPassword('skillam', 'account-b')).toBe('value-b')
    expect(client.getPassword('other-service', 'account-a')).toBe('value-c')
  })

  it('overwrites an existing password for the same service and account', () => {
    const client = new InMemoryKeychainClient()

    client.setPassword('skillam', 'master-key', 'first')
    client.setPassword('skillam', 'master-key', 'second')

    expect(client.getPassword('skillam', 'master-key')).toBe('second')
  })
})
