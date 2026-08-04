import { execFileSync } from 'node:child_process'
import type { KeychainClient } from './keychain-client.js'
import { KeychainAccessError } from './keychain-client.js'

export class MacKeychainClient implements KeychainClient {
  getPassword(service: string, account: string): string | undefined {
    try {
      const result = execFileSync(
        'security',
        ['find-generic-password', '-s', service, '-a', account, '-w'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      )
      return result.trim()
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 44) {
        // "security" exits 44 (errSecItemNotFound) when no matching item exists.
        return undefined
      }
      throw new KeychainAccessError(
        `failed to read "${account}" from the "${service}" Keychain item`,
        { cause: error }
      )
    }
  }

  setPassword(service: string, account: string, password: string): void {
    try {
      execFileSync(
        'security',
        ['add-generic-password', '-s', service, '-a', account, '-w', password, '-U'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch (error) {
      throw new KeychainAccessError(
        `failed to write "${account}" to the "${service}" Keychain item`,
        { cause: error }
      )
    }
  }
}
