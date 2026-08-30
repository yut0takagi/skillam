import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import { RolesRepository } from '../roles/roles.repository.js'
import { GroupsRepository } from './groups.repository.js'
import { GroupRolesRepository } from './group-roles.repository.js'

describe('GroupRolesRepository', () => {
  let db: Database.Database
  let repo: GroupRolesRepository
  let groupId: number
  let roleIds: number[]

  beforeEach(() => {
    db = openDb(':memory:')
    runMigrations(db)
    repo = new GroupRolesRepository(db)
    groupId = new GroupsRepository(db).create({ name: 'typescript' }).id
    const roles = new RolesRepository(db)
    roleIds = [roles.create({ name: 'a' }).id, roles.create({ name: 'b' }).id]
  })

  it('returns an empty list for a group with no roles', () => {
    expect(repo.listForGroup(groupId)).toEqual([])
  })

  it('stores assignments with priority following the given order', () => {
    const saved = repo.replaceForGroup(groupId, [roleIds[1], roleIds[0]])

    expect(saved).toEqual([
      { roleId: roleIds[1], priority: 0 },
      { roleId: roleIds[0], priority: 1 }
    ])
  })

  it('replaces previous assignments instead of appending', () => {
    repo.replaceForGroup(groupId, [roleIds[0], roleIds[1]])

    expect(repo.replaceForGroup(groupId, [roleIds[1]])).toEqual([{ roleId: roleIds[1], priority: 0 }])
  })

  it('deduplicates repeated role ids', () => {
    const saved = repo.replaceForGroup(groupId, [roleIds[0], roleIds[0], roleIds[1]])

    expect(saved).toEqual([
      { roleId: roleIds[0], priority: 0 },
      { roleId: roleIds[1], priority: 1 }
    ])
  })

  // The apply path walks every group a project belongs to, so a role bound to
  // one group must not surface through another.
  it('keeps one group’s roles out of another’s', () => {
    const otherGroupId = new GroupsRepository(db).create({ name: 'python' }).id
    repo.replaceForGroup(groupId, [roleIds[0]])

    repo.replaceForGroup(otherGroupId, [roleIds[1]])

    expect(repo.listForGroup(groupId)).toEqual([{ roleId: roleIds[0], priority: 0 }])
  })

  // resolveBindings needs the group's name for the origin it stamps on every
  // composed item, and one query per group would be a round trip per member.
  it('lists every binding reaching a project through its groups', () => {
    const otherGroupId = new GroupsRepository(db).create({ name: 'python' }).id
    repo.replaceForGroup(groupId, [roleIds[0]])
    repo.replaceForGroup(otherGroupId, [roleIds[1]])
    db.prepare("INSERT INTO projects (path, name) VALUES ('/tmp/p', 'p')").run()
    db.prepare('INSERT INTO project_groups (project_id, group_id) VALUES (1, ?)').run(groupId)
    db.prepare('INSERT INTO project_groups (project_id, group_id) VALUES (1, ?)').run(otherGroupId)

    expect(repo.listForProject(1)).toEqual([
      { roleId: roleIds[1], priority: 0, groupId: otherGroupId, groupName: 'python' },
      { roleId: roleIds[0], priority: 0, groupId, groupName: 'typescript' }
    ])
  })

  it('returns no bindings for a project in no groups', () => {
    db.prepare("INSERT INTO projects (path, name) VALUES ('/tmp/p', 'p')").run()

    expect(repo.listForProject(1)).toEqual([])
  })
})
