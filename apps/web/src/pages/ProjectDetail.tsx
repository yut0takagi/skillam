import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  applyRole,
  getProject,
  listApplyHistory,
  listProjectRoles,
  previewApply,
  setProjectRoles
} from '../api/projects.js'
import { listRoles } from '../api/roles.js'
import { useApi } from '../lib/useApi.js'
import { DiffView } from '../components/DiffView.js'
import type { ApiErrorKind } from '../api/client.js'
import type { ApplyPlan, ManagedState, MaterializeOperation, Role } from '../api/types.js'

const OP_LABEL: Record<MaterializeOperation['type'], string> = {
  'create-link': 'リンク作成',
  'write-file': 'ファイル書出',
  remove: '削除'
}

const OP_CLASS: Record<MaterializeOperation['type'], string> = {
  'create-link': 'op-link',
  'write-file': 'op-write',
  remove: 'op-remove'
}

function formatDate(value: string | null): string {
  if (!value) {
    return '-'
  }
  return new Date(value).toLocaleString('ja-JP')
}

function operationDetail(op: MaterializeOperation): string {
  if (op.type === 'create-link') {
    return `${op.path} → ${op.target}`
  }
  return op.path
}

function managedSummary(managed: ManagedState): string {
  const parts: string[] = []
  if (managed.mcpServers.length > 0) {
    parts.push(`MCP: ${managed.mcpServers.join(', ')}`)
  }
  if (managed.materialized.length > 0) {
    parts.push(`配置: ${managed.materialized.length}件`)
  }
  if (managed.permissionAllow.length > 0) {
    parts.push(`許可: ${managed.permissionAllow.length}件`)
  }
  return parts.length > 0 ? parts.join(' / ') : '管理対象なし'
}

export function ProjectDetail() {
  const params = useParams<{ id: string }>()
  const projectId = Number(params.id)

  const projectApi = useApi(useCallback(() => getProject(projectId), [projectId]))
  const rolesApi = useApi(useCallback(() => listRoles(), []))
  const projectRolesApi = useApi(useCallback(() => listProjectRoles(projectId), [projectId]))
  const historyApi = useApi(useCallback(() => listApplyHistory(projectId), [projectId]))

  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [plan, setPlan] = useState<ApplyPlan | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<{ kind: ApiErrorKind; message: string } | null>(null)

  const [applyLoading, setApplyLoading] = useState(false)
  const [applyResult, setApplyResult] = useState<
    | { kind: 'success' }
    | { kind: 'failure'; message: string }
    | { kind: 'conflict'; message: string }
    | null
  >(null)

  const roles = rolesApi.data ?? []
  const project = projectApi.data ?? null
  const history = historyApi.data ?? []

  const roleNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const role of roles) {
      map.set(role.id, role.name)
    }
    return map
  }, [roles])

  const assignedRoleId = projectRolesApi.data && projectRolesApi.data.length > 0 ? projectRolesApi.data[0].roleId : null
  const effectiveRoleId = selectedRoleId ?? assignedRoleId

  const latestSuccessManaged = useMemo(() => {
    const success = history.find((entry) => entry.status === 'success')
    return success ? success.managed : null
  }, [history])

  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
  }, [history])

  const handlePreview = useCallback(async () => {
    if (effectiveRoleId === null) {
      return
    }
    setPreviewLoading(true)
    setPreviewError(null)
    setPlan(null)
    setApplyResult(null)
    const result = await previewApply(projectId, effectiveRoleId)
    setPreviewLoading(false)
    if (!result.ok) {
      setPreviewError({ kind: result.kind, message: result.message })
      return
    }
    setPlan(result.data)
  }, [projectId, effectiveRoleId])

  const handleApply = useCallback(async () => {
    if (effectiveRoleId === null) {
      return
    }
    setApplyLoading(true)
    setApplyResult(null)
    const result = await applyRole(projectId, effectiveRoleId)
    setApplyLoading(false)
    if (!result.ok) {
      if (result.kind === 'conflict') {
        setApplyResult({ kind: 'conflict', message: result.message })
        setPlan(null)
        return
      }
      setApplyResult({ kind: 'failure', message: result.message })
      historyApi.reload()
      return
    }
    setApplyResult({ kind: 'success' })
    historyApi.reload()
    projectApi.reload()
  }, [projectId, effectiveRoleId, historyApi, projectApi])

  const handleSaveRole = useCallback(async () => {
    if (effectiveRoleId === null) {
      return
    }
    setSaving(true)
    setSaveError(null)
    const result = await setProjectRoles(projectId, [effectiveRoleId])
    setSaving(false)
    if (!result.ok) {
      setSaveError(result.message)
      return
    }
    projectRolesApi.reload()
  }, [projectId, effectiveRoleId, projectRolesApi])

  if (projectApi.loading && !project) {
    return (
      <div className="body">
        <p>読み込み中…</p>
      </div>
    )
  }

  if (projectApi.error && !project) {
    return (
      <div className="body">
        <p className="empty">{projectApi.error}</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="body">
        <p className="empty">プロジェクトが見つかりません。</p>
      </div>
    )
  }

  const hasAssignedRole = effectiveRoleId !== null
  const previewButtonDisabled = !hasAssignedRole || previewLoading
  const showApplyButton = plan !== null && previewError === null
  const applyButtonDisabled = applyLoading

  return (
    <>
      <div className="topbar">
        <p className="crumb">プロジェクト / {project.name}</p>
        <h1>{project.name}</h1>
        <p className="page-note">
          <code>{project.path}</code>
        </p>
        <div className="row" style={{ marginTop: 'var(--s3, 12px)' }}>
          <button type="button" className="btn" onClick={handlePreview} disabled={previewButtonDisabled}>
            プレビュー
          </button>
          {showApplyButton ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleApply}
              disabled={applyButtonDisabled}
            >
              適用する
            </button>
          ) : null}
        </div>
        {!hasAssignedRole ? (
          <p className="hint">プレビューを実行するには、先にロールを割り当ててください。</p>
        ) : null}
      </div>

      <div className="body split">
        <div className="main stack">
          {plan ? (
            <section>
              <div className="sec-head">
                <h2>適用プレビュー</h2>
              </div>
              <DiffView change={plan.settingsFile} />
              <DiffView change={plan.mcpFile} />
              <p className="hint">
                シークレットは <code>secret_ref:</code> のまま表示されます。実際の値は書き込み直前にのみ復号されます。
              </p>
            </section>
          ) : null}

          {plan ? (
            <section>
              <div className="sec-head">
                <h2>実行される操作</h2>
              </div>
              <div className="ops">
                {plan.operations.map((op, index) => (
                  <div className="op" key={index}>
                    <span className={`op-kind ${OP_CLASS[op.type]}`}>{OP_LABEL[op.type]}</span>
                    <span className="op-detail">{operationDetail(op)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {previewError ? (
            previewError.kind === 'conflict' ? (
              <div className="callout callout-danger">
                <p className="callout-title">プレビューできません</p>
                <p className="callout-body">{previewError.message}</p>
                <p className="callout-hint">ファイルは変更されていません。</p>
              </div>
            ) : (
              <div className="callout">
                <p className="callout-body">{previewError.message}</p>
              </div>
            )
          ) : null}

          {applyResult ? (
            applyResult.kind === 'success' ? (
              <div className="callout callout-ok">
                <p className="callout-body">適用しました</p>
              </div>
            ) : applyResult.kind === 'failure' ? (
              <div className="callout callout-warn">
                <p className="callout-body">{applyResult.message}</p>
                <p className="callout-hint">一部のファイルが書き込まれている可能性があります。</p>
              </div>
            ) : (
              <div className="callout callout-danger">
                <p className="callout-body">{applyResult.message}</p>
                <p className="callout-hint">ファイルは変更されていません。</p>
              </div>
            )
          ) : null}

          <section>
            <div className="sec-head">
              <h2>適用履歴</h2>
              <span className="sec-meta">{sortedHistory.length}件</span>
            </div>
            {sortedHistory.length === 0 ? (
              <p className="empty">適用履歴はまだありません。</p>
            ) : (
              <div className="hist">
                {sortedHistory.map((entry) => (
                  <div
                    className="hist-row"
                    data-testid="hist-row"
                    data-status={entry.status}
                    key={entry.id}
                  >
                    <span className={`hist-bar ${entry.status === 'success' ? 'hist-bar-ok' : 'hist-bar-fail'}`} />
                    <div className="hist-main">
                      <p className="hist-title">
                        {entry.roleId === null ? (
                          <span className="pill pill-mute">削除されたロール</span>
                        ) : (
                          roleNameById.get(entry.roleId) ?? `ロール #${entry.roleId}`
                        )}
                      </p>
                      <p className="hist-detail">{managedSummary(entry.managed)}</p>
                      {entry.status === 'failed' && entry.errorMessage ? (
                        <p className="hist-detail callout-warn">{entry.errorMessage}</p>
                      ) : null}
                    </div>
                    <span className="hist-time tnum">{formatDate(entry.appliedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="sidebar stack">
          <div className="panel">
            <div className="panel-head">割り当て</div>
            <div className="panel-body">
              <div className="field">
                <label htmlFor="role-select">ロール割り当て</label>
                <select
                  id="role-select"
                  aria-label="ロール割り当て"
                  value={effectiveRoleId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value
                    setSelectedRoleId(value === '' ? null : Number(value))
                  }}
                >
                  <option value="">未割り当て</option>
                  {roles.map((role: Role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn" onClick={handleSaveRole} disabled={saving || effectiveRoleId === null}>
                保存
              </button>
              {saveError ? <p className="hint">{saveError}</p> : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">このプロジェクト</div>
            <div className="panel-body">
              <dl className="kv">
                <dt>パス</dt>
                <dd>{project.path}</dd>
                <dt>最終適用</dt>
                <dd>{formatDate(project.lastAppliedAt)}</dd>
                <dt>適用ロール</dt>
                <dd>
                  {project.lastAppliedRoleId !== null
                    ? roleNameById.get(project.lastAppliedRoleId) ?? `ロール #${project.lastAppliedRoleId}`
                    : '-'}
                </dd>
                <dt>検出方法</dt>
                <dd>{project.autoDetected ? '自動検出' : '手動登録'}</dd>
              </dl>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">skillam が管理中</div>
            <div className="panel-body">
              {latestSuccessManaged ? (
                <>
                  <p className="hint">MCP サーバー</p>
                  {latestSuccessManaged.mcpServers.length === 0 ? (
                    <p className="hint">なし</p>
                  ) : (
                    <ul>
                      {latestSuccessManaged.mcpServers.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  )}
                  <p className="hint">配置済みパス</p>
                  {latestSuccessManaged.materialized.length === 0 ? (
                    <p className="hint">なし</p>
                  ) : (
                    <ul>
                      {latestSuccessManaged.materialized.map((path) => (
                        <li key={path}>
                          <code>{path}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="hint">許可された権限</p>
                  {latestSuccessManaged.permissionAllow.length === 0 ? (
                    <p className="hint">なし</p>
                  ) : (
                    <ul>
                      {latestSuccessManaged.permissionAllow.map((entry) => (
                        <li key={entry}>
                          <code>{entry}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="hint">まだ適用されていません。</p>
              )}
              <p className="hint">ここに載っていない項目は手動追加とみなし、適用で消しません。</p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
