import { describe, expect, it } from 'vitest'
import { InMemoryKeychainClient } from './in-memory-keychain-client.js'
import { MasterKeyProvider } from './master-key-provider.js'

describe('MasterKeyProvider', () => {
  it('generates a 32-byte key on first use', () => {
    const provider = new MasterKeyProvider(new InMemoryKeychainClient())

    const key = provider.getOrCreateKey()

    expect(key).toBeInstanceOf(Buffer)
    expect(key.length).toBe(32)
  })

  it('returns the same key on subsequent calls within one provider instance', () => {
    const provider = new MasterKeyProvider(new InMemoryKeychainClient())

    const first = provider.getOrCreateKey()
    const second = provider.getOrCreateKey()

    expect(second.equals(first)).toBe(true)
  })

  it('persists the key across separate provider instances sharing the same keychain client', () => {
    const keychain = new InMemoryKeychainClient()
    const first = new MasterKeyProvider(keychain).getOrCreateKey()

    const second = new MasterKeyProvider(keychain).getOrCreateKey()

    expect(second.equals(first)).toBe(true)
  })

  it('generates different keys for independent keychain clients', () => {
    const first = new MasterKeyProvider(new InMemoryKeychainClient()).getOrCreateKey()
    const second = new MasterKeyProvider(new InMemoryKeychainClient()).getOrCreateKey()

    expect(second.equals(first)).toBe(false)
  })
})
