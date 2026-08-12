import { describe, expect, it } from 'vitest'
import { EMPTY_MANAGED_STATE } from './managed-state.js'
import { planSettings, UnsupportedSettingsError } from './plan-settings.js'

describe('planSettings', () => {
  it('adds the role entries to an empty settings file', () => {
    const result = planSettings({
      currentSettings: {},
      rolePermissions: { allow: ['Edit', 'Read'] },
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.settings).toEqual({ permissions: { allow: ['Edit', 'Read'] } })
    expect(result.managedAllow).toEqual(['Edit', 'Read'])
  })

  it('keeps manually added entries that skillam never managed', () => {
    const result = planSettings({
      currentSettings: { permissions: { allow: ['Bash(git:*)'] } },
      rolePermissions: { allow: ['Edit'] },
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.settings.permissions).toEqual({ allow: ['Bash(git:*)', 'Edit'] })
  })

  it('removes an entry that skillam applied last time but the role no longer has', () => {
    const result = planSettings({
      currentSettings: { permissions: { allow: ['Bash(git:*)', 'Edit', 'WebSearch'] } },
      rolePermissions: { allow: ['Edit'] },
      previous: { ...EMPTY_MANAGED_STATE, permissionAllow: ['Edit', 'WebSearch'] }
    })

    expect(result.settings.permissions).toEqual({ allow: ['Bash(git:*)', 'Edit'] })
  })

  it('does not duplicate an entry that is already present', () => {
    const result = planSettings({
      currentSettings: { permissions: { allow: ['Edit'] } },
      rolePermissions: { allow: ['Edit'] },
      previous: { ...EMPTY_MANAGED_STATE, permissionAllow: ['Edit'] }
    })

    expect(result.settings.permissions).toEqual({ allow: ['Edit'] })
  })

  it('merges deny independently of allow', () => {
    const result = planSettings({
      currentSettings: { permissions: { allow: ['Edit'], deny: ['Bash(rm:*)'] } },
      rolePermissions: { deny: ['Bash(curl:*)'] },
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.settings.permissions).toEqual({
      allow: ['Edit'],
      deny: ['Bash(rm:*)', 'Bash(curl:*)']
    })
  })

  it('passes through unmanaged keys untouched', () => {
    const result = planSettings({
      currentSettings: {
        hooks: { PreToolUse: [{ matcher: 'Bash' }] },
        enabledPlugins: { 'example@market': true },
        permissions: { defaultMode: 'acceptEdits' }
      },
      rolePermissions: { allow: ['Edit'] },
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.settings.hooks).toEqual({ PreToolUse: [{ matcher: 'Bash' }] })
    expect(result.settings.enabledPlugins).toEqual({ 'example@market': true })
    expect((result.settings.permissions as Record<string, unknown>).defaultMode).toBe('acceptEdits')
  })

  it('leaves settings without permissions unchanged when the role has none', () => {
    const result = planSettings({
      currentSettings: { hooks: {} },
      rolePermissions: {},
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.settings).toEqual({ hooks: {} })
  })

  it('refuses to overwrite a permissions value it cannot interpret', () => {
    expect(() =>
      planSettings({
        currentSettings: { permissions: 'all' },
        rolePermissions: { allow: ['Edit'] },
        previous: EMPTY_MANAGED_STATE
      })
    ).toThrow(UnsupportedSettingsError)
  })

  it('accepts settings with no permissions key at all', () => {
    const result = planSettings({
      currentSettings: { language: 'ja' },
      rolePermissions: { allow: ['Edit'] },
      previous: EMPTY_MANAGED_STATE
    })

    expect(result.settings).toEqual({ language: 'ja', permissions: { allow: ['Edit'] } })
  })
})
