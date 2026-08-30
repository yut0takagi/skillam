import { execFileSync } from 'node:child_process'

// Paths that git already tracks must not be written by skillam: a symlink
// pointing into this machine's ~/.skillam store, or a merge into a shared
// settings.json, becomes a commit that breaks every other clone. skillam
// refuses instead of guessing, which is the same contract project-state.ts
// applies to unparseable config.
//
// Outside a git repository this returns an empty list rather than throwing.
// Failing closed there would block applies to every non-git project, which
// is a far larger blast radius than the leak this guard exists to prevent.
export function listTrackedPaths(projectPath: string): string[] {
  let stdout: string
  try {
    stdout = execFileSync('git', ['ls-files', '-z', '--', '.claude', '.mcp.json'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    // Not a repository, or git is unavailable. Either way there is nothing
    // git can leak, so there is nothing to guard against.
    return []
  }
  return stdout.split('\0').filter((entry) => entry.length > 0)
}

// A materialized skill is a directory symlink, so git tracks paths *beneath*
// it rather than the link path itself. Matching only on equality would let a
// tracked skills/<name>/SKILL.md slip through, so descendants count as tracked
// too. The separator is required in the prefix test to keep "settings.json"
// from matching "settings.local.json".
export function isTracked(trackedPaths: string[], relativePath: string): boolean {
  return trackedPaths.some(
    (tracked) => tracked === relativePath || tracked.startsWith(`${relativePath}/`)
  )
}

// Thrown when a destination skillam would write is already tracked by git.
// Distinct from MaterializeConflictError: nothing is wrong with the file on
// disk, the problem is that writing it would publish machine-local paths to
// every other clone of a shared repository.
export class GitTrackedTargetError extends Error {
  readonly trackedPaths: string[]

  constructor(trackedPaths: string[]) {
    super(
      `git が追跡しているパスへの書き込みを中止しました: ${trackedPaths.join(', ')}。` +
        'skillam が張るリンクはこのマシンのパスを指すため、コミットすると他の clone で壊れます。' +
        'git の管理から外す（.gitignore に追加して git rm --cached する）か、ロールから外してください。'
    )
    this.name = 'GitTrackedTargetError'
    this.trackedPaths = trackedPaths
  }
}
