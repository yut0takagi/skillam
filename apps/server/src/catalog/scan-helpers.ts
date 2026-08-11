// apps/server/src/catalog/scan-helpers.ts
import fs from 'node:fs'
import path from 'node:path'

const MAX_PLUGIN_SEARCH_DEPTH = 8

export function parseFrontmatterField(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))
  return match ? match[1].trim() : undefined
}

export function findDirsNamed(
  root: string,
  targetDirName: string,
  maxDepth: number = MAX_PLUGIN_SEARCH_DEPTH
): string[] {
  const found: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) {
      return
    }
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }
      const entryPath = path.join(dir, entry.name)
      let isDir = entry.isDirectory()
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(entryPath).isDirectory()
        } catch {
          continue
        }
      }
      if (!isDir) {
        continue
      }
      if (entry.name === targetDirName) {
        found.push(entryPath)
        continue
      }
      walk(entryPath, depth + 1)
    }
  }

  if (fs.existsSync(root)) {
    walk(root, 0)
  }
  return found
}
