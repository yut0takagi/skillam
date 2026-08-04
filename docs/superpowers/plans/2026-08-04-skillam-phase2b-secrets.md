# skillam Phase 2b: Secrets Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build local secret storage — a master encryption key persisted in the macOS Keychain, AES-256-GCM encryption of arbitrary secret values (API keys, tokens) at rest in SQLite, and a full CRUD + reveal HTTP API — exercised end-to-end with curl against the running server.

**Architecture:** Extends `apps/server` with a new `apps/server/src/secrets/` module. A `KeychainClient` interface abstracts Keychain access behind two implementations: `MacKeychainClient` (wraps the `security` CLI via `child_process.execFileSync`, used in production) and `InMemoryKeychainClient` (a test double, used by all automated tests so the real system Keychain is never touched during `npm test`). A `MasterKeyProvider` lazily generates (once) or retrieves a 256-bit key through whichever `KeychainClient` it's given. A pure `secrets-cipher.ts` module does AES-256-GCM encrypt/decrypt. `SecretsRepository` stores only encrypted values; plaintext only ever exists in memory, transiently, during an encrypt or a reveal operation.

**Tech Stack:** Same as Phase 1/2a — Node.js 24, TypeScript (NodeNext ESM), Fastify 5, better-sqlite3, Vitest, Node's built-in `node:crypto` and `node:child_process`.

**Depends on:** Phase 1 + Phase 2a (branches from `main`, which now contains both). **Out of scope for this phase:** wiring secrets into `role_mcp_servers.env_json` via `secret_ref:xxx` resolution (that's Phase 2c/3's concern, once catalog scanning and apply exist to consume it), the Settings UI's "regenerate master key" flow (Phase 4), catalog scanning (Phase 2c), apply/diff (Phase 3).

**Important constraint on this plan:** `MacKeychainClient` deliberately has NO automated unit tests — it shells out to the real macOS Keychain, which cannot be safely exercised in an automated test suite (it would pollute the developer's real Keychain and isn't hermetic/repeatable in CI). Per the design doc (`docs/superpowers/specs/2026-08-04-skillam-design.md` §13: "暗号化/復号のユニットテスト（キーチェーンはモック）"), all automated tests use `InMemoryKeychainClient`. `MacKeychainClient` is verified only in Task 8's manual end-to-end step, using a throwaway Keychain service/account name (NOT the real production `skillam`/`master-key` identity), which is cleaned up afterward via `security delete-generic-password`. Do not have any task write to or delete the real production Keychain entry without explicit user confirmation first.

---

## File Structure

```
apps/server/src/
├── app.ts                                # Modify: register secretsRoutes, extend error handler for KeychainAccessError
├── db/migrations/
│   └── 0003_secrets.sql                  # Create: secrets table
└── secrets/
    ├── keychain-client.ts                # KeychainClient interface + KeychainAccessError
    ├── mac-keychain-client.ts            # Real implementation (security CLI), no automated tests
    ├── in-memory-keychain-client.ts
    ├── in-memory-keychain-client.test.ts
    ├── master-key-provider.ts
    ├── master-key-provider.test.ts
    ├── secrets-cipher.ts
    ├── secrets-cipher.test.ts
    ├── secrets.types.ts
    ├── secrets.repository.ts
    ├── secrets.repository.test.ts
    ├── secrets.routes.ts
    └── secrets.routes.test.ts
```

---

### Task 1: Migration — `secrets` table

**Files:**
- Create: `apps/server/src/db/migrations/0003_secrets.sql`
- Test: `apps/server/src/db/migrate.test.ts` (modify — extend the table-list assertion, following the same pattern used when `0002_projects.sql` was added: read the current test file first, and if the idempotency test's hardcoded `_migrations` row-count assertion needs bumping from 2 to 3, fix it as part of this task, the same way that was necessary and correct when `0002` was added)

- [ ] **Step 1: Write the failing test**

Read the current `apps/server/src/db/migrate.test.ts`. Update the table-list assertion to also expect `secrets`:

```ts
  it('creates the roles, role_*, project, and secrets tables', () => {
    const db = openDb(':memory:')

    runMigrations(db)

    const names = tableNames(db)
    expect(names).toEqual(
      expect.arrayContaining([
        'roles',
        'role_skills',
        'role_mcp_servers',
        'role_agents',
        'role_permissions',
        'auto_detect_roots',
        'projects',
        'secrets'
      ])
    )
    db.close()
  })
```

If the idempotency test currently asserts `expect(count).toBe(2)`, update it to `expect(count).toBe(3)` (one row per migration file) — this is expected and correct, matching what was necessary when `0002_projects.sql` was added in Phase 2a.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/db/migrate.test.ts`
Expected: FAIL — `secrets` table doesn't exist yet, and/or the row count is wrong

- [ ] **Step 3: Write the migration**

```sql
-- apps/server/src/db/migrations/0003_secrets.sql
CREATE TABLE secrets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_name TEXT NOT NULL UNIQUE,
  encrypted_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/db/migrate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm run test -w @skillam/server`
Expected: PASS (all 117 existing tests plus this file's assertions)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db/migrations/0003_secrets.sql apps/server/src/db/migrate.test.ts
git commit -m "feat(server): add secrets table"
```

---

### Task 2: KeychainClient interface + implementations

**Files:**
- Create: `apps/server/src/secrets/keychain-client.ts`
- Create: `apps/server/src/secrets/in-memory-keychain-client.ts`
- Test: `apps/server/src/secrets/in-memory-keychain-client.test.ts`
- Create: `apps/server/src/secrets/mac-keychain-client.ts` (no automated test — see plan header)

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/secrets/in-memory-keychain-client.test.ts
import { describe, expect, it } from 'vitest'
import { InMemoryKeychainClient } from './in-memory-keychain-client.js'

describe('InMemoryKeychainClient', () => {
  it('returns undefined for a password that was never set', () => {
    const client = new InMemoryKeychainClient()

    expect(client.getPassword('skillam', 'master-key')).toBeUndefined()
  })

  it('stores and retrieves a password', () => {
    const client = new InMemoryKeychainClient()

    client.setPassword('skillam', 'master-key', 'super-secret-value')

    expect(client.getPassword('skillam', 'master-key')).toBe('super-secret-value')
  })

  it('scopes passwords by both service and account', () => {
    const client = new InMemoryKeychainClient()

    client.setPassword('skillam', 'account-a', 'value-a')
    client.setPassword('skillam', 'account-b', 'value-b')
    client.setPassword('other-service', 'account-a', 'value-c')

    expect(client.getPassword('skillam', 'account-a')).toBe('value-a')
    expect(client.getPassword('skillam', 'account-b')).toBe('value-b')
    expect(client.getPassword('other-service', 'account-a')).toBe('value-c')
  })

  it('overwrites an existing password for the same service and account', () => {
    const client = new InMemoryKeychainClient()

    client.setPassword('skillam', 'master-key', 'first')
    client.setPassword('skillam', 'master-key', 'second')

    expect(client.getPassword('skillam', 'master-key')).toBe('second')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/secrets/in-memory-keychain-client.test.ts`
Expected: FAIL — `Cannot find module './in-memory-keychain-client.js'`

- [ ] **Step 3: Write the interface and implementations**

```ts
// apps/server/src/secrets/keychain-client.ts
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
```

```ts
// apps/server/src/secrets/in-memory-keychain-client.ts
import type { KeychainClient } from './keychain-client.js'

function key(service: string, account: string): string {
  return `${service} ${account}`
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
```

```ts
// apps/server/src/secrets/mac-keychain-client.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/secrets/in-memory-keychain-client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm run test -w @skillam/server`
Expected: PASS (no regressions). `mac-keychain-client.ts` has no test file — confirm `tsc` still compiles it cleanly via `npx tsc -p apps/server/tsconfig.json --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/secrets/keychain-client.ts apps/server/src/secrets/in-memory-keychain-client.ts apps/server/src/secrets/in-memory-keychain-client.test.ts apps/server/src/secrets/mac-keychain-client.ts
git commit -m "feat(server): add KeychainClient interface with in-memory and macOS implementations"
```

---

### Task 3: MasterKeyProvider

**Files:**
- Create: `apps/server/src/secrets/master-key-provider.ts`
- Test: `apps/server/src/secrets/master-key-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/secrets/master-key-provider.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/secrets/master-key-provider.test.ts`
Expected: FAIL — `Cannot find module './master-key-provider.js'`

- [ ] **Step 3: Write the provider**

```ts
// apps/server/src/secrets/master-key-provider.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/secrets/master-key-provider.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/secrets/master-key-provider.ts apps/server/src/secrets/master-key-provider.test.ts
git commit -m "feat(server): add master key provider"
```

---

### Task 4: SecretsCipher (AES-256-GCM encrypt/decrypt)

**Files:**
- Create: `apps/server/src/secrets/secrets-cipher.ts`
- Test: `apps/server/src/secrets/secrets-cipher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/secrets/secrets-cipher.test.ts
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/secrets/secrets-cipher.test.ts`
Expected: FAIL — `Cannot find module './secrets-cipher.js'`

- [ ] **Step 3: Write the cipher**

```ts
// apps/server/src/secrets/secrets-cipher.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH_BYTES = 12

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

export function decrypt(encrypted: string, key: Buffer): string {
  const [ivBase64, authTagBase64, ciphertextBase64] = encrypted.split('.')
  if (!ivBase64 || !authTagBase64 || !ciphertextBase64) {
    throw new Error('malformed encrypted value')
  }
  const iv = Buffer.from(ivBase64, 'base64')
  const authTag = Buffer.from(authTagBase64, 'base64')
  const ciphertext = Buffer.from(ciphertextBase64, 'base64')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/secrets/secrets-cipher.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/secrets/secrets-cipher.ts apps/server/src/secrets/secrets-cipher.test.ts
git commit -m "feat(server): add AES-256-GCM secrets cipher"
```

---

### Task 5: SecretsRepository

**Files:**
- Create: `apps/server/src/secrets/secrets.types.ts`
- Create: `apps/server/src/secrets/secrets.repository.ts`
- Test: `apps/server/src/secrets/secrets.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/secrets/secrets.repository.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { SecretsRepository } from './secrets.repository.js'

describe('SecretsRepository', () => {
  let db: Database.Database
  let repo: SecretsRepository

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new SecretsRepository(db)
  })

  it('creates and retrieves a secret by id', () => {
    const created = repo.create({ refName: 'github-token', encryptedValue: 'enc:abc' })

    expect(created.refName).toBe('github-token')
    expect(created.encryptedValue).toBe('enc:abc')

    expect(repo.getById(created.id)).toEqual(created)
  })

  it('retrieves a secret by ref name', () => {
    const created = repo.create({ refName: 'github-token', encryptedValue: 'enc:abc' })

    expect(repo.getByRefName('github-token')).toEqual(created)
  })

  it('returns undefined for a missing ref name', () => {
    expect(repo.getByRefName('does-not-exist')).toBeUndefined()
  })

  it('lists secrets ordered by ref name, without requiring the caller to touch encrypted values', () => {
    repo.create({ refName: 'zeta', encryptedValue: 'enc:z' })
    repo.create({ refName: 'alpha', encryptedValue: 'enc:a' })

    expect(repo.list().map((s) => s.refName)).toEqual(['alpha', 'zeta'])
  })

  it('rejects creating a second secret with the same ref name', () => {
    repo.create({ refName: 'github-token', encryptedValue: 'enc:abc' })

    expect(() => repo.create({ refName: 'github-token', encryptedValue: 'enc:xyz' })).toThrow()
  })

  it('updates the encrypted value for an existing secret', () => {
    const created = repo.create({ refName: 'github-token', encryptedValue: 'enc:abc' })

    const updated = repo.update(created.id, { encryptedValue: 'enc:rotated' })

    expect(updated?.encryptedValue).toBe('enc:rotated')
    expect(updated?.refName).toBe('github-token')
  })

  it('returns undefined when updating a missing secret', () => {
    expect(repo.update(999, { encryptedValue: 'x' })).toBeUndefined()
  })

  it('deletes a secret', () => {
    const created = repo.create({ refName: 'github-token', encryptedValue: 'enc:abc' })

    expect(repo.delete(created.id)).toBe(true)
    expect(repo.getById(created.id)).toBeUndefined()
  })

  it('returns false when deleting a missing secret', () => {
    expect(repo.delete(999)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @skillam/server -- src/secrets/secrets.repository.test.ts`
Expected: FAIL — `Cannot find module './secrets.repository.js'`

- [ ] **Step 3: Write the types and repository**

```ts
// apps/server/src/secrets/secrets.types.ts
export interface Secret {
  id: number
  refName: string
  encryptedValue: string
  createdAt: string
  updatedAt: string
}

export interface CreateSecretInput {
  refName: string
  encryptedValue: string
}

export interface UpdateSecretInput {
  encryptedValue: string
}
```

```ts
// apps/server/src/secrets/secrets.repository.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @skillam/server -- src/secrets/secrets.repository.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/secrets/secrets.types.ts apps/server/src/secrets/secrets.repository.ts apps/server/src/secrets/secrets.repository.test.ts
git commit -m "feat(server): add secrets repository"
```

---

### Task 6: Secrets HTTP routes — create/list/get/delete

**Files:**
- Create: `apps/server/src/secrets/secrets.routes.ts` (create/list/get/delete in this task; update/reveal in Task 7)
- Test: `apps/server/src/secrets/secrets.routes.test.ts`
- Modify: `apps/server/src/app.ts` (register `secretsRoutes`)

**Before editing `app.ts`**, read its actual current content (it should be the Phase 2a end-state: `buildApp(db)`, the `SQLITE_CONSTRAINT*`/statusCode-aware global error handler, `/health`, `rolesRoutes`, `projectsRoutes`) and adapt rather than assume.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/secrets/secrets.routes.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { buildApp } from '../app.js'

describe('secrets routes', () => {
  let db: Database.Database
  let app: FastifyInstance

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db)
  })

  it('creates a secret via POST /secrets and does not echo the plaintext value back', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'github-token', value: 'ghp_realvalue' }
    })

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body).toMatchObject({ refName: 'github-token' })
    expect(body).not.toHaveProperty('value')
    expect(JSON.stringify(body)).not.toContain('ghp_realvalue')
  })

  it('rejects POST /secrets without a refName', async () => {
    const response = await app.inject({ method: 'POST', url: '/secrets', payload: { value: 'x' } })

    expect(response.statusCode).toBe(400)
  })

  it('rejects POST /secrets without a value', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'x' }
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a duplicate refName', async () => {
    await app.inject({ method: 'POST', url: '/secrets', payload: { refName: 'dup', value: 'a' } })

    const response = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'dup', value: 'b' }
    })

    expect(response.statusCode).toBe(400)
  })

  it('lists secrets via GET /secrets without leaking encrypted or plaintext values', async () => {
    await app.inject({ method: 'POST', url: '/secrets', payload: { refName: 'a', value: 'x' } })
    await app.inject({ method: 'POST', url: '/secrets', payload: { refName: 'b', value: 'y' } })

    const response = await app.inject({ method: 'GET', url: '/secrets' })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body).toHaveLength(2)
    for (const secret of body) {
      expect(secret).not.toHaveProperty('value')
      expect(secret).not.toHaveProperty('encryptedValue')
    }
  })

  it('gets a single secret via GET /secrets/:id without its value', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'a', value: 'x' }
    })
    const { id } = created.json()

    const response = await app.inject({ method: 'GET', url: `/secrets/${id}` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id, refName: 'a' })
    expect(response.json()).not.toHaveProperty('value')
  })

  it('returns 404 for GET /secrets/:id when missing', async () => {
    const response = await app.inject({ method: 'GET', url: '/secrets/999' })

    expect(response.statusCode).toBe(404)
  })

  it('deletes a secret via DELETE /secrets/:id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'a', value: 'x' }
    })
    const { id } = created.json()

    const response = await app.inject({ method: 'DELETE', url: `/secrets/${id}` })

    expect(response.statusCode).toBe(204)
    const getResponse = await app.inject({ method: 'GET', url: `/secrets/${id}` })
    expect(getResponse.statusCode).toBe(404)
  })

  it('returns 404 for DELETE /secrets/:id when missing', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/secrets/999' })

    expect(response.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @skillam/server -- src/secrets/secrets.routes.test.ts`
Expected: FAIL — `Cannot find module './secrets.routes.js'`

- [ ] **Step 3: Write the routes plugin**

```ts
// apps/server/src/secrets/secrets.routes.ts
import type { FastifyPluginAsync } from 'fastify'
import { encrypt } from './secrets-cipher.js'
import type { MasterKeyProvider } from './master-key-provider.js'
import { SecretsRepository } from './secrets.repository.js'
import type { Secret } from './secrets.types.js'

export interface SecretsRouteDeps {
  secrets: SecretsRepository
  masterKeyProvider: MasterKeyProvider
}

function hasBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null
}

function toPublicSecret(secret: Secret) {
  return {
    id: secret.id,
    refName: secret.refName,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt
  }
}

export const secretsRoutes: FastifyPluginAsync<SecretsRouteDeps> = async (app, deps) => {
  app.post<{ Body: { refName: string; value: string } }>('/secrets', async (request, reply) => {
    if (!hasBody(request.body)) {
      return reply.status(400).send({ error: 'request body is required' })
    }
    const { refName, value } = request.body
    if (typeof refName !== 'string' || refName.trim() === '') {
      return reply.status(400).send({ error: 'refName is required' })
    }
    if (typeof value !== 'string' || value === '') {
      return reply.status(400).send({ error: 'value is required' })
    }
    const key = deps.masterKeyProvider.getOrCreateKey()
    const encryptedValue = encrypt(value, key)
    const secret = deps.secrets.create({ refName, encryptedValue })
    return reply.status(201).send(toPublicSecret(secret))
  })

  app.get('/secrets', async () => {
    return deps.secrets.list().map(toPublicSecret)
  })

  app.get<{ Params: { id: string } }>('/secrets/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const secret = deps.secrets.getById(id)
    if (!secret) {
      return reply.status(404).send({ error: 'secret not found' })
    }
    return toPublicSecret(secret)
  })

  app.delete<{ Params: { id: string } }>('/secrets/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.secrets.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'secret not found' })
    }
    return reply.status(204).send()
  })
}
```

- [ ] **Step 4: Wire into `app.ts`**

Add the imports and registration for `secretsRoutes`, using `MacKeychainClient` in production. Read the current `app.ts`, then add (adapting exact placement to what's actually there):

```ts
import { MacKeychainClient } from './secrets/mac-keychain-client.js'
import { MasterKeyProvider } from './secrets/master-key-provider.js'
import { SecretsRepository } from './secrets/secrets.repository.js'
import { secretsRoutes } from './secrets/secrets.routes.js'
```

```ts
  app.register(secretsRoutes, {
    secrets: new SecretsRepository(db),
    masterKeyProvider: new MasterKeyProvider(new MacKeychainClient())
  })
```

(placed after the existing `app.register(projectsRoutes, {...})` call, inside `buildApp`, before `return app`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests, including the 9 new ones). Note: since `buildApp(db)` now always constructs a real `MacKeychainClient` internally, and the tests never actually call `POST /secrets`... wait — they DO call `POST /secrets`, which means `MasterKeyProvider(new MacKeychainClient())`'s `getOrCreateKey()` WILL be invoked during these tests and WILL touch the real system Keychain. This is a problem — see Task 6.5 immediately below, which must be done as part of completing this task, not skipped.

- [ ] **Step 5.5: Fix the test-touches-real-Keychain problem before committing**

The wiring above is wrong for testability: `buildApp(db)` is used directly by `secrets.routes.test.ts` (and will be used by `app.test.ts`, `roles.routes.test.ts`, `projects.routes.test.ts` too, once this route is registered unconditionally), and if it always constructs `MacKeychainClient`, then EVERY test that builds an app and hits `POST /secrets` will write to the real developer's Keychain. This must not happen.

Fix: change `buildApp`'s signature to accept an optional `keychainClient` parameter, defaulting to `MacKeychainClient` for production use (`index.ts` won't need to change), but allowing tests to inject `InMemoryKeychainClient`:

```ts
// apps/server/src/app.ts — buildApp signature becomes:
import type { KeychainClient } from './secrets/keychain-client.js'

export function buildApp(db: Database.Database, keychainClient: KeychainClient = new MacKeychainClient()): FastifyInstance {
  // ...
  app.register(secretsRoutes, {
    secrets: new SecretsRepository(db),
    masterKeyProvider: new MasterKeyProvider(keychainClient)
  })
  // ...
}
```

Then update `secrets.routes.test.ts`'s `beforeEach` to pass an `InMemoryKeychainClient`:

```ts
// secrets.routes.test.ts — add this import
import { InMemoryKeychainClient } from './in-memory-keychain-client.js'

// and change the beforeEach to:
  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    app = buildApp(db, new InMemoryKeychainClient())
  })
```

Leave every OTHER test file that calls `buildApp(db)` (in `app.test.ts`, `roles.routes.test.ts`, `projects.routes.test.ts`) UNCHANGED — they'll fall back to the default `new MacKeychainClient()` parameter, but since none of those tests ever call any `/secrets` route, `MasterKeyProvider.getOrCreateKey()` is never invoked in them, so the real Keychain is never touched by those files either. Confirm this by re-running the full suite and checking no Keychain-related errors or prompts occur.

Re-run: `npm run test -w @skillam/server` — expected PASS, all tests, and confirm (by watching the terminal / lack of any macOS permission dialog) that no real Keychain access happened during the run.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/secrets/secrets.routes.ts apps/server/src/secrets/secrets.routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add secrets create/list/get/delete http routes"
```

---

### Task 7: Secrets HTTP routes — update + reveal

**Files:**
- Modify: `apps/server/src/secrets/secrets.routes.ts` (add `PUT /secrets/:id`, `POST /secrets/:id/reveal`)
- Modify: `apps/server/src/secrets/secrets.routes.test.ts` (append tests)

- [ ] **Step 1: Append the failing tests**

Add these `it()` blocks inside the existing `describe('secrets routes', ...)` block:

```ts
  it('updates a secret value via PUT /secrets/:id and the new value round-trips through reveal', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'rotates', value: 'original-value' }
    })
    const { id } = created.json()

    const updateResponse = await app.inject({
      method: 'PUT',
      url: `/secrets/${id}`,
      payload: { value: 'rotated-value' }
    })
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json()).not.toHaveProperty('value')

    const revealResponse = await app.inject({ method: 'POST', url: `/secrets/${id}/reveal` })
    expect(revealResponse.json()).toEqual({ value: 'rotated-value' })
  })

  it('returns 404 for PUT /secrets/:id when missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/secrets/999',
      payload: { value: 'x' }
    })

    expect(response.statusCode).toBe(404)
  })

  it('rejects PUT /secrets/:id without a value', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'a', value: 'x' }
    })
    const { id } = created.json()

    const response = await app.inject({ method: 'PUT', url: `/secrets/${id}`, payload: {} })

    expect(response.statusCode).toBe(400)
  })

  it('reveals the decrypted value via POST /secrets/:id/reveal', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { refName: 'reveal-me', value: 'the-real-secret' }
    })
    const { id } = created.json()

    const response = await app.inject({ method: 'POST', url: `/secrets/${id}/reveal` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ value: 'the-real-secret' })
  })

  it('returns 404 for POST /secrets/:id/reveal when missing', async () => {
    const response = await app.inject({ method: 'POST', url: '/secrets/999/reveal' })

    expect(response.statusCode).toBe(404)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @skillam/server -- src/secrets/secrets.routes.test.ts`
Expected: FAIL — `PUT /secrets/:id` and `POST /secrets/:id/reveal` return 404 (routes not registered)

- [ ] **Step 3: Add the routes**

Add to `apps/server/src/secrets/secrets.routes.ts`, inside the plugin body (after the existing `DELETE /secrets/:id` route), and add `import { decrypt } from './secrets-cipher.js'` alongside the existing `encrypt` import:

```ts
  app.put<{ Params: { id: string }; Body: { value: string } }>(
    '/secrets/:id',
    async (request, reply) => {
      if (!hasBody(request.body)) {
        return reply.status(400).send({ error: 'request body is required' })
      }
      const { value } = request.body
      if (typeof value !== 'string' || value === '') {
        return reply.status(400).send({ error: 'value is required' })
      }
      const id = Number(request.params.id)
      const key = deps.masterKeyProvider.getOrCreateKey()
      const encryptedValue = encrypt(value, key)
      const secret = deps.secrets.update(id, { encryptedValue })
      if (!secret) {
        return reply.status(404).send({ error: 'secret not found' })
      }
      return toPublicSecret(secret)
    }
  )

  app.post<{ Params: { id: string } }>('/secrets/:id/reveal', async (request, reply) => {
    const id = Number(request.params.id)
    const secret = deps.secrets.getById(id)
    if (!secret) {
      return reply.status(404).send({ error: 'secret not found' })
    }
    const key = deps.masterKeyProvider.getOrCreateKey()
    const value = decrypt(secret.encryptedValue, key)
    return { value }
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @skillam/server -- src/secrets/secrets.routes.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full suite**

Run: `npm run test -w @skillam/server`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/secrets/secrets.routes.ts apps/server/src/secrets/secrets.routes.test.ts
git commit -m "feat(server): add secrets update and reveal http routes"
```

---

### Task 8: Keychain-access error handling + manual end-to-end verification

**Files:**
- Modify: `apps/server/src/app.ts` (extend the global error handler to recognize `KeychainAccessError`)
- Test: none new (verified manually per this task, consistent with `MacKeychainClient` having no automated tests)

- [ ] **Step 1: Extend the global error handler**

Read the current `apps/server/src/app.ts` error handler. Add a check for `KeychainAccessError` BEFORE the generic `SQLITE_CONSTRAINT`/statusCode checks (order doesn't functionally matter since the error types are mutually exclusive, but check it first since it's the newest addition), returning a clear message per the design doc's error-handling guidance (§12: "キーチェーンにアクセスできません。ターミナルのアクセス許可を確認してください"):

```ts
import { KeychainAccessError } from './secrets/keychain-client.js'
```

```ts
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof KeychainAccessError) {
      return reply
        .status(503)
        .send({ error: 'キーチェーンにアクセスできません。ターミナルのアクセス許可を確認してください。' })
    }
    const code = (error as { code?: unknown }).code
    // ... rest unchanged
  })
```

Add a unit test for this in `apps/server/src/app.test.ts` by registering a throwaway route that throws a `KeychainAccessError` and asserting the response — read the current `app.test.ts` first and add in a style consistent with it:

```ts
  it('returns 503 with a clear message when a KeychainAccessError is thrown', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db, new InMemoryKeychainClient())
    app.get('/__test-keychain-error', async () => {
      throw new KeychainAccessError('simulated failure')
    })

    const response = await app.inject({ method: 'GET', url: '/__test-keychain-error' })

    expect(response.statusCode).toBe(503)
    expect(response.json().error).toContain('キーチェーン')
  })
```

(Import `KeychainAccessError` from `./secrets/keychain-client.js` and `InMemoryKeychainClient` from `./secrets/in-memory-keychain-client.js` at the top of `app.test.ts`.)

Run: `npm run test -w @skillam/server` — expected PASS, all tests.

- [ ] **Step 2: Commit the error handler change**

```bash
git add apps/server/src/app.ts apps/server/src/app.test.ts
git commit -m "feat(server): return a clear error for Keychain access failures"
```

- [ ] **Step 3: Manual verification — READ THIS BEFORE RUNNING**

This step exercises the REAL macOS Keychain via `MacKeychainClient`, which nothing in the automated suite touches. **Do not run this step against the production `skillam`/`master-key` Keychain identity without first confirming with the user** — `MasterKeyProvider`'s service/account names are hardcoded (`skillam`/`master-key`), so exercising the real server via its normal entrypoint (`npm run dev`, `SKILLAM_DB_PATH` override or not) WILL create or read that real, persistent Keychain item, which is meant to be the tool's actual one-time master key setup — not a disposable test artifact to clean up afterward.

If the user confirms it's fine to proceed with the real identity (likely, since this is the tool's intended real first-run behavior and the user has previously indicated wanting to actually use skillam): start the server against a scratch `SKILLAM_DB_PATH` (to keep the DB-side test data separate from real data, per the established pattern from Phase 1/2a), and exercise the secrets API for real:

```bash
SKILLAM_DB_PATH=/tmp/skillam-phase2b-verify/skillam.db npm run dev -w @skillam/server &> /tmp/skillam-phase2b-verify.log &
```

Wait for readiness, then:

```bash
curl -s -X POST http://127.0.0.1:4317/secrets \
  -H 'content-type: application/json' \
  -d '{"refName":"test-key","value":"sk-example-1234567890"}'
# Expected: 201, {"id":1,"refName":"test-key","createdAt":"...","updatedAt":"..."} — NO "value" field

curl -s http://127.0.0.1:4317/secrets
# Expected: array with the one secret, no value field

curl -s -X POST http://127.0.0.1:4317/secrets/1/reveal
# Expected: {"value":"sk-example-1234567890"} — the real plaintext, decrypted via the real Keychain-backed master key

curl -s -X PUT http://127.0.0.1:4317/secrets/1 -H 'content-type: application/json' -d '{"value":"rotated-value"}'
curl -s -X POST http://127.0.0.1:4317/secrets/1/reveal
# Expected: {"value":"rotated-value"}

curl -s -X DELETE http://127.0.0.1:4317/secrets/1 -o /dev/null -w '%{http_code}\n'
# Expected: 204
```

Confirm via Keychain Access.app or `security find-generic-password -s skillam -a master-key -w` (run separately, outside this HTTP flow) that a real Keychain item now exists.

If the user does NOT want the real identity touched yet, use a modified build with a different hardcoded service/account for this one verification run (e.g., temporarily edit `master-key-provider.ts`'s `SERVICE`/`ACCOUNT` constants to `skillam-verify`/`master-key-verify`, run the verification, then revert the edit before committing anything — do not commit a modified service/account name), and clean up afterward with `security delete-generic-password -s skillam-verify -a master-key-verify`.

- [ ] **Step 4: Stop the server and clean up scratch DB files**

```bash
lsof -ti:4317 -sTCP:LISTEN | xargs -r kill
rm -rf /tmp/skillam-phase2b-verify /tmp/skillam-phase2b-verify.log
```

- [ ] **Step 5: Run the full test suite one final time**

Run: `npm run test -w @skillam/server`
Expected: PASS (all tests)

- [ ] **Step 6: No commit for this task beyond Step 2** (steps 3-5 are verification only)

---

## Phase 2b Definition of Done

- `secrets` table exists and is migrated alongside Phase 1/2a's schema.
- A master encryption key is generated once and persisted in the macOS Keychain (via `MacKeychainClient`), retrievable across process restarts.
- Full CRUD + reveal for secrets works via HTTP: values are encrypted at rest (AES-256-GCM), never returned in list/get/create/update responses, only via the explicit `/reveal` endpoint.
- All automated tests use `InMemoryKeychainClient` and never touch the real system Keychain; `npm test` passes with zero real-Keychain side effects.
- Keychain access failures surface as a clear 503 error, not a raw exception.
- Manual verification confirms the real `MacKeychainClient` path works end-to-end against the actual macOS Keychain.

## Next Sub-Phases (not detailed here)

- **Phase 2c:** Catalog scanning (Skills/MCP servers/Agents discovery from `~/.claude/*`, plugin caches, and registered projects' `.claude/`/`.mcp.json`), including extracting MCP server secrets into the `secrets` table this phase built.
- **Phase 3:** Apply/diff engine, export/import.
- **Phase 4:** `apps/web` React SPA.
