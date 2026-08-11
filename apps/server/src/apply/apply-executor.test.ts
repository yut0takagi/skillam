import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { SecretsRepository } from '../secrets/secrets.repository.js'
import { MasterKeyProvider } from '../secrets/master-key-provider.js'
import { InMemoryKeychainClient } from '../secrets/in-memory-keychain-client.js'
import { encrypt } from '../secrets/secrets-cipher.js'
import { EMPTY_MANAGED_STATE } from './managed-state.js'
import { ApplyError, executeApplyPlan } from './apply-executor.js'
import type { ApplyPlan } from './apply-planner.js'
import type { ApplyExecutorDeps } from './apply-executor.js'

describe('executeApplyPlan', () => {
  let db: Database.Database
  let deps: ApplyExecutorDeps
  let scratchRoot: string
  let projectPath: string

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-executor-test-')))
    projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })
    deps = {
      secrets: new SecretsRepository(db),
      masterKeyProvider: new MasterKeyProvider(new InMemoryKeychainClient())
    }
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  function planWith(overrides: Partial<ApplyPlan>): ApplyPlan {
    return {
      projectId: 1,
      projectPath,
      roleId: 1,
      settingsFile: {
        path: path.join(projectPath, '.claude', 'settings.json'),
        before: null,
        after: '{}\n'
      },
      mcpFile: { path: path.join(projectPath, '.mcp.json'), before: null, after: '{}\n' },
      mcpAfterObject: {},
      operations: [],
      managed: EMPTY_MANAGED_STATE,
      ...overrides
    }
  }

  it('creates .claude and writes settings.json', () => {
    executeApplyPlan(planWith({}), deps)

    expect(fs.readFileSync(path.join(projectPath, '.claude', 'settings.json'), 'utf-8')).toBe('{}\n')
  })

  it('injects the decrypted secret value into the written .mcp.json', () => {
    const key = deps.masterKeyProvider.getOrCreateKey()
    deps.secrets.create({
      refName: 'mcp:github:TOKEN',
      encryptedValue: encrypt('ghp_real_value', key)
    })

    executeApplyPlan(
      planWith({
        mcpAfterObject: {
          mcpServers: { github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } } }
        }
      }),
      deps
    )

    const written = JSON.parse(fs.readFileSync(path.join(projectPath, '.mcp.json'), 'utf-8'))
    expect(written.mcpServers.github.env.TOKEN).toBe('ghp_real_value')
  })

  it('throws ApplyError naming the missing secret reference', () => {
    expect(() =>
      executeApplyPlan(
        planWith({
          mcpAfterObject: {
            mcpServers: { github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:MISSING' } } }
          }
        }),
        deps
      )
    ).toThrow(/mcp:github:MISSING/)
  })

  it('writes nothing at all when a secret reference cannot be resolved', () => {
    expect(() =>
      executeApplyPlan(
        planWith({
          mcpAfterObject: {
            mcpServers: { github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:MISSING' } } }
          },
          operations: [
            { type: 'write-file', path: path.join(projectPath, '.claude', 'agents', 'w.md'), content: '# w' }
          ]
        }),
        deps
      )
    ).toThrow(ApplyError)

    expect(fs.existsSync(path.join(projectPath, '.claude', 'settings.json'))).toBe(false)
    expect(fs.existsSync(path.join(projectPath, '.mcp.json'))).toBe(false)
    expect(fs.existsSync(path.join(projectPath, '.claude', 'agents', 'w.md'))).toBe(false)
  })

  it('does not touch the keychain when no secret reference is present', () => {
    const keychain = new InMemoryKeychainClient()
    executeApplyPlan(planWith({ mcpAfterObject: { mcpServers: {} } }), {
      secrets: new SecretsRepository(db),
      masterKeyProvider: new MasterKeyProvider(keychain)
    })

    expect(keychain.getPassword('skillam', 'master-key')).toBeUndefined()
  })

  it('leaves the preview string untouched so it never gains a plaintext secret', () => {
    const key = deps.masterKeyProvider.getOrCreateKey()
    deps.secrets.create({ refName: 'mcp:github:TOKEN', encryptedValue: encrypt('ghp_real_value', key) })
    const plan = planWith({
      mcpAfterObject: {
        mcpServers: { github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } } }
      },
      mcpFile: {
        path: path.join(projectPath, '.mcp.json'),
        before: null,
        after: '{\n  "mcpServers": {\n    "github": {\n      "env": { "TOKEN": "secret_ref:mcp:github:TOKEN" }\n    }\n  }\n}\n'
      }
    })

    executeApplyPlan(plan, deps)

    expect(plan.mcpFile.after).toContain('secret_ref:mcp:github:TOKEN')
    expect(plan.mcpFile.after).not.toContain('ghp_real_value')
    expect(JSON.stringify(plan.mcpAfterObject)).not.toContain('ghp_real_value')
  })

  it('creates a symlink pointing at the target', () => {
    const target = path.join(scratchRoot, 'skills', 'drawio')
    fs.mkdirSync(target, { recursive: true })
    const linkPath = path.join(projectPath, '.claude', 'skills', 'drawio')

    executeApplyPlan(planWith({ operations: [{ type: 'create-link', path: linkPath, target }] }), deps)

    expect(fs.readlinkSync(linkPath)).toBe(target)
  })

  it('replaces an existing symlink that points elsewhere', () => {
    const oldTarget = path.join(scratchRoot, 'old')
    const newTarget = path.join(scratchRoot, 'new')
    fs.mkdirSync(oldTarget, { recursive: true })
    fs.mkdirSync(newTarget, { recursive: true })
    const linkPath = path.join(projectPath, '.claude', 'skills', 'thing')
    fs.mkdirSync(path.dirname(linkPath), { recursive: true })
    fs.symlinkSync(oldTarget, linkPath)

    executeApplyPlan(
      planWith({ operations: [{ type: 'create-link', path: linkPath, target: newTarget }] }),
      deps
    )

    expect(fs.readlinkSync(linkPath)).toBe(newTarget)
  })

  it('writes an authored agent file', () => {
    const filePath = path.join(projectPath, '.claude', 'agents', 'writer.md')

    executeApplyPlan(
      planWith({ operations: [{ type: 'write-file', path: filePath, content: '# writer' }] }),
      deps
    )

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('# writer')
  })

  it('removes a managed symlink without touching its target', () => {
    const target = path.join(scratchRoot, 'skills', 'drawio')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'SKILL.md'), '# drawio')
    const linkPath = path.join(projectPath, '.claude', 'skills', 'drawio')
    fs.mkdirSync(path.dirname(linkPath), { recursive: true })
    fs.symlinkSync(target, linkPath)

    executeApplyPlan(planWith({ operations: [{ type: 'remove', path: linkPath }] }), deps)

    expect(fs.existsSync(linkPath)).toBe(false)
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf-8')).toBe('# drawio')
  })

  it('tolerates removing a path that is already gone', () => {
    const linkPath = path.join(projectPath, '.claude', 'skills', 'never-existed')

    expect(() =>
      executeApplyPlan(planWith({ operations: [{ type: 'remove', path: linkPath }] }), deps)
    ).not.toThrow()
  })

  // planMaterialize currently guarantees removal paths and creation paths are disjoint, so this
  // scenario can't arise from buildApplyPlan today. It asserts the executor's own ordering
  // contract in isolation, independent of what the planner happens to emit.
  it('applies removals before creations when they target the same path', () => {
    const oldTarget = path.join(scratchRoot, 'old-target')
    const newTarget = path.join(scratchRoot, 'new-target')
    fs.mkdirSync(oldTarget, { recursive: true })
    fs.mkdirSync(newTarget, { recursive: true })
    const samePath = path.join(projectPath, '.claude', 'skills', 'shared')
    fs.mkdirSync(path.dirname(samePath), { recursive: true })
    fs.symlinkSync(oldTarget, samePath)

    executeApplyPlan(
      planWith({
        operations: [
          { type: 'remove', path: samePath },
          { type: 'create-link', path: samePath, target: newTarget }
        ]
      }),
      deps
    )

    expect(fs.readlinkSync(samePath)).toBe(newTarget)
  })

  it('preserves non-string env values instead of coercing them', () => {
    executeApplyPlan(
      planWith({
        mcpAfterObject: {
          mcpServers: { svc: { command: 'node', env: { PORT: 3000, DEBUG: true, NAME: 'x' } } }
        }
      }),
      deps
    )

    const written = JSON.parse(fs.readFileSync(path.join(projectPath, '.mcp.json'), 'utf-8'))
    expect(written.mcpServers.svc.env).toEqual({ PORT: 3000, DEBUG: true, NAME: 'x' })
  })

  it('leaves settings.json mtime unchanged when applying an identical plan a second time', () => {
    executeApplyPlan(planWith({}), deps)
    const settingsPath = path.join(projectPath, '.claude', 'settings.json')
    const mtimeAfterFirst = fs.statSync(settingsPath).mtimeMs

    // A real second buildApplyPlan call would read the file it just wrote back as `before`.
    const secondPlan = planWith({
      settingsFile: { path: settingsPath, before: '{}\n', after: '{}\n' }
    })
    executeApplyPlan(secondPlan, deps)

    expect(fs.statSync(settingsPath).mtimeMs).toBe(mtimeAfterFirst)
  })

  it('leaves .mcp.json mtime unchanged when the resolved bytes already match what is on disk', () => {
    const key = deps.masterKeyProvider.getOrCreateKey()
    deps.secrets.create({ refName: 'mcp:github:TOKEN', encryptedValue: encrypt('ghp_real_value', key) })
    const mcpPath = path.join(projectPath, '.mcp.json')

    executeApplyPlan(
      planWith({
        mcpAfterObject: {
          mcpServers: { github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } } }
        }
      }),
      deps
    )
    const mtimeAfterFirst = fs.statSync(mcpPath).mtimeMs
    const previouslyWritten = fs.readFileSync(mcpPath, 'utf-8')

    const secondPlan = planWith({
      mcpAfterObject: {
        mcpServers: { github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } } }
      },
      mcpFile: { path: mcpPath, before: previouslyWritten, after: 'secret_ref:mcp:github:TOKEN\n' }
    })
    executeApplyPlan(secondPlan, deps)

    expect(fs.statSync(mcpPath).mtimeMs).toBe(mtimeAfterFirst)
  })

  it('rewrites .mcp.json when the stored secret has changed since the last apply', () => {
    const key = deps.masterKeyProvider.getOrCreateKey()
    const created = deps.secrets.create({
      refName: 'mcp:github:TOKEN',
      encryptedValue: encrypt('old_value', key)
    })
    const mcpPath = path.join(projectPath, '.mcp.json')

    executeApplyPlan(
      planWith({
        mcpAfterObject: {
          mcpServers: { github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } } }
        }
      }),
      deps
    )
    const previouslyWritten = fs.readFileSync(mcpPath, 'utf-8')
    expect(previouslyWritten).toContain('old_value')

    deps.secrets.update(created.id, { encryptedValue: encrypt('new_value', key) })

    const secondPlan = planWith({
      mcpAfterObject: {
        mcpServers: { github: { command: 'npx', env: { TOKEN: 'secret_ref:mcp:github:TOKEN' } } }
      },
      mcpFile: { path: mcpPath, before: previouslyWritten, after: 'secret_ref:mcp:github:TOKEN\n' }
    })
    executeApplyPlan(secondPlan, deps)

    const written = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'))
    expect(written.mcpServers.github.env.TOKEN).toBe('new_value')
  })

  it('leaves no temp file behind after a successful apply', () => {
    executeApplyPlan(planWith({}), deps)

    expect(fs.existsSync(path.join(projectPath, '.claude', 'settings.json.skillam-tmp'))).toBe(false)
    expect(fs.existsSync(path.join(projectPath, '.mcp.json.skillam-tmp'))).toBe(false)
  })

  it('leaves earlier operations in place and never runs later ones after a mid-loop failure', () => {
    const claudeDir = path.join(projectPath, '.claude')
    fs.mkdirSync(claudeDir, { recursive: true })
    // Make .claude/skills a regular file so a create-link under it fails when the loop
    // tries to mkdir its parent directory.
    fs.writeFileSync(path.join(claudeDir, 'skills'), 'not a directory')

    const firstPath = path.join(claudeDir, 'agents', 'first.md')
    const brokenLinkPath = path.join(claudeDir, 'skills', 'broken', 'link')
    const thirdPath = path.join(claudeDir, 'agents', 'third.md')

    expect(() =>
      executeApplyPlan(
        planWith({
          operations: [
            { type: 'write-file', path: firstPath, content: 'first' },
            { type: 'create-link', path: brokenLinkPath, target: scratchRoot },
            { type: 'write-file', path: thirdPath, content: 'third' }
          ]
        }),
        deps
      )
    ).toThrow()

    expect(fs.readFileSync(firstPath, 'utf-8')).toBe('first')
    expect(fs.existsSync(thirdPath)).toBe(false)
  })
})
