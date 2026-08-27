import { apiRequest } from './client.js'
import type { AutoDetectRoot, SecretSummary } from './types.js'

export const listAutoDetectRoots = () => apiRequest<AutoDetectRoot[]>('/auto-detect-roots')

export const addAutoDetectRoot = (path: string) =>
  apiRequest<AutoDetectRoot>('/auto-detect-roots', {
    method: 'POST',
    body: JSON.stringify({ path })
  })

export const deleteAutoDetectRoot = (id: number) =>
  apiRequest<void>(`/auto-detect-roots/${id}`, { method: 'DELETE' })

export const listSecrets = () => apiRequest<SecretSummary[]>('/secrets')

export const deleteSecret = (id: number) => apiRequest<void>(`/secrets/${id}`, { method: 'DELETE' })

export const revealSecret = (id: number) =>
  apiRequest<{ value: string }>(`/secrets/${id}/reveal`, { method: 'POST' })
