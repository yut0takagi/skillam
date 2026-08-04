import { beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { KeychainAccessError } from './keychain-client.js'
import { MacKeychainClient } from './mac-keychain-client.js'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn()
}))

const mockedExecFileSync = vi.mocked(execFileSync)

describe('MacKeychainClient', () => {
  beforeEach(() => {
    mockedExecFileSync.mockReset()
  })

  it('returns the trimmed password when security find-generic-password succeeds', () => {
    mockedExecFileSync.mockReturnValue('the-password\n')
    const client = new MacKeychainClient()

    expect(client.getPassword('skillam', 'master-key')).toBe('the-password')
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'security',
      ['find-generic-password', '-s', 'skillam', '-a', 'master-key', '-w'],
      expect.objectContaining({ encoding: 'utf-8' })
    )
  })

  it('returns undefined when security exits with status 44 (item not found)', () => {
    const error = Object.assign(new Error('Command failed'), { status: 44 })
    mockedExecFileSync.mockImplementation(() => {
      throw error
    })
    const client = new MacKeychainClient()

    expect(client.getPassword('skillam', 'master-key')).toBeUndefined()
  })

  it('throws a KeychainAccessError for a non-44 failure on getPassword', () => {
    const error = Object.assign(new Error('Command failed: security find-generic-password ...'), {
      status: 1
    })
    mockedExecFileSync.mockImplementation(() => {
      throw error
    })
    const client = new MacKeychainClient()

    expect(() => client.getPassword('skillam', 'master-key')).toThrow(KeychainAccessError)
  })

  it('calls security add-generic-password with -U to allow overwriting an existing item', () => {
    mockedExecFileSync.mockReturnValue('')
    const client = new MacKeychainClient()

    client.setPassword('skillam', 'master-key', 'new-password-value')

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'security',
      ['add-generic-password', '-s', 'skillam', '-a', 'master-key', '-w', 'new-password-value', '-U'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
    )
  })

  it('throws a KeychainAccessError when setPassword fails, WITHOUT leaking the password into the error', () => {
    const secretValue = 'THIS-MUST-NEVER-APPEAR-IN-ANY-ERROR-OUTPUT'
    const rawError = Object.assign(
      new Error(`Command failed: security add-generic-password -s skillam -a master-key -w ${secretValue} -U`),
      { status: 1, stderr: 'security: some generic failure' }
    )
    mockedExecFileSync.mockImplementation(() => {
      throw rawError
    })
    const client = new MacKeychainClient()

    let caught: unknown
    try {
      client.setPassword('skillam', 'master-key', secretValue)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(KeychainAccessError)
    const err = caught as KeychainAccessError
    expect(err.message).not.toContain(secretValue)
    expect(String(err.cause)).not.toContain(secretValue)
    expect((err.cause as Error | undefined)?.stack ?? '').not.toContain(secretValue)
  })
})
