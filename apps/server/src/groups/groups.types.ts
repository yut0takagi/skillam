export interface Group {
  id: number
  name: string
  description: string
  createdAt: string
}

export interface CreateGroupInput {
  name: string
  description?: string
}

export interface UpdateGroupInput {
  name?: string
  description?: string
}

export interface GroupRole {
  roleId: number
  priority: number
}

// A binding that reached a project through one of its groups. The group's
// name travels with it because composeRoles stamps `{ kind: 'group', name }`
// on every item it produces — resolving the name later would mean a query
// per binding.
export interface ProjectGroupRole extends GroupRole {
  groupId: number
  groupName: string
}
