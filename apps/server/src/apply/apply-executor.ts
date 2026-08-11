import fs from 'node:fs'
import path from 'node:path'
import type { SecretsRepository } from '../secrets/secrets.repository.js'
import type { MasterKeyProvider } from '../secrets/master-key-provider.js'
import { decrypt } from '../secrets/secrets-cipher.js'
import type { ApplyPlan } from './apply-planner.js'

const SECRET_REF_PREFIX = 'secret_ref:'

export class ApplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApplyError'
  }
}

export interface ApplyExecutorDeps {
  secrets: SecretsRepository
  masterKeyProvider: MasterKeyProvider
}

export function resolveSecretRefs(
  mcpJson: Record<string, unknown>,
  deps: ApplyExecutorDeps
): Record<string, unknown> {
  const servers = mcpJson.mcpServers
  if (typeof servers !== 'object' || servers === null) {
    return mcpJson
  }

  let key: Buffer | undefined
  const resolvedServers: Record<string, unknown> = {}

  for (const [name, definition] of Object.entries(servers as Record<string, unknown>)) {
    if (typeof definition !== 'object' || definition === null) {
      resolvedServers[name] = definition
      continue
    }
    const entry = { ...(definition as Record<string, unknown>) }
    const env = entry.env
    if (typeof env === 'object' && env !== null) {
      const resolvedEnv: Record<string, string> = {}
      for (const [envKey, value] of Object.entries(env as Record<string, unknown>)) {
        if (typeof value !== 'string' || !value.startsWith(SECRET_REF_PREFIX)) {
          resolvedEnv[envKey] = String(value)
          continue
        }
        const refName = value.slice(SECRET_REF_PREFIX.length)
        const secret = deps.secrets.getByRefName(refName)
        if (!secret) {
          throw new ApplyError(`シークレット参照が解決できません: ${refName}`)
        }
        key = key ?? deps.masterKeyProvider.getOrCreateKey()
        resolvedEnv[envKey] = decrypt(secret.encryptedValue, key)
      }
      entry.env = resolvedEnv
    }
    resolvedServers[name] = entry
  }

  return { ...mcpJson, mcpServers: resolvedServers }
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

export function executeApplyPlan(plan: ApplyPlan, deps: ApplyExecutorDeps): void {
  const resolvedMcp = resolveSecretRefs(plan.mcpAfterObject, deps)

  writeFile(plan.settingsFile.path, plan.settingsFile.after)
  writeFile(plan.mcpFile.path, `${JSON.stringify(resolvedMcp, null, 2)}\n`)

  for (const operation of plan.operations) {
    if (operation.type === 'remove') {
      fs.rmSync(operation.path, { force: true, recursive: true })
      continue
    }
    if (operation.type === 'write-file') {
      writeFile(operation.path, operation.content)
      continue
    }
    fs.mkdirSync(path.dirname(operation.path), { recursive: true })
    fs.rmSync(operation.path, { force: true, recursive: true })
    fs.symlinkSync(operation.target, operation.path)
  }
}
