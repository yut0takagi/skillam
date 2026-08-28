import { apiRequest } from './client.js'
import type { Role, RoleDetail, RoleSkill, RoleMcpServer, RoleAgent, RoleExportPayload } from './types.js'

export const listRoles = () => apiRequest<Role[]>('/roles')
export const getRole = (id: number) => apiRequest<RoleDetail>(`/roles/${id}`)

export const createRole = (name: string, description?: string) =>
  apiRequest<Role>('/roles', { method: 'POST', body: JSON.stringify({ name, description }) })

export const updateRole = (id: number, body: { name?: string; description?: string }) =>
  apiRequest<Role>(`/roles/${id}`, { method: 'PUT', body: JSON.stringify(body) })

export const deleteRole = (id: number) => apiRequest<void>(`/roles/${id}`, { method: 'DELETE' })

export const setRoleSkills = (id: number, skills: Array<{ skillSource: string; skillPath: string }>) =>
  apiRequest<RoleSkill[]>(`/roles/${id}/skills`, {
    method: 'PUT',
    body: JSON.stringify({ skills })
  })

export const setRoleMcpServers = (
  id: number,
  servers: Array<{ name: string; command: unknown; env?: Record<string, string> }>
) =>
  apiRequest<RoleMcpServer[]>(`/roles/${id}/mcp-servers`, {
    method: 'PUT',
    body: JSON.stringify({ servers })
  })

export const setRoleAgents = (
  id: number,
  agents: Array<{ name: string; markdownBody: string; source: string; sourcePath?: string }>
) =>
  apiRequest<RoleAgent[]>(`/roles/${id}/agents`, {
    method: 'PUT',
    body: JSON.stringify({ agents })
  })

export const setRolePermissions = (id: number, permissions: unknown) =>
  apiRequest<{ roleId: number; permissions: unknown }>(`/roles/${id}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissions })
  })

export const exportRole = (id: number) => apiRequest<RoleExportPayload>(`/roles/${id}/export`)

export const importRole = (payload: unknown) =>
  apiRequest<RoleDetail>('/roles/import', { method: 'POST', body: JSON.stringify(payload) })
