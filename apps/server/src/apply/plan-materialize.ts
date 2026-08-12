import { staleEntries } from './managed-state.js'

export interface DesiredLink {
  kind: 'link'
  path: string
  target: string
}

export interface DesiredFile {
  kind: 'file'
  path: string
  content: string
}

export type DesiredEntry = DesiredLink | DesiredFile

export type CurrentEntry =
  | { kind: 'link'; target: string }
  | { kind: 'file'; content: string }
  | { kind: 'other' }

export type MaterializeOperation =
  | { type: 'create-link'; path: string; target: string }
  | { type: 'write-file'; path: string; content: string }
  | { type: 'remove'; path: string }

export interface PlanMaterializeInput {
  desired: DesiredEntry[]
  current: Record<string, CurrentEntry>
  previouslyManaged: string[]
}

export interface PlanMaterializeResult {
  operations: MaterializeOperation[]
  managed: string[]
}

export class MaterializeConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaterializeConflictError'
  }
}

function matchesDesired(current: CurrentEntry | undefined, entry: DesiredEntry): boolean {
  if (!current) {
    return false
  }
  if (entry.kind === 'link') {
    return current.kind === 'link' && current.target === entry.target
  }
  return current.kind === 'file' && current.content === entry.content
}

export function planMaterialize(input: PlanMaterializeInput): PlanMaterializeResult {
  const desiredPaths = input.desired.map((entry) => entry.path)

  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const desiredPath of desiredPaths) {
    if (seen.has(desiredPath)) {
      duplicates.add(desiredPath)
    }
    seen.add(desiredPath)
  }
  if (duplicates.size > 0) {
    throw new MaterializeConflictError(
      `同じ配置先に複数の項目が割り当てられています: ${[...duplicates].join(', ')}。ロールの内容を見直してください。`
    )
  }

  const conflicts: string[] = []
  for (const entry of input.desired) {
    const current = input.current[entry.path]
    if (current && !input.previouslyManaged.includes(entry.path) && !matchesDesired(current, entry)) {
      conflicts.push(entry.path)
    }
  }
  if (conflicts.length > 0) {
    throw new MaterializeConflictError(
      `skillam が作成していないファイル/ディレクトリが適用先にあります: ${conflicts.join(', ')}。上書きを避けるため適用を中止しました。手動で退避または削除してから再実行してください。`
    )
  }

  const operations: MaterializeOperation[] = []

  for (const path of staleEntries(input.previouslyManaged, desiredPaths)) {
    operations.push({ type: 'remove', path })
  }

  for (const entry of input.desired) {
    const current = input.current[entry.path]
    if (entry.kind === 'link') {
      if (current?.kind === 'link' && current.target === entry.target) {
        continue
      }
      operations.push({ type: 'create-link', path: entry.path, target: entry.target })
      continue
    }
    if (current?.kind === 'file' && current.content === entry.content) {
      continue
    }
    operations.push({ type: 'write-file', path: entry.path, content: entry.content })
  }

  return { operations, managed: desiredPaths }
}
