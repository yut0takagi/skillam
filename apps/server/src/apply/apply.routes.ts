import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { ProjectsRepository } from '../projects/projects.repository.js'
import type { RolesRepository } from '../roles/roles.repository.js'
import { buildApplyPlan, type ApplyPlan, type ApplyPlannerDeps } from './apply-planner.js'
import { executeApplyPlan, type ApplyExecutorDeps } from './apply-executor.js'
import type { ApplyHistoryRepository } from './apply-history.repository.js'
import { MaterializeConflictError } from './plan-materialize.js'
import { UnsupportedSettingsError } from './plan-settings.js'

export interface ApplyRouteDeps extends ApplyPlannerDeps, ApplyExecutorDeps {
  projects: ProjectsRepository
  roles: RolesRepository
  history: ApplyHistoryRepository
}

function readRoleId(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }
  const roleId = (body as { roleId?: unknown }).roleId
  return typeof roleId === 'number' ? roleId : undefined
}

function isPlanConflict(error: unknown): error is Error {
  return error instanceof MaterializeConflictError || error instanceof UnsupportedSettingsError
}

function planOrConflict(
  deps: ApplyRouteDeps,
  project: Parameters<typeof buildApplyPlan>[1],
  roleId: number,
  reply: FastifyReply
): ApplyPlan | undefined {
  try {
    return buildApplyPlan(deps, project, roleId)
  } catch (error) {
    if (isPlanConflict(error)) {
      reply.status(409).send({ error: error.message })
      return undefined
    }
    throw error
  }
}

export const applyRoutes: FastifyPluginAsync<ApplyRouteDeps> = async (app, deps) => {
  app.post<{ Params: { id: string }; Body: { roleId: number } }>(
    '/projects/:id/apply/preview',
    async (request, reply) => {
      const roleId = readRoleId(request.body)
      if (roleId === undefined) {
        return reply.status(400).send({ error: 'roleId is required' })
      }
      const project = deps.projects.getById(Number(request.params.id))
      if (!project) {
        return reply.status(404).send({ error: 'project not found' })
      }
      if (!deps.roles.getById(roleId)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      const plan = planOrConflict(deps, project, roleId, reply)
      if (!plan) {
        return reply
      }
      return plan
    }
  )

  app.post<{ Params: { id: string }; Body: { roleId: number } }>(
    '/projects/:id/apply',
    async (request, reply) => {
      const roleId = readRoleId(request.body)
      if (roleId === undefined) {
        return reply.status(400).send({ error: 'roleId is required' })
      }
      const project = deps.projects.getById(Number(request.params.id))
      if (!project) {
        return reply.status(404).send({ error: 'project not found' })
      }
      if (!deps.roles.getById(roleId)) {
        return reply.status(404).send({ error: 'role not found' })
      }

      const plan = planOrConflict(deps, project, roleId, reply)
      if (!plan) {
        return reply
      }

      const diff = {
        settingsFile: plan.settingsFile,
        mcpFile: plan.mcpFile,
        operations: plan.operations
      }

      try {
        executeApplyPlan(plan, deps)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const entry = deps.history.record({
          projectId: project.id,
          roleId,
          diff,
          managed: plan.managed,
          status: 'failed',
          errorMessage: message
        })
        return reply.status(500).send({ error: message, historyId: entry.id })
      }

      try {
        const entry = deps.history.record({
          projectId: project.id,
          roleId,
          diff,
          managed: plan.managed,
          status: 'success'
        })
        deps.projects.markApplied(project.id, roleId)
        return { status: 'success', historyId: entry.id, plan }
      } catch (error) {
        // The apply itself already succeeded on disk by this point; only
        // recording it failed. There is no rollback, so disk and history
        // have now diverged — say so plainly rather than returning a
        // generic 500, and surface the underlying error since nothing else
        // will.
        const message = error instanceof Error ? error.message : String(error)
        request.log.error(error, 'failed to record a successful apply')
        return reply
          .status(500)
          .send({ error: `適用はファイルに書き込まれましたが、履歴の記録に失敗しました: ${message}` })
      }
    }
  )

  app.get<{ Params: { id: string } }>('/projects/:id/apply-history', async (request, reply) => {
    const projectId = Number(request.params.id)
    if (!deps.projects.getById(projectId)) {
      return reply.status(404).send({ error: 'project not found' })
    }
    return deps.history.listForProject(projectId)
  })
}
