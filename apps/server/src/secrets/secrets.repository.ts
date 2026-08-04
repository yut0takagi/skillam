import type Database from 'better-sqlite3'
import type { CreateSecretInput, Secret, UpdateSecretInput } from './secrets.types.js'

interface SecretRow {
  id: number
  ref_name: string
  encrypted_value: string
  created_at: string
  updated_at: string
}

function toSecret(row: SecretRow): Secret {
  return {
    id: row.id,
    refName: row.ref_name,
    encryptedValue: row.encrypted_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class SecretsRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateSecretInput): Secret {
    const row = this.db
      .prepare(
        'INSERT INTO secrets (ref_name, encrypted_value) VALUES (@refName, @encryptedValue) RETURNING *'
      )
      .get(input) as SecretRow
    return toSecret(row)
  }

  list(): Secret[] {
    const rows = this.db.prepare('SELECT * FROM secrets ORDER BY ref_name').all() as SecretRow[]
    return rows.map(toSecret)
  }

  getById(id: number): Secret | undefined {
    const row = this.db.prepare('SELECT * FROM secrets WHERE id = ?').get(id) as
      | SecretRow
      | undefined
    return row ? toSecret(row) : undefined
  }

  getByRefName(refName: string): Secret | undefined {
    const row = this.db.prepare('SELECT * FROM secrets WHERE ref_name = ?').get(refName) as
      | SecretRow
      | undefined
    return row ? toSecret(row) : undefined
  }

  update(id: number, input: UpdateSecretInput): Secret | undefined {
    const existing = this.getById(id)
    if (!existing) {
      return undefined
    }
    const row = this.db
      .prepare(
        `UPDATE secrets
         SET encrypted_value = @encryptedValue, updated_at = datetime('now')
         WHERE id = @id
         RETURNING *`
      )
      .get({ id, encryptedValue: input.encryptedValue }) as SecretRow
    return toSecret(row)
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM secrets WHERE id = ?').run(id)
    return result.changes > 0
  }
}
