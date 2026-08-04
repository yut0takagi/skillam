import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH_BYTES = 12
const KEY_LENGTH_BYTES = 32

function assertValidKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`encryption key must be ${KEY_LENGTH_BYTES} bytes, got ${key.length}`)
  }
}

export function encrypt(plaintext: string, key: Buffer): string {
  assertValidKey(key)
  const iv = randomBytes(IV_LENGTH_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

export function decrypt(encrypted: string, key: Buffer): string {
  assertValidKey(key)
  const parts = encrypted.split('.')
  if (parts.length !== 3) {
    throw new Error('malformed encrypted value')
  }
  const [ivBase64, authTagBase64, ciphertextBase64] = parts
  if (!ivBase64 || !authTagBase64) {
    throw new Error('malformed encrypted value')
  }
  const iv = Buffer.from(ivBase64, 'base64')
  const authTag = Buffer.from(authTagBase64, 'base64')
  const ciphertext = Buffer.from(ciphertextBase64, 'base64')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
}
