import { apiRequest } from './client.js'
import type { Group, GroupRole, Project } from './types.js'

export const listGroups = () => apiRequest<Group[]>('/groups')
export const getGroup = (id: number) => apiRequest<Group>(`/groups/${id}`)

export const createGroup = (name: string, description?: string) =>
  apiRequest<Group>('/groups', { method: 'POST', body: JSON.stringify({ name, description }) })

export const updateGroup = (id: number, body: { name?: string; description?: string }) =>
  apiRequest<Group>(`/groups/${id}`, { method: 'PUT', body: JSON.stringify(body) })

export const deleteGroup = (id: number) => apiRequest<void>(`/groups/${id}`, { method: 'DELETE' })

export const listGroupRoles = (id: number) => apiRequest<GroupRole[]>(`/groups/${id}/roles`)

export const setGroupRoles = (id: number, roleIds: number[]) =>
  apiRequest<GroupRole[]>(`/groups/${id}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ roleIds })
  })

export const listGroupProjects = (id: number) => apiRequest<Project[]>(`/groups/${id}/projects`)
