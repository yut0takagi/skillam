import { apiRequest } from './client.js'
import type {
  Group,
  Project,
  ProjectRole,
  ScanCandidate,
  ApplyHistoryEntry,
  ApplyPlan,
  ApplySuccess,
  DriftReport
} from './types.js'

export const listProjects = () => apiRequest<Project[]>('/projects')
export const getProject = (id: number) => apiRequest<Project>(`/projects/${id}`)
export const scanProjects = () => apiRequest<ScanCandidate[]>('/projects/scan')

export const createProject = (path: string, name: string) =>
  apiRequest<Project>('/projects', { method: 'POST', body: JSON.stringify({ path, name }) })

export const updateProject = (id: number, body: { name?: string; excluded?: boolean }) =>
  apiRequest<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) })

export const deleteProject = (id: number) => apiRequest<void>(`/projects/${id}`, { method: 'DELETE' })

export const listProjectRoles = (id: number) => apiRequest<ProjectRole[]>(`/projects/${id}/roles`)

export const setProjectRoles = (id: number, roleIds: number[]) =>
  apiRequest<ProjectRole[]>(`/projects/${id}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ roleIds })
  })

// Omitting roleId composes every binding reaching the project — scope, group
// and direct. Passing one previews that single role in isolation, which is how
// a role is examined before it is bound to anything.
export const previewApply = (id: number, roleId?: number) =>
  apiRequest<ApplyPlan>(`/projects/${id}/apply/preview`, {
    method: 'POST',
    body: JSON.stringify(roleId === undefined ? {} : { roleId })
  })

export const applyRole = (id: number, roleId?: number) =>
  apiRequest<ApplySuccess>(`/projects/${id}/apply`, {
    method: 'POST',
    body: JSON.stringify(roleId === undefined ? {} : { roleId })
  })

export const listProjectGroups = (id: number) => apiRequest<Group[]>(`/projects/${id}/groups`)

export const setProjectGroups = (id: number, groupIds: number[]) =>
  apiRequest<Group[]>(`/projects/${id}/groups`, {
    method: 'PUT',
    body: JSON.stringify({ groupIds })
  })

export const listApplyHistory = (id: number) =>
  apiRequest<ApplyHistoryEntry[]>(`/projects/${id}/apply-history`)

export const listDrift = () => apiRequest<DriftReport[]>('/drift')

export const getProjectDrift = (id: number) => apiRequest<DriftReport>(`/projects/${id}/drift`)
