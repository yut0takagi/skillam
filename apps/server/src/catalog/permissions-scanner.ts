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

export function scanPermissions(input: ScanPermissionsInput): PermissionsCandidate[] {
  const candidates: PermissionsCandidate[] = []

  for (const projectPath of input.projectPaths) {
    const settingsPath = path.join(projectPath, '.claude', 'settings.json')
    if (!fs.existsSync(settingsPath)) {
      continue
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { permissions?: unknown }
      if (parsed && typeof parsed === 'object' && parsed.permissions !== undefined) {
        candidates.push({ source: 'project-local', projectPath, permissions: parsed.permissions })
      }
    } catch {
      continue
    }
  }

  return candidates
}
