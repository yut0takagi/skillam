import path from 'node:path'

export function normalizePath(inputPath: string): string {
  return path.normalize(inputPath).replace(/\/+$/, '') || '/'
}

// Whether candidate is root itself or sits underneath it.
//
// Deliberately not a startsWith on the raw strings: '/Users/me/workspace'
// starts with '/Users/me/work', so a scope bound to ~/work would silently
// capture every project under ~/workspace. Comparing with the separator
// appended keeps the match on directory boundaries.
export function isPathWithin(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizePath(candidate)
  const normalizedRoot = normalizePath(root)
  if (normalizedCandidate === normalizedRoot) {
    return true
  }
  // normalizePath collapses '/' to itself, so appending path.sep would ask for
  // '//'. Everything is under the filesystem root.
  if (normalizedRoot === '/') {
    return true
  }
  return normalizedCandidate.startsWith(normalizedRoot + path.sep)
}
