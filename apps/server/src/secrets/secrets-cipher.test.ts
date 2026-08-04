import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decrypt, encrypt } from './secrets-cipher.js'

describe('secrets-cipher', () => {
  it('round-trips a plaintext value through encrypt then decrypt', () => {
    const key = randomBytes(32)

    const encrypted = encrypt('sk-abc123-super-secret', key)
    const decrypted = decrypt(encrypted, key)

    expect(decrypted).toBe('sk-abc123-super-secret')
  })

  it('produces different ciphertext for the same plaintext on repeated calls', () => {
    const key = randomBytes(32)

    const first = encrypt('same-value', key)
    const second = encrypt('same-value', key)

    expect(first).not.toBe(second)
  })

  it('round-trips an empty string', () => {
    const key = randomBytes(32)

    expect(decrypt(encrypt('', key), key)).toBe('')
  })

  it('round-trips a value containing unicode characters', () => {
    const key = randomBytes(32)

    expect(decrypt(encrypt('パスワード🔑', key), key)).toBe('パスワード🔑')
  })

  it('throws when decrypting with the wrong key', () => {
    const encrypted = encrypt('secret', randomBytes(32))

    expect(() => decrypt(encrypted, randomBytes(32))).toThrow()
  })

  it('throws when the ciphertext has been tampered with', () => {
    const key = randomBytes(32)
    const encrypted = encrypt('secret', key)
    const [iv, authTag, ciphertext] = encrypted.split('.')
    const tampered = [iv, authTag, Buffer.from('tampered-ciphertext').toString('base64')].join('.')

    expect(() => decrypt(tampered, key)).toThrow()
  })

  it('throws when encrypting with a key that is not 32 bytes', () => {
    expect(() => encrypt('secret', randomBytes(16))).toThrow(/32 bytes/)
    expect(() => encrypt('secret', randomBytes(64))).toThrow(/32 bytes/)
  })

  it('throws when decrypting with a key that is not 32 bytes', () => {
    const encrypted = encrypt('secret', randomBytes(32))

    expect(() => decrypt(encrypted, randomBytes(16))).toThrow(/32 bytes/)
  })
})
