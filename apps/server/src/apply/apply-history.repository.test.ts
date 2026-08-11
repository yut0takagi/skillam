import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from '../roles/roles.repository.js'
import { ProjectsRepository } from '../projects/projects.repository.js'
import { ApplyHistoryRepository } from './apply-history.repository.js'
import { EMPTY_MANAGED_STATE } from './managed-state.js'

describe('ApplyHistoryRepository', () => {
  let db: Database.Database
  let projectId: number
  let roleId: number

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    projectId = new ProjectsRepository(db).create({ path: '/tmp/h', name: 'h' }).id
    roleId = new RolesRepository(db).create({ name: 'dev' }).id
  })

  it('returns an empty list for a project with no history', () => {
    expect(new ApplyHistoryRepository(db).listForProject(projectId)).toEqual([])
  })

  it('records a successful apply with its managed state', () => {
    const repo = new ApplyHistoryRepository(db)

    const entry = repo.record({
      projectId,
      roleId,
      diff: { files: ['settings.json'] },
      managed: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] },
      status: 'success'
    })

    expect(entry).toEqual(
      expect.objectContaining({
        projectId,
        roleId,
        status: 'success',
        errorMessage: '',
        diff: { files: ['settings.json'] },
        managed: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] }
      })
    )
  })

  it('records a failed apply with its error message', () => {
    const repo = new ApplyHistoryRepository(db)

    const entry = repo.record({
      projectId,
      roleId,
      diff: {},
      managed: EMPTY_MANAGED_STATE,
      status: 'failed',
      errorMessage: 'EACCES: permission denied'
    })

    expect(entry.status).toBe('failed')
    expect(entry.errorMessage).toBe('EACCES: permission denied')
  })

  it('lists history newest first', () => {
    const repo = new ApplyHistoryRepository(db)
    const first = repo.record({ projectId, roleId, diff: {}, managed: EMPTY_MANAGED_STATE, status: 'success' })
    const second = repo.record({ projectId, roleId, diff: {}, managed: EMPTY_MANAGED_STATE, status: 'success' })

    expect(repo.listForProject(projectId).map((entry) => entry.id)).toEqual([second.id, first.id])
  })

  it('returns the most recent successful entry, ignoring failures', () => {
    const repo = new ApplyHistoryRepository(db)
    const success = repo.record({
      projectId,
      roleId,
      diff: {},
      managed: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] },
      status: 'success'
    })
    repo.record({ projectId, roleId, diff: {}, managed: EMPTY_MANAGED_STATE, status: 'failed' })

    expect(repo.lastSuccessful(projectId)?.id).toBe(success.id)
  })

  it('returns undefined when a project has no successful apply', () => {
    expect(new ApplyHistoryRepository(db).lastSuccessful(projectId)).toBeUndefined()
  })

  it('keeps history readable after its role is deleted', () => {
    const repo = new ApplyHistoryRepository(db)
    repo.record({
      projectId,
      roleId,
      diff: {},
      managed: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] },
      status: 'success'
    })

    db.prepare('DELETE FROM roles WHERE id = ?').run(roleId)

    const entry = repo.lastSuccessful(projectId)
    expect(entry?.roleId).toBeNull()
    expect(entry?.managed.mcpServers).toEqual(['github'])
  })

  it('records an apply whose diff cannot be serialized', () => {
    const repo = new ApplyHistoryRepository(db)
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const entry = repo.record({
      projectId,
      roleId,
      diff: circular,
      managed: { ...EMPTY_MANAGED_STATE, mcpServers: ['github'] },
      status: 'success'
    })

    expect(entry.diff).toEqual({})
    expect(entry.managed.mcpServers).toEqual(['github'])
  })

  it('reads back an empty diff when the stored diff json is corrupt', () => {
    const repo = new ApplyHistoryRepository(db)
    db.prepare(
      "INSERT INTO apply_history (project_id, role_id, diff_json, managed_json, status) VALUES (?, ?, '{not json', '{}', 'success')"
    ).run(projectId, roleId)

    expect(repo.lastSuccessful(projectId)?.diff).toEqual({})
  })
})
