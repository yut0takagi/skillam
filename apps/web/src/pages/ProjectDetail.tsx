import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  applyRole,
  getProject,
  getProjectDrift,
  listApplyHistory,
  listProjectGroups,
  listProjectRoles,
  previewApply,
  setProjectGroups,
  setProjectRoles
} from '../api/projects.js'
import { listRoles } from '../api/roles.js'
import { listGroups } from '../api/groups.js'
import { useApi } from '../lib/useApi.js'
import { DiffView } from '../components/DiffView.js'
import type { ApiErrorKind } from '../api/client.js'
import type {
  ApplyPlan,
  BindingOrigin,
  Group,
  ManagedState,
  MaterializeOperation,
  PlanOrigin,
  Role
} from '../api/types.js'

const DRIFT_KIND_LABEL: Record<string, string> = {
  'permission-missing': '権限の欠落',
  'mcp-server-missing': 'MCPサーバーの欠落',
  'mcp-server-changed': 'MCPサーバー定義の変更',
  'materialized-missing': '配置ファイルの欠落',
  'materialized-changed': '配置ファイルの変更',
  'config-unreadable': '設定ファイルが読めません'
}

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

// The preview is the only place someone can see why an item is present. With
// three binding paths, an unexplained entry is the difference between a tool
// someone chose and one that arrived because of where the directory sits.
function originLabel(origin: BindingOrigin): string {
  switch (origin.kind) {
    case 'scope':
      return `スコープ ${origin.path}`
    case 'group':
      return `グループ ${origin.name}`
    case 'direct':
      return '直接'
  }
}

function originClass(origin: BindingOrigin): string {
  return `origin-${origin.kind}`
}

const ORIGIN_KIND_LABEL: Record<PlanOrigin['kind'], string> = {
  skill: 'Skill',
  agent: 'Agent',
  mcpServer: 'MCP'
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
  const driftApi = useApi(useCallback(() => getProjectDrift(projectId), [projectId]))
  const projectGroupsApi = useApi(useCallback(() => listProjectGroups(projectId), [projectId]))
  const groupsApi = useApi(useCallback(() => listGroups(), []))

  const [checkedRoleIds, setCheckedRoleIds] = useState<number[]>([])
  const [checkedGroupIds, setCheckedGroupIds] = useState<number[]>([])
  const [groupSaveError, setGroupSaveError] = useState<string | null>(null)
  const [groupSaving, setGroupSaving] = useState(false)
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
  // Defensive: a non-array here (an error body shaped differently than
  // expected) would otherwise throw during render and blank the whole page,
  // hiding the preview and history along with it.
  const projectGroups = Array.isArray(projectGroupsApi.data) ? projectGroupsApi.data : []
  const allGroups = Array.isArray(groupsApi.data) ? groupsApi.data : []

  const roleNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const role of roles) {
      map.set(role.id, role.name)
    }
    return map
  }, [roles])

  const assignedRoles = useMemo(() => {
    const entries = projectRolesApi.data ?? []
    return [...entries].sort((a, b) => a.priority - b.priority)
  }, [projectRolesApi.data])

  const assignedRoleIds = useMemo(() => assignedRoles.map((entry) => entry.roleId), [assignedRoles])

  useEffect(() => {
    setCheckedRoleIds(assignedRoleIds)
  }, [assignedRoleIds])

  // Keyed on the API result rather than the derived array: projectGroups is
  // rebuilt on every render, so depending on it directly would reset the
  // checkboxes mid-edit.
  const memberGroupIds = useMemo(
    () => (Array.isArray(projectGroupsApi.data) ? projectGroupsApi.data.map((group) => group.id) : []),
    [projectGroupsApi.data]
  )

  useEffect(() => {
    setCheckedGroupIds(memberGroupIds)
  }, [memberGroupIds])

  const latestSuccessManaged = useMemo(() => {
    const success = history.find((entry) => entry.status === 'success')
    return success ? success.managed : null
  }, [history])

  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
  }, [history])

  const handlePreview = useCallback(async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    setPlan(null)
    setApplyResult(null)
    const result = await previewApply(projectId)
    setPreviewLoading(false)
    if (!result.ok) {
      setPreviewError({ kind: result.kind, message: result.message })
      return
    }
    setPlan(result.data)
  }, [projectId])

  const handleApply = useCallback(async () => {
    setApplyLoading(true)
    setApplyResult(null)
    const result = await applyRole(projectId)
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
  }, [projectId, historyApi, projectApi])

  const handleToggleRole = useCallback((roleId: number) => {
    setCheckedRoleIds((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId]
    )
  }, [])

  const handleSaveRole = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    const result = await setProjectRoles(projectId, checkedRoleIds)
    setSaving(false)
    if (!result.ok) {
      setSaveError(result.message)
      return
    }
    projectRolesApi.reload()
  }, [projectId, checkedRoleIds, projectRolesApi])

  const handleToggleGroup = useCallback((groupId: number) => {
    setCheckedGroupIds((current) =>
      current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]
    )
  }, [])

  const handleSaveGroups = useCallback(async () => {
    setGroupSaving(true)
    setGroupSaveError(null)
    const result = await setProjectGroups(projectId, checkedGroupIds)
    setGroupSaving(false)
    if (!result.ok) {
      setGroupSaveError(result.message)
      return
    }
    projectGroupsApi.reload()
  }, [projectId, checkedGroupIds, projectGroupsApi])

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

  // Preview is always available: scope bindings match by path and are not
  // visible from here, so the client cannot tell whether anything will reach
  // the project. The server answers that — a 400 means nothing is bound.
  const previewButtonDisabled = previewLoading
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
        <div className="field" style={{ marginTop: 'var(--s3, 12px)' }}>
          <p className="field-label">適用対象</p>
          {assignedRoleIds.length === 0 && projectGroups.length === 0 ? (
            <p className="hint">このプロジェクトに届くロールはありません。</p>
          ) : (
            <ul className="binding-list">
              {projectGroups.map((group) => (
                <li key={`group-${group.id}`}>
                  <span className="origin-tag origin-group">グループ</span>
                  <span>{group.name}</span>
                </li>
              ))}
              {assignedRoleIds.map((roleId) => (
                <li key={`direct-${roleId}`}>
                  <span className="origin-tag origin-direct">直接</span>
                  <span>{roleNameById.get(roleId) ?? `ロール #${roleId}`}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            スコープ（パス一致）で届くロールもあります。実際に何が入るかはプレビューで確認してください。
          </p>
        </div>
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

          {plan && plan.origins && plan.origins.length > 0 ? (
            <section>
              <div className="sec-head">
                <h2>出どころ</h2>
              </div>
              <div className="origins">
                {plan.origins.map((entry, index) => (
                  <div className="origin-row" key={`${entry.kind}-${entry.name}-${index}`}>
                    <span className="origin-kind">{ORIGIN_KIND_LABEL[entry.kind]}</span>
                    <span className="origin-name">{entry.name}</span>
                    <span className={`origin-tag ${originClass(entry.origin)}`}>
                      {originLabel(entry.origin)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {plan && plan.suppressedAllow && plan.suppressedAllow.length > 0 ? (
            <section>
              <div className="sec-head">
                <h2>deny で落ちた許可</h2>
              </div>
              <div className="origins">
                {plan.suppressedAllow.map((entry, index) => (
                  <div className="origin-row" key={`${entry.entry}-${index}`}>
                    <span className="origin-kind">許可</span>
                    <span className="origin-name">{entry.entry}</span>
                    <span className={`origin-tag ${originClass(entry.deniedBy)}`}>
                      {originLabel(entry.deniedBy)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="hint">
                これらは allow に含まれていましたが、上記のバインディングの deny によって除外されました。
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
              <h2>ドリフト</h2>
            </div>
            {driftApi.error ? (
              <p className="empty">{driftApi.error}</p>
            ) : driftApi.data && driftApi.data.hasDrift ? (
              <div className="hist">
                {driftApi.data.items.map((item, index) => (
                  <div className="hist-row" data-testid="drift-row" key={index}>
                    <span className="hist-bar hist-bar-fail" />
                    <div className="hist-main">
                      <p className="hist-title">{DRIFT_KIND_LABEL[item.kind] ?? item.kind}</p>
                      <p className="hist-detail">{item.target}</p>
                      <p className="hist-detail">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">ズレは検出されていません。</p>
            )}
          </section>

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
              <div className="checklist">
                {roles.map((role: Role) => (
                  <label className="check" key={role.id}>
                    <input
                      type="checkbox"
                      checked={checkedRoleIds.includes(role.id)}
                      onChange={() => handleToggleRole(role.id)}
                      aria-label={role.name}
                    />
                    <span className="check-main">
                      <span className="check-name">{role.name}</span>
                      {role.description ? <span className="check-desc">{role.description}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
              <button type="button" className="btn" onClick={handleSaveRole} disabled={saving}>
                保存
              </button>
              {saveError ? <p className="hint">{saveError}</p> : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">グループ</div>
            <div className="panel-body">
              {allGroups.length === 0 ? (
                <p className="hint">グループがまだありません。</p>
              ) : (
                <>
                  <div className="checklist">
                    {allGroups.map((group: Group) => (
                      <label className="check" key={group.id}>
                        <input
                          type="checkbox"
                          checked={checkedGroupIds.includes(group.id)}
                          onChange={() => handleToggleGroup(group.id)}
                          aria-label={group.name}
                        />
                        <span className="check-main">
                          <span className="check-name">{group.name}</span>
                          {group.description ? (
                            <span className="check-desc">{group.description}</span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                  <button type="button" className="btn" onClick={handleSaveGroups} disabled={groupSaving}>
                    グループを保存
                  </button>
                </>
              )}
              {groupSaveError ? <p className="hint">{groupSaveError}</p> : null}
              <p className="hint">所属するグループが配るロールは、適用時に合成されます。</p>
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
