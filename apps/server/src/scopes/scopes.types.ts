export interface Scope {
  id: number
  path: string
  createdAt: string
}

export interface CreateScopeInput {
  path: string
}

export interface ScopeRole {
  roleId: number
  priority: number
}

// A binding that reached a project because the project sits under this scope's
// path. The path travels with it because composeRoles stamps
// `{ kind: 'scope', path }` on every item and ranks deeper paths as stronger.
export interface ProjectScopeRole extends ScopeRole {
  scopeId: number
  scopePath: string
}
