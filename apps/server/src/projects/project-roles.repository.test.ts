import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from '../roles/roles.repository.js'
import { ProjectsRepository } from './projects.repository.js'
import { ProjectRolesRepository } from './project-roles.repository.js'

describe('ProjectRolesRepository', () => {
  let db: Database.Database
  let projectId: number
  let roleIds: number[]

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    projectId = new ProjectsRepository(db).create({ path: '/tmp/p', name: 'p' }).id
    const roles = new RolesRepository(db)
    roleIds = [roles.create({ name: 'a' }).id, roles.create({ name: 'b' }).id]
  })

  it('returns an empty list for a project with no roles', () => {
    expect(new ProjectRolesRepository(db).listForProject(projectId)).toEqual([])
  })

  it('stores assignments with priority following the given order', () => {
    const repo = new ProjectRolesRepository(db)

    const saved = repo.replaceForProject(projectId, [roleIds[1], roleIds[0]])

    expect(saved).toEqual([
      { roleId: roleIds[1], priority: 0 },
      { roleId: roleIds[0], priority: 1 }
    ])
  })

  it('replaces previous assignments instead of appending', () => {
    const repo = new ProjectRolesRepository(db)
    repo.replaceForProject(projectId, [roleIds[0], roleIds[1]])

    const saved = repo.replaceForProject(projectId, [roleIds[1]])

    expect(saved).toEqual([{ roleId: roleIds[1], priority: 0 }])
  })

  it('deduplicates repeated role ids', () => {
    const repo = new ProjectRolesRepository(db)

    const saved = repo.replaceForProject(projectId, [roleIds[0], roleIds[0], roleIds[1]])

    expect(saved).toEqual([
      { roleId: roleIds[0], priority: 0 },
      { roleId: roleIds[1], priority: 1 }
    ])
  })
})
