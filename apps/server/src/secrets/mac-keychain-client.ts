import { execFileSync } from 'node:child_process'
import type { KeychainClient } from './keychain-client.js'
import { KeychainAccessError } from './keychain-client.js'

// `execFileSync` throws an error whose `.message`/`.stack`/`.cmd` embed the
// FULL invoked command line, including every CLI argument. For
// `setPassword`, one of those arguments is the plaintext secret being
// stored. Never attach a raw execFileSync error as a `cause` — it will be
// walked and printed by both `util.inspect` on an Error and this project's
// pino logger (whose `errSerializer` includes `cause` message/stack), which
// would leak the secret into logs the first time the error is logged. This
// helper strips the error down to non-sensitive diagnostic fields only.
function sanitizeExecError(error: unknown): Error {
  if (error && typeof error === 'object') {
    const status = (error as { status?: number | null }).status
    const signal = (error as { signal?: string | null }).signal
    const stderrRaw = (error as { stderr?: Buffer | string }).stderr
    const stderrText = stderrRaw ? stderrRaw.toString().trim() : undefined
    const parts = [
      `security exited with status ${status ?? 'unknown'}`,
      signal ? `signal ${signal}` : undefined,
      stderrText ? `stderr: ${stderrText}` : undefined
    ].filter(Boolean)
    return new Error(parts.join(', '))
  }
  return new Error('unknown error from security CLI')
}

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
        { cause: sanitizeExecError(error) }
      )
    }
  }

  // Note: the password is passed as a CLI argument here (the only way the
  // `security` CLI accepts a value non-interactively). On macOS this is
  // briefly visible to other local processes via `ps`/Activity Monitor, and
  // may be captured by process-launch telemetry (EDR/MDM tooling). Accepted
  // risk for this tool's local, single-user threat model — setPassword is
  // only called once per machine (initial master key generation).
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
        { cause: sanitizeExecError(error) }
      )
    }
  }
}
