import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { ProjectsRepository } from '../projects/projects.repository.js'
import { GroupsRepository } from './groups.repository.js'
import { ProjectGroupsRepository } from './project-groups.repository.js'

describe('ProjectGroupsRepository', () => {
  let db: Database.Database
  let repo: ProjectGroupsRepository
  let projectId: number
  let groupIds: number[]

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new ProjectGroupsRepository(db)
    projectId = new ProjectsRepository(db).create({ path: '/tmp/p', name: 'p' }).id
    const groups = new GroupsRepository(db)
    groupIds = [groups.create({ name: 'alpha' }).id, groups.create({ name: 'beta' }).id]
  })

  it('returns an empty list for a project in no groups', () => {
    expect(repo.listForProject(projectId)).toEqual([])
  })

  it('stores memberships ordered by group name', () => {
    const saved = repo.replaceForProject(projectId, [groupIds[1], groupIds[0]])

    expect(saved.map((group) => group.name)).toEqual(['alpha', 'beta'])
  })

  it('replaces previous memberships instead of appending', () => {
    repo.replaceForProject(projectId, [groupIds[0], groupIds[1]])

    const saved = repo.replaceForProject(projectId, [groupIds[1]])

    expect(saved.map((group) => group.id)).toEqual([groupIds[1]])
  })

  it('deduplicates repeated group ids', () => {
    const saved = repo.replaceForProject(projectId, [groupIds[0], groupIds[0]])

    expect(saved.map((group) => group.id)).toEqual([groupIds[0]])
  })

  it('clears memberships when given an empty list', () => {
    repo.replaceForProject(projectId, [groupIds[0]])

    expect(repo.replaceForProject(projectId, [])).toEqual([])
  })

  it('lists the projects belonging to a group', () => {
    const otherProjectId = new ProjectsRepository(db).create({ path: '/tmp/q', name: 'q' }).id
    repo.replaceForProject(projectId, [groupIds[0]])
    repo.replaceForProject(otherProjectId, [groupIds[0]])

    expect(repo.listForGroup(groupIds[0]).map((project) => project.name)).toEqual(['p', 'q'])
  })

  it('keeps one project’s memberships out of another’s', () => {
    const otherProjectId = new ProjectsRepository(db).create({ path: '/tmp/q', name: 'q' }).id
    repo.replaceForProject(projectId, [groupIds[0]])

    repo.replaceForProject(otherProjectId, [groupIds[1]])

    expect(repo.listForProject(projectId).map((group) => group.id)).toEqual([groupIds[0]])
  })
})
