import { randomBytes } from 'node:crypto'
import type { KeychainClient } from './keychain-client.js'

const SERVICE = 'skillam'
const ACCOUNT = 'master-key'
const KEY_LENGTH_BYTES = 32

export class MasterKeyProvider {
  constructor(private readonly keychain: KeychainClient) {}

  getOrCreateKey(): Buffer {
    const existing = this.keychain.getPassword(SERVICE, ACCOUNT)
    if (existing) {
      return Buffer.from(existing, 'base64')
    }
    const key = randomBytes(KEY_LENGTH_BYTES)
    this.keychain.setPassword(SERVICE, ACCOUNT, key.toString('base64'))
    return key
  }
}
