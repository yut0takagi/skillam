import type { ManagedState } from './managed-state.js'

export type ApplyStatus = 'success' | 'failed'

export interface ApplyHistoryEntry {
  id: number
  projectId: number
  roleId: number | null
  diff: unknown
  managed: ManagedState
  status: ApplyStatus
  errorMessage: string
  appliedAt: string
}

export interface RecordApplyInput {
  projectId: number
  roleId: number | null
  diff: unknown
  managed: ManagedState
  status: ApplyStatus
  errorMessage?: string
}
