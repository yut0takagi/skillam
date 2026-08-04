import type Database from 'better-sqlite3'
import type { RoleSkill, RoleSkillInput } from './role-skills.types.js'

interface RoleSkillRow {
  id: number
  skill_source: string
  skill_path: string
}

function toRoleSkill(row: RoleSkillRow): RoleSkill {
  return {
    id: row.id,
    skillSource: row.skill_source as RoleSkill['skillSource'],
    skillPath: row.skill_path
  }
}

export class RoleSkillsRepository {
  constructor(private readonly db: Database.Database) {}

  listForRole(roleId: number): RoleSkill[] {
    const rows = this.db
      .prepare('SELECT id, skill_source, skill_path FROM role_skills WHERE role_id = ? ORDER BY id')
      .all(roleId) as RoleSkillRow[]
    return rows.map(toRoleSkill)
  }

  replaceForRole(roleId: number, items: RoleSkillInput[]): RoleSkill[] {
    const replace = this.db.transaction((entries: RoleSkillInput[]) => {
      this.db.prepare('DELETE FROM role_skills WHERE role_id = ?').run(roleId)
      const insert = this.db.prepare(
        'INSERT INTO role_skills (role_id, skill_source, skill_path) VALUES (?, ?, ?)'
      )
      for (const entry of entries) {
        insert.run(roleId, entry.skillSource, entry.skillPath)
      }
    })
    replace(items)
    return this.listForRole(roleId)
  }
}
