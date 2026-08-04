export interface Role {
  id: number
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface CreateRoleInput {
  name: string
  description?: string
}

export interface UpdateRoleInput {
  name?: string
  description?: string
}
