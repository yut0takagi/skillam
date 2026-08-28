import { staleEntries, type ManagedState } from './managed-state.js'
import { UnreadableConfigError } from './project-state.js'

// planSettings only ever throws this for one condition — the recorded
// settings.permissions value is not an object — which is the same
// "can't safely interpret this config" condition project-state.ts
// guards against for the raw file read/parse step. Kept as one shared
// class (re-exported under its historical name) so every catch/instanceof
// site, old and new, sees the same error type instead of two unrelated
// ones for the same failure.
export const UnsupportedSettingsError = UnreadableConfigError

export interface RolePermissionsShape {
  allow?: string[]
  deny?: string[]
}

export interface PlanSettingsInput {
  currentSettings: Record<string, unknown>
  rolePermissions: RolePermissionsShape
  previous: ManagedState
}

export interface PlanSettingsResult {
  settings: Record<string, unknown>
  managedAllow: string[]
  managedDeny: string[]
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

// Entries are tracked by string identity, not provenance: if the user manually
// re-adds a string identical to one skillam previously wrote and the role later
// drops it, mergeList has no way to tell the manual re-add apart from skillam's
// own stale write, so it is removed. This is inherent to name-based tracking;
// do not "fix" it by loosening staleEntries, or the removal contract breaks.
function mergeList(current: string[], roleEntries: string[], previouslyManaged: string[]): string[] {
  const stale = staleEntries(previouslyManaged, roleEntries)
  const merged = current.filter((entry) => !stale.includes(entry))
  for (const entry of roleEntries) {
    if (!merged.includes(entry)) {
      merged.push(entry)
    }
  }
  return merged
}

export function planSettings(input: PlanSettingsInput): PlanSettingsResult {
  const rawPermissions = input.currentSettings.permissions
  if (rawPermissions !== undefined && (typeof rawPermissions !== 'object' || rawPermissions === null)) {
    throw new UnsupportedSettingsError(
      '.claude/settings.json の permissions がオブジェクトではありません。skillam は解釈できない値を上書きしません。'
    )
  }
  const currentPermissions = (rawPermissions ?? {}) as Record<string, unknown>

  const roleAllow = input.rolePermissions.allow ?? []
  const roleDeny = input.rolePermissions.deny ?? []

  const allow = mergeList(readStringArray(currentPermissions.allow), roleAllow, input.previous.permissionAllow)
  const deny = mergeList(readStringArray(currentPermissions.deny), roleDeny, input.previous.permissionDeny)

  const permissions: Record<string, unknown> = { ...currentPermissions }
  if (allow.length > 0 || 'allow' in currentPermissions) {
    permissions.allow = allow
  }
  if (deny.length > 0 || 'deny' in currentPermissions) {
    permissions.deny = deny
  }

  const settings: Record<string, unknown> = { ...input.currentSettings }
  if (Object.keys(permissions).length > 0) {
    settings.permissions = permissions
  }

  return { settings, managedAllow: roleAllow, managedDeny: roleDeny }
}
