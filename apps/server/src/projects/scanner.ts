import fs from 'node:fs'
import path from 'node:path'

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.turbo'
])

export interface ScanCandidate {
  path: string
  name: string
}

function hasProjectMarker(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.claude')) || fs.existsSync(path.join(dir, '.git'))
}

export function scanForCandidates(
  roots: string[],
  knownPaths: Set<string>,
  maxDepth = 6
): ScanCandidate[] {
  const candidates: ScanCandidate[] = []
  const seen = new Set<string>()

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

    if (hasProjectMarker(dir)) {
      if (!knownPaths.has(dir) && !seen.has(dir)) {
        seen.add(dir)
        candidates.push({ path: dir, name: path.basename(dir) })
      }
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIR_NAMES.has(entry.name)) {
        continue
      }
      walk(path.join(dir, entry.name), depth + 1)
    }
  }

  for (const root of roots) {
    walk(root, 0)
  }

  return candidates
}
