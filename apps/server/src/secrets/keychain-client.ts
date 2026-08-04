export interface KeychainClient {
  getPassword(service: string, account: string): string | undefined
  setPassword(service: string, account: string, password: string): void
}

export class KeychainAccessError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'KeychainAccessError'
  }
}
