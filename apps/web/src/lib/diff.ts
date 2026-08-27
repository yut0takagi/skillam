export type DiffLineKind = 'context' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

function toLines(value: string | null): string[] {
  if (value === null || value === '') {
    return []
  }
  const withoutTrailingNewline = value.endsWith('\n') ? value.slice(0, -1) : value
  return withoutTrailingNewline.split('\n')
}

// Deliberately naive: this compares by line index rather than computing a
// longest-common-subsequence, so inserting a single line makes every
// subsequent line show up as a removed+added pair instead of a clean
// insertion. skillam only ever diffs JSON.stringify(value, null, 2)
// formatted config files (.claude/settings.json, .mcp.json) where the
// changed region is a handful of lines, so this is adequate. Do not
// upgrade to LCS speculatively -- only if real usage shows the display
// is unreadable.
export function diffLines(before: string | null, after: string): DiffLine[] {
  const beforeLines = toLines(before)
  const afterLines = toLines(after)
  const result: DiffLine[] = []

  const max = Math.max(beforeLines.length, afterLines.length)
  for (let index = 0; index < max; index += 1) {
    const beforeLine = beforeLines[index]
    const afterLine = afterLines[index]

    if (beforeLine !== undefined && afterLine !== undefined && beforeLine === afterLine) {
      result.push({ kind: 'context', text: beforeLine })
      continue
    }
    if (beforeLine !== undefined) {
      result.push({ kind: 'removed', text: beforeLine })
    }
    if (afterLine !== undefined) {
      result.push({ kind: 'added', text: afterLine })
    }
  }

  return result
}
