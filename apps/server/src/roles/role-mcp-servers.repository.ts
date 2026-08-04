import type Database from 'better-sqlite3'
import type { RoleMcpServer, RoleMcpServerInput } from './role-mcp-servers.types.js'

interface RoleMcpServerRow {
  id: number
  name: string
  command_json: string
  env_json: string
}

function toRoleMcpServer(row: RoleMcpServerRow): RoleMcpServer {
  return {
    id: row.id,
    name: row.name,
    command: JSON.parse(row.command_json),
    env: JSON.parse(row.env_json)
  }
}

export class RoleMcpServersRepository {
  constructor(private readonly db: Database.Database) {}

  listForRole(roleId: number): RoleMcpServer[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, command_json, env_json FROM role_mcp_servers WHERE role_id = ? ORDER BY id'
      )
      .all(roleId) as RoleMcpServerRow[]
    return rows.map(toRoleMcpServer)
  }

  replaceForRole(roleId: number, items: RoleMcpServerInput[]): RoleMcpServer[] {
    const replace = this.db.transaction((entries: RoleMcpServerInput[]) => {
      this.db.prepare('DELETE FROM role_mcp_servers WHERE role_id = ?').run(roleId)
      const insert = this.db.prepare(
        'INSERT INTO role_mcp_servers (role_id, name, command_json, env_json) VALUES (?, ?, ?, ?)'
      )
      for (const entry of entries) {
        insert.run(roleId, entry.name, JSON.stringify(entry.command), JSON.stringify(entry.env ?? {}))
      }
    })
    replace(items)
    return this.listForRole(roleId)
  }
}
