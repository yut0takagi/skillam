import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { ProjectsRepository } from '../projects/projects.repository.js'
import type { RolesRepository } from '../roles/roles.repository.js'
import {
  buildApplyPlanForRoles,
  type ApplyPlan,
  type ApplyPlannerDeps,
  type RoleBindingRef
} from './apply-planner.js'
import { RoleCompositionConflictError } from './compose-roles.js'
import type { ProjectRolesRepository } from '../projects/project-roles.repository.js'
import { executeApplyPlan, type ApplyExecutorDeps } from './apply-executor.js'
import type { ApplyHistoryRepository } from './apply-history.repository.js'
import { MaterializeConflictError } from './plan-materialize.js'
import { UnsupportedSettingsError } from './plan-settings.js'

export interface ApplyRouteDeps extends ApplyPlannerDeps, ApplyExecutorDeps {
  projects: ProjectsRepository
  roles: RolesRepository
  projectRoles: ProjectRolesRepository
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
  return (
    error instanceof MaterializeConflictError ||
    error instanceof UnsupportedSettingsError ||
    // Two bindings disagreeing is the same class of problem as a destination
    // clash: the request is well-formed, but the state it describes cannot be
    // applied without a person choosing. 409, not 500.
    error instanceof RoleCompositionConflictError
  )
}

// An explicit roleId applies just that role — this is how the UI previews a
// role before binding it. Without one, the project's own bindings are used,
// which is what an unattended apply (the CLI, a re-apply) should follow.
function resolveBindings(deps: ApplyRouteDeps, projectId: number, roleId: number | undefined): RoleBindingRef[] {
  if (roleId !== undefined) {
    return [{ roleId, origin: { kind: 'direct' }, priority: 0 }]
  }
  return deps.projectRoles
    .listForProject(projectId)
    .map((bound) => ({ roleId: bound.roleId, origin: { kind: 'direct' as const }, priority: bound.priority }))
}

function planOrConflict(
  deps: ApplyRouteDeps,
  project: Parameters<typeof buildApplyPlanForRoles>[1],
  bindings: RoleBindingRef[],
  reply: FastifyReply
): ApplyPlan | undefined {
  try {
    return buildApplyPlanForRoles(deps, project, bindings)
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
      const project = deps.projects.getById(Number(request.params.id))
      if (!project) {
        return reply.status(404).send({ error: 'project not found' })
      }
      const roleId = readRoleId(request.body)
      if (roleId !== undefined && !deps.roles.getById(roleId)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      const bindings = resolveBindings(deps, project.id, roleId)
      if (bindings.length === 0) {
        return reply
          .status(400)
          .send({ error: 'roleId is required（プロジェクトにロールが割り当てられていません）' })
      }
      const plan = planOrConflict(deps, project, bindings, reply)
      if (!plan) {
        return reply
      }
      return plan
    }
  )

  app.post<{ Params: { id: string }; Body: { roleId: number } }>(
    '/projects/:id/apply',
    async (request, reply) => {
      const project = deps.projects.getById(Number(request.params.id))
      if (!project) {
        return reply.status(404).send({ error: 'project not found' })
      }
      const roleId = readRoleId(request.body)
      if (roleId !== undefined && !deps.roles.getById(roleId)) {
        return reply.status(404).send({ error: 'role not found' })
      }
      const bindings = resolveBindings(deps, project.id, roleId)
      if (bindings.length === 0) {
        return reply
          .status(400)
          .send({ error: 'roleId is required（プロジェクトにロールが割り当てられていません）' })
      }

      const plan = planOrConflict(deps, project, bindings, reply)
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
        try {
          const entry = deps.history.record({
            projectId: project.id,
            roleId: plan.roleId,
            diff,
            managed: plan.managed,
            status: 'failed',
            errorMessage: message
          })
          return reply.status(500).send({ error: message, historyId: entry.id })
        } catch (recordError) {
          // The apply already failed and may have written partial state;
          // now recording that failure has ALSO failed, so there is no
          // history row either. Disk and history have diverged with no
          // trace of why — surface both error messages since nothing else
          // will.
          const recordMessage = recordError instanceof Error ? recordError.message : String(recordError)
          request.log.error(recordError, 'failed to record a failed apply')
          return reply.status(500).send({
            error: `適用に失敗し、その記録も残せませんでした: ${message} / ${recordMessage}`
          })
        }
      }

      try {
        const entry = deps.history.record({
          projectId: project.id,
          roleId: plan.roleId,
          diff,
          managed: plan.managed,
          status: 'success'
        })
        // projects.last_applied_role_id names one role. A composed apply has
        // none, so the marker is left alone rather than pointing at an
        // arbitrary member of the set.
        if (plan.roleId !== null) {
          deps.projects.markApplied(project.id, plan.roleId)
        }
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
