import type Database from 'better-sqlite3'
import type { RolePermissions, RolePermissionsInput } from './role-permissions.types.js'

interface RolePermissionsRow {
  role_id: number
  permissions_json: string
}

function toRolePermissions(row: RolePermissionsRow): RolePermissions {
  return {
    roleId: row.role_id,
    permissions: JSON.parse(row.permissions_json)
  }
}

export class RolePermissionsRepository {
  constructor(private readonly db: Database.Database) {}

  getForRole(roleId: number): RolePermissions | undefined {
    const row = this.db
      .prepare('SELECT role_id, permissions_json FROM role_permissions WHERE role_id = ?')
      .get(roleId) as RolePermissionsRow | undefined
    return row ? toRolePermissions(row) : undefined
  }

  setForRole(roleId: number, input: RolePermissionsInput): RolePermissions {
    this.db
      .prepare(
        `INSERT INTO role_permissions (role_id, permissions_json)
         VALUES (@roleId, @permissionsJson)
         ON CONFLICT(role_id) DO UPDATE SET permissions_json = excluded.permissions_json`
      )
      .run({ roleId, permissionsJson: JSON.stringify(input.permissions) })
    return this.getForRole(roleId)!
  }
}
