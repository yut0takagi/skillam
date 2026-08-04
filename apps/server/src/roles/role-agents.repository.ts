import type Database from 'better-sqlite3'
import type { RoleAgent, RoleAgentInput } from './role-agents.types.js'

interface RoleAgentRow {
  id: number
  name: string
  markdown_body: string
  source: string
}

function toRoleAgent(row: RoleAgentRow): RoleAgent {
  return {
    id: row.id,
    name: row.name,
    markdownBody: row.markdown_body,
    source: row.source as RoleAgent['source']
  }
}

export class RoleAgentsRepository {
  constructor(private readonly db: Database.Database) {}

  listForRole(roleId: number): RoleAgent[] {
    const rows = this.db
      .prepare('SELECT id, name, markdown_body, source FROM role_agents WHERE role_id = ? ORDER BY id')
      .all(roleId) as RoleAgentRow[]
    return rows.map(toRoleAgent)
  }

  replaceForRole(roleId: number, items: RoleAgentInput[]): RoleAgent[] {
    const replace = this.db.transaction((entries: RoleAgentInput[]) => {
      this.db.prepare('DELETE FROM role_agents WHERE role_id = ?').run(roleId)
      const insert = this.db.prepare(
        'INSERT INTO role_agents (role_id, name, markdown_body, source) VALUES (?, ?, ?, ?)'
      )
      for (const entry of entries) {
        insert.run(roleId, entry.name, entry.markdownBody, entry.source)
      }
    })
    replace(items)
    return this.listForRole(roleId)
  }
}
