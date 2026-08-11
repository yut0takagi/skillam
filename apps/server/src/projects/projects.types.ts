export interface Project {
  id: number
  path: string
  name: string
  autoDetected: boolean
  excluded: boolean
  lastAppliedRoleId: number | null
  lastAppliedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  path: string
  name: string
  autoDetected?: boolean
  excluded?: boolean
}

export interface UpdateProjectInput {
  name?: string
  excluded?: boolean
}
