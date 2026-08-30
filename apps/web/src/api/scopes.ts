import { apiRequest } from './client.js'
import type { Scope, ScopeRole } from './types.js'

export const listScopes = () => apiRequest<Scope[]>('/scopes')

export const createScope = (path: string) =>
  apiRequest<Scope>('/scopes', { method: 'POST', body: JSON.stringify({ path }) })

export const deleteScope = (id: number) => apiRequest<void>(`/scopes/${id}`, { method: 'DELETE' })

export const listScopeRoles = (id: number) => apiRequest<ScopeRole[]>(`/scopes/${id}/roles`)

export const setScopeRoles = (id: number, roleIds: number[]) =>
  apiRequest<ScopeRole[]>(`/scopes/${id}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ roleIds })
  })
