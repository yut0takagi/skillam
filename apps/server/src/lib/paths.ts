import path from 'node:path'

export function normalizePath(inputPath: string): string {
  return path.normalize(inputPath).replace(/\/+$/, '') || '/'
}
