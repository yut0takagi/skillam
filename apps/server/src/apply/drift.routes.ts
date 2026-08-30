import path from 'node:path'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { ProjectsRepository } from '../projects/projects.repository.js'
import type { Project } from '../projects/projects.types.js'
import type { ApplyHistoryRepository } from './apply-history.repository.js'
import { detectDrift, type DriftItem } from './detect-drift.js'
import { EMPTY_MANAGED_STATE } from './managed-state.js'
import {
  readFileOrNull,
  readJsonObject,
  readCurrentEntry,
  settingsPathFor,
  UnreadableConfigError
} from './project-state.js'
import type { CurrentEntry } from './plan-materialize.js'

export interface DriftRouteDeps {
  projects: ProjectsRepository
  history: ApplyHistoryRepository
}

export interface DriftReport {
  projectId: number
  projectPath: string
  hasDrift: boolean
  items: DriftItem[]
  lastAppliedAt: string | null
}

// Baseline choice: the last *successful* apply, not
// `listSinceLastSuccess`'s union. The planner unions everything since the
// last success so a retry can treat a failed attempt's partial writes as
// its own and overwrite them freely. Drift asks a different question: "did
// skillam's own record of what should be on disk get tampered with?" A
// failed attempt's managed state was never fully realized on disk — some of
// it may not have been written at all — so it is not a trustworthy
// definition of "what should be there". The last successful apply is the
// only point where "recorded" and "on disk" were known to agree at write
// time, which makes it the only sound baseline to diff the present against.
export function buildDriftReport(project: Project, deps: DriftRouteDeps): DriftReport {
  const lastSuccess = deps.history.lastSuccessful(project.id)

  if (!lastSuccess) {
    return {
      projectId: project.id,
      projectPath: project.path,
      hasDrift: false,
      items: [],
      lastAppliedAt: null
    }
  }

  const settingsPath = settingsPathFor(project.path)
  const mcpPath = path.join(project.path, '.mcp.json')

  const settings = readJsonObject(readFileOrNull(settingsPath), settingsPath)
  const mcpJson = readJsonObject(readFileOrNull(mcpPath), mcpPath)

  const current: Record<string, CurrentEntry> = {}
  for (const relativePath of lastSuccess.managed.materialized) {
    const entry = readCurrentEntry(project.path, relativePath)
    if (entry) {
      current[relativePath] = entry
    }
  }

  const result = detectDrift({
    managed: lastSuccess.managed,
    settings,
    mcpJson,
    current
  })

  return {
    projectId: project.id,
    projectPath: project.path,
    hasDrift: result.hasDrift,
    items: result.items,
    lastAppliedAt: lastSuccess.appliedAt
  }
}

function isUnreadableConfig(error: unknown): error is UnreadableConfigError {
  return error instanceof UnreadableConfigError
}

export const driftRoutes: FastifyPluginAsync<DriftRouteDeps> = async (app, deps) => {
  app.get<{ Params: { id: string } }>('/projects/:id/drift', async (request, reply: FastifyReply) => {
    const project = deps.projects.getById(Number(request.params.id))
    if (!project) {
      return reply.status(404).send({ error: 'project not found' })
    }
    try {
      return buildDriftReport(project, deps)
    } catch (error) {
      if (isUnreadableConfig(error)) {
        return reply.status(409).send({ error: error.message })
      }
      throw error
    }
  })

  app.get('/drift', async () => {
    const projects = deps.projects.list().filter((project) => !project.excluded)
    const reports: DriftReport[] = []
    for (const project of projects) {
      try {
        reports.push(buildDriftReport(project, deps))
      } catch (error) {
        if (!isUnreadableConfig(error)) {
          throw error
        }
        // Decision: include the project with an error marker rather than
        // silently skipping it. A skipped project just vanishes from the
        // dashboard with no trace, which looks identical to "nothing to
        // report" — exactly the kind of silent failure this whole feature
        // exists to prevent. Reporting it as `hasDrift: true` with a
        // synthetic item surfaces the broken config as something that
        // needs attention, without letting one broken project 409 the
        // entire list (which would make the dashboard useless the moment
        // any single project's settings.json got hand-edited into invalid
        // JSON).
        //
        // Kind: 'config-unreadable', not 'materialized-changed'. The latter
        // means "a symlink skillam created was replaced by something
        // else" — a completely different condition from "this JSON does
        // not parse". Borrowing an unrelated kind here would tell the user
        // the wrong diagnosis (and point them at the wrong fix), which is
        // the same mistake already avoided by not implementing
        // 'mcp-server-changed': do not express a state through a kind that
        // doesn't mean that state.
        //
        // Target: the offending file's path, not the project's path.
        // UnreadableConfigError already carries it (set at the two throw
        // sites in project-state.ts), and naming the exact file reads
        // better in CLI/dashboard output than repeating the project path
        // the caller already has in `projectPath`.
        reports.push({
          projectId: project.id,
          projectPath: project.path,
          hasDrift: true,
          items: [
            {
              kind: 'config-unreadable',
              target: error.filePath ?? project.path,
              detail: error.message
            }
          ],
          lastAppliedAt: deps.history.lastSuccessful(project.id)?.appliedAt ?? null
        })
      }
    }
    return reports
  })
}
