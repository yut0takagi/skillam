import fs from 'node:fs'
import path from 'node:path'
import type { CurrentEntry } from './plan-materialize.js'

// Thrown when a project's on-disk config cannot be safely interpreted: the
// file is not valid JSON, or its top-level value is not an object. Used both
// while planning an apply (skillam must not overwrite a file it cannot
// parse) and while detecting drift (skillam must not guess at a file it
// cannot parse). One error class for one condition, so every caller —
// planning or read-only — can catch it the same way.
export class UnreadableConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnreadableConfigError'
  }
}

export function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

export function readJsonObject(raw: string | null, filePath: string): Record<string, unknown> {
  if (raw === null) {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new UnreadableConfigError(
      `${filePath} が JSON として読めません。skillam は解釈できないファイルを上書きしません。`
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UnreadableConfigError(
      `${filePath} の中身がオブジェクトではありません。skillam は解釈できないファイルを上書きしません。`
    )
  }
  return parsed as Record<string, unknown>
}

export function readCurrentEntry(projectPath: string, relativePath: string): CurrentEntry | undefined {
  const absolutePath = path.join(projectPath, relativePath)
  let stats: fs.Stats
  try {
    stats = fs.lstatSync(absolutePath)
  } catch {
    return undefined
  }
  if (stats.isSymbolicLink()) {
    return { kind: 'link', target: fs.readlinkSync(absolutePath) }
  }
  if (stats.isFile()) {
    return { kind: 'file', content: fs.readFileSync(absolutePath, 'utf-8') }
  }
  return { kind: 'other' }
}
