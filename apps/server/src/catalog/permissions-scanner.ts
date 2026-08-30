// apps/server/src/catalog/permissions-scanner.ts
import fs from 'node:fs'
import path from 'node:path'

export interface PermissionsCandidate {
  source: 'project-local'
  projectPath: string
  permissions: unknown
}

interface ScanPermissionsInput {
  projectPaths: string[]
}

// Both files are read, in this order. settings.json holds what the project (or
// its team) committed by hand; settings.local.json is where skillam writes its
// own applies, so a scan limited to settings.json would be blind to everything
// skillam itself put there. Order is stable so callers see hand-written
// entries before skillam-applied ones.
const SETTINGS_FILENAMES = ['settings.json', 'settings.local.json']

export function scanPermissions(input: ScanPermissionsInput): PermissionsCandidate[] {
  const candidates: PermissionsCandidate[] = []

  for (const projectPath of input.projectPaths) {
    for (const filename of SETTINGS_FILENAMES) {
      const settingsPath = path.join(projectPath, '.claude', filename)
      if (!fs.existsSync(settingsPath)) {
        continue
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { permissions?: unknown }
        if (parsed && typeof parsed === 'object' && parsed.permissions !== undefined) {
          candidates.push({ source: 'project-local', projectPath, permissions: parsed.permissions })
        }
      } catch {
        // An unparseable file is skipped rather than fatal: the other file may
        // still be readable, and a scan is a read-only survey — it must not
        // fail the whole catalog over one broken project.
        continue
      }
    }
  }

  return candidates
}
