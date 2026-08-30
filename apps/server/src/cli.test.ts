import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { buildApp } from './app.js'
import { InMemoryKeychainClient } from './secrets/in-memory-keychain-client.js'
import { runCheck } from './cli.js'

describe('runCheck', () => {
  let db: Database.Database
  let dbPath: string
  let scratchRoot: string
  let projectPath: string

  beforeEach(async () => {
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-cli-test-')))
    dbPath = path.join(scratchRoot, 'db', 'skillam.db')
    projectPath = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectPath, { recursive: true })

    db = openDb(dbPath)
    runMigrations(db)
    db.close()
  })

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  async function registerAndApply(): Promise<{ projectId: number; roleId: number }> {
    const setupDb = openDb(dbPath)
    runMigrations(setupDb)
    const app = buildApp(setupDb, new InMemoryKeychainClient())

    const projectId = (
      await app.inject({ method: 'POST', url: '/projects', payload: { path: projectPath, name: 'p' } })
    ).json().id
    const roleId = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dev' } })).json().id
    await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/permissions`,
      payload: { permissions: { allow: ['Edit'] } }
    })
    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })

    await app.close()
    setupDb.close()
    return { projectId, roleId }
  }

  it('exits 0 when there is no drift', async () => {
    await registerAndApply()

    const result = await runCheck(['check'], { dbPath })

    expect(result.code).toBe(0)
  })

  it('exits 1 when a recorded permission is gone', async () => {
    await registerAndApply()
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: [] } }))

    const result = await runCheck(['check'], { dbPath })

    expect(result.code).toBe(1)
  })

  it('exits 1 when a recorded symlink is gone', async () => {
    const skillPath = path.join(scratchRoot, 'skills', 'drawio')
    fs.mkdirSync(skillPath, { recursive: true })

    const setupDb = openDb(dbPath)
    runMigrations(setupDb)
    const app = buildApp(setupDb, new InMemoryKeychainClient())

    const projectId = (
      await app.inject({ method: 'POST', url: '/projects', payload: { path: projectPath, name: 'p' } })
    ).json().id
    const roleId = (await app.inject({ method: 'POST', url: '/roles', payload: { name: 'dev' } })).json().id
    await app.inject({
      method: 'PUT',
      url: `/roles/${roleId}/skills`,
      payload: { skills: [{ skillSource: 'user', skillPath }] }
    })
    await app.inject({ method: 'POST', url: `/projects/${projectId}/apply`, payload: { roleId } })
    await app.close()
    setupDb.close()

    fs.rmSync(path.join(projectPath, '.claude', 'skills', 'drawio'))

    const result = await runCheck(['check'], { dbPath })

    expect(result.code).toBe(1)
    expect(result.output).toContain('drawio')
  })

  it('exits 2 when the database file does not exist', async () => {
    const missingDbPath = path.join(scratchRoot, 'does-not-exist.db')

    const result = await runCheck(['check'], { dbPath: missingDbPath })

    expect(result.code).toBe(2)
  })

  it('exits 2 when the given path is not registered', async () => {
    await registerAndApply()
    const otherPath = path.join(scratchRoot, 'unregistered')
    fs.mkdirSync(otherPath, { recursive: true })

    const result = await runCheck(['check', otherPath], { dbPath })

    expect(result.code).toBe(2)
  })

  it('exits 2 on an unknown flag', async () => {
    await registerAndApply()

    const result = await runCheck(['check', '--bogus'], { dbPath })

    expect(result.code).toBe(2)
  })

  it('--json emits parseable JSON carrying the same verdict', async () => {
    await registerAndApply()
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: [] } }))

    const result = await runCheck(['check', '--json'], { dbPath })

    expect(result.code).toBe(1)
    const parsed = JSON.parse(result.output)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0].hasDrift).toBe(true)
  })

  it('checks every project when no argument is given', async () => {
    await registerAndApply()
    const secondPath = path.join(scratchRoot, 'project-2')
    fs.mkdirSync(secondPath, { recursive: true })

    const setupDb = openDb(dbPath)
    runMigrations(setupDb)
    const app = buildApp(setupDb, new InMemoryKeychainClient())
    await app.inject({ method: 'POST', url: '/projects', payload: { path: secondPath, name: 'p2' } })
    await app.close()
    setupDb.close()

    const result = await runCheck(['check', '--json'], { dbPath })

    expect(result.code).toBe(0)
    const parsed = JSON.parse(result.output)
    expect(parsed).toHaveLength(2)
  })

  it('does not fail for a project that was never applied', async () => {
    const setupDb = openDb(dbPath)
    runMigrations(setupDb)
    const app = buildApp(setupDb, new InMemoryKeychainClient())
    await app.inject({ method: 'POST', url: '/projects', payload: { path: projectPath, name: 'p' } })
    await app.close()
    setupDb.close()

    const result = await runCheck(['check'], { dbPath })

    expect(result.code).toBe(0)
  })

  it('names each drifted item in the human output', async () => {
    await registerAndApply()
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: [] } }))

    const result = await runCheck(['check'], { dbPath })

    expect(result.output).toContain('Edit')
    expect(result.output).toContain('permission-missing')
  })

  it('checks a single project by its registered path', async () => {
    await registerAndApply()

    const result = await runCheck(['check', projectPath], { dbPath })

    expect(result.code).toBe(0)
    expect(result.output).toContain(projectPath)
  })

  it('exits 2 when the config cannot be parsed', async () => {
    await registerAndApply()
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.local.json'), '{ broken')

    const result = await runCheck(['check'], { dbPath })

    expect(result.code).toBe(2)
  })

  // Decision: exit 2 ("could not run"), not exit 1 ("drift"). An unparsable
  // settings.local.json means skillam could not determine whether drift exists at
  // all for this project — that is a different failure mode from "drift was
  // found and reported", which is exactly what exit code 1 promises to CI.
  // Collapsing the two into exit 1 would make a CI failure ambiguous between
  // "someone edited a managed setting" and "the config is broken JSON",
  // which is the same ambiguity the 1-vs-2 split exists to prevent (see
  // docs/superpowers/plans/2026-08-27-skillam-phase3b-drift.md).
  it('exits 2, not 1, when settings.local.json is invalid JSON — malformed config could not be checked, it did not report a drift finding', async () => {
    await registerAndApply()
    fs.writeFileSync(path.join(projectPath, '.claude', 'settings.local.json'), '{ this is not json')

    const result = await runCheck(['check'], { dbPath })

    expect(result.code).toBe(2)
    expect(result.output).toContain('settings.local.json')
    expect(result.output).toContain('JSON')
    // Must read as "this file is malformed", never as drift/symlink language.
    expect(result.output).not.toContain('materialized-changed')
    expect(result.output).not.toContain('symlink')
    expect(result.output).not.toContain('シンボリックリンク')
  })
})
