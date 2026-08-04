import type { KeychainClient } from './keychain-client.js'

function key(service: string, account: string): string {
  return JSON.stringify([service, account])
}

export class InMemoryKeychainClient implements KeychainClient {
  private readonly store = new Map<string, string>()

  getPassword(service: string, account: string): string | undefined {
    return this.store.get(key(service, account))
  }

  setPassword(service: string, account: string, password: string): void {
    this.store.set(key(service, account), password)
  }
}
