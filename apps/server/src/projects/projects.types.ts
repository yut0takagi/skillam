export interface Project {
  id: number
  path: string
  name: string
  autoDetected: boolean
  excluded: boolean
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
