import { staleEntries, type ManagedState } from './managed-state.js'

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
  const currentPermissions =
    typeof input.currentSettings.permissions === 'object' && input.currentSettings.permissions !== null
      ? (input.currentSettings.permissions as Record<string, unknown>)
      : {}

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
