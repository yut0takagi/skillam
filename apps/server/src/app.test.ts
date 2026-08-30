import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { buildApp, resolveCatalogRoots } from './app.js'
import { KeychainAccessError } from './secrets/keychain-client.js'
import { InMemoryKeychainClient } from './secrets/in-memory-keychain-client.js'

describe('GET /health', () => {
  it('returns status ok', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})

describe('CORS', () => {
  it('allows the vite dev server origin', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' }
    })

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('allows the write methods the web ui needs', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/projects/1/roles',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PUT'
      }
    })

    const allowed = String(response.headers['access-control-allow-methods'])
    expect(allowed).toContain('PUT')
    expect(allowed).toContain('DELETE')
  })

  it('does not allow an unrelated origin', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.com' }
    })

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('error handler', () => {
  it('returns 400 (not 500) when the framework itself rejects a malformed JSON body', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({
      method: 'POST',
      url: '/roles',
      headers: { 'content-type': 'application/json' },
      payload: 'not valid json{'
    })

    expect(response.statusCode).toBe(400)
  })

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
})

describe('resolveCatalogRoots', () => {
  const envKeys = [
    'SKILLAM_USER_SKILLS_ROOT',
    'SKILLAM_USER_AGENTS_ROOT',
    'SKILLAM_PLUGINS_CACHE_ROOT',
    'SKILLAM_CLAUDE_JSON_PATH'
  ] as const

  beforeEach(() => {
    for (const key of envKeys) delete process.env[key]
  })

  afterEach(() => {
    for (const key of envKeys) delete process.env[key]
  })

  it('falls back to the paths under the home directory when nothing overrides them', () => {
    const roots = resolveCatalogRoots({})

    expect(roots.userSkillsRoot).toBe(path.join(os.homedir(), '.claude', 'skills'))
    expect(roots.userAgentsRoot).toBe(path.join(os.homedir(), '.claude', 'agents'))
    expect(roots.pluginsCacheRoot).toBe(path.join(os.homedir(), '.claude', 'plugins', 'cache'))
    expect(roots.claudeJsonPath).toBe(path.join(os.homedir(), '.claude.json'))
  })

  it('reads each root from its environment variable', () => {
    process.env.SKILLAM_USER_SKILLS_ROOT = '/env/skills'
    process.env.SKILLAM_USER_AGENTS_ROOT = '/env/agents'
    process.env.SKILLAM_PLUGINS_CACHE_ROOT = '/env/plugins'
    process.env.SKILLAM_CLAUDE_JSON_PATH = '/env/claude.json'

    const roots = resolveCatalogRoots({})

    expect(roots.userSkillsRoot).toBe('/env/skills')
    expect(roots.userAgentsRoot).toBe('/env/agents')
    expect(roots.pluginsCacheRoot).toBe('/env/plugins')
    expect(roots.claudeJsonPath).toBe('/env/claude.json')
  })

  // An explicit argument is how the tests inject temporary directories. If the
  // environment won over it, a stray variable in the developer's shell would
  // silently redirect the scan at the real ~/.claude and make tests read the
  // machine's own config.
  it('prefers an explicit argument over the environment variable', () => {
    process.env.SKILLAM_USER_SKILLS_ROOT = '/env/skills'

    const roots = resolveCatalogRoots({ userSkillsRoot: '/explicit/skills' })

    expect(roots.userSkillsRoot).toBe('/explicit/skills')
  })

  it('overrides only the roots that are set and leaves the rest at their defaults', () => {
    process.env.SKILLAM_USER_SKILLS_ROOT = '/env/skills'

    const roots = resolveCatalogRoots({})

    expect(roots.userSkillsRoot).toBe('/env/skills')
    expect(roots.userAgentsRoot).toBe(path.join(os.homedir(), '.claude', 'agents'))
  })

  // An exported-but-empty variable (SKILLAM_USER_SKILLS_ROOT= in a shell
  // profile) is the same as not setting it. Treating '' as a path would make
  // the scanner look at the process's working directory.
  it('ignores an empty environment variable', () => {
    process.env.SKILLAM_USER_SKILLS_ROOT = ''

    const roots = resolveCatalogRoots({})

    expect(roots.userSkillsRoot).toBe(path.join(os.homedir(), '.claude', 'skills'))
  })

  it('expands a leading ~ so the value works when written in a shell profile', () => {
    process.env.SKILLAM_USER_SKILLS_ROOT = '~/custom/skills'

    const roots = resolveCatalogRoots({})

    expect(roots.userSkillsRoot).toBe(path.join(os.homedir(), 'custom', 'skills'))
  })
})
