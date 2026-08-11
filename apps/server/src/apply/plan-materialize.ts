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

export type CurrentEntry = { kind: 'link'; target: string } | { kind: 'file'; content: string }

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

export function planMaterialize(input: PlanMaterializeInput): PlanMaterializeResult {
  const desiredPaths = input.desired.map((entry) => entry.path)
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
