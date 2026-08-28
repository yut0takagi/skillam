#!/usr/bin/env node
import fs from 'node:fs'
import { openDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { ProjectsRepository } from './projects/projects.repository.js'
import { ApplyHistoryRepository } from './apply/apply-history.repository.js'
import { buildDriftReport, type DriftReport } from './apply/drift.routes.js'
import { UnreadableConfigError } from './apply/project-state.js'
import { normalizePath } from './lib/paths.js'
import type { Project } from './projects/projects.types.js'

export interface CheckResult {
  code: 0 | 1 | 2
  output: string
}

interface ParsedArgs {
  jsonOutput: boolean
  targetPath?: string
}

class UsageError extends Error {}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv[0] !== 'check') {
    throw new UsageError(`不明なコマンドです: ${argv[0] ?? '(なし)'}。使い方: skillam check [path] [--json]`)
  }

  let jsonOutput = false
  let targetPath: string | undefined

  for (const arg of argv.slice(1)) {
    if (arg === '--json') {
      jsonOutput = true
      continue
    }
    if (arg.startsWith('-')) {
      throw new UsageError(`不明なオプションです: ${arg}`)
    }
    if (targetPath !== undefined) {
      throw new UsageError(`余分な引数です: ${arg}`)
    }
    targetPath = arg
  }

  return { jsonOutput, targetPath }
}

function formatHuman(reports: DriftReport[]): string {
  if (reports.length === 0) {
    return '登録されたプロジェクトがありません。'
  }

  const lines: string[] = []
  for (const report of reports) {
    if (!report.hasDrift) {
      lines.push(`OK   ${report.projectPath}`)
      continue
    }
    lines.push(`DRIFT ${report.projectPath}`)
    for (const item of report.items) {
      lines.push(`  - [${item.kind}] ${item.target}: ${item.detail}`)
    }
  }
  return lines.join('\n')
}

function selectProjects(projects: ProjectsRepository, targetPath: string | undefined): Project[] | undefined {
  if (targetPath === undefined) {
    return projects.list().filter((project) => !project.excluded)
  }
  const normalized = normalizePath(targetPath)
  const match = projects.list().find((project) => project.path === normalized)
  return match ? [match] : undefined
}

export async function runCheck(argv: string[], options?: { dbPath?: string }): Promise<CheckResult> {
  let args: ParsedArgs
  try {
    args = parseArgs(argv)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { code: 2, output: message }
  }

  const dbPath = options?.dbPath ?? process.env.SKILLAM_DB_PATH
  if (!dbPath) {
    return { code: 2, output: 'データベースの場所が指定されていません（SKILLAM_DB_PATH を設定してください）。' }
  }
  if (dbPath !== ':memory:' && !fs.existsSync(dbPath)) {
    return { code: 2, output: `データベースが見つかりません: ${dbPath}` }
  }

  const db = openDb(dbPath)
  try {
    runMigrations(db)
    const projects = new ProjectsRepository(db)
    const history = new ApplyHistoryRepository(db)

    const targets = selectProjects(projects, args.targetPath)
    if (targets === undefined) {
      return { code: 2, output: `プロジェクトが登録されていません: ${args.targetPath}` }
    }

    const reports: DriftReport[] = []
    for (const project of targets) {
      try {
        reports.push(buildDriftReport(project, { projects, history }))
      } catch (error) {
        if (error instanceof UnreadableConfigError) {
          return { code: 2, output: error.message }
        }
        throw error
      }
    }

    const hasDrift = reports.some((report) => report.hasDrift)
    const output = args.jsonOutput ? JSON.stringify(reports, null, 2) : formatHuman(reports)
    return { code: hasDrift ? 1 : 0, output }
  } finally {
    db.close()
  }
}

async function main(): Promise<void> {
  const result = await runCheck(process.argv.slice(2))
  console.log(result.output)
  process.exit(result.code)
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main().catch((error) => {
    console.error(error)
    process.exit(2)
  })
}
