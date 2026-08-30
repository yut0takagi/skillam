import { useCallback, useState } from 'react'
import { createScope, deleteScope, listScopes, listScopeRoles, setScopeRoles } from '../api/scopes.js'
import { listRoles } from '../api/roles.js'
import { useApi } from '../lib/useApi.js'
import { ConfirmDialog } from '../components/ConfirmDialog.js'
import type { Scope, ScopeRole } from '../api/types.js'

export function Scopes() {
  const { data: scopes, error, loading, reload } = useApi(listScopes)
  const rolesApi = useApi(useCallback(() => listRoles(), []))

  const [creating, setCreating] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Scope | null>(null)

  const [openScopeId, setOpenScopeId] = useState<number | null>(null)
  const [openRoleIds, setOpenRoleIds] = useState<number[]>([])
  const [rolesError, setRolesError] = useState<string | null>(null)
  const [savingRoles, setSavingRoles] = useState(false)

  const roles = rolesApi.data ?? []

  async function handleCreate() {
    setCreateError(null)
    if (newPath.trim() === '') {
      setCreateError('パスを入力してください。')
      return
    }
    const result = await createScope(newPath.trim())
    if (!result.ok) {
      setCreateError(result.message)
      return
    }
    setCreating(false)
    setNewPath('')
    reload()
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) {
      return
    }
    await deleteScope(pendingDelete.id)
    setPendingDelete(null)
    if (openScopeId === pendingDelete.id) {
      setOpenScopeId(null)
    }
    reload()
  }

  async function handleOpenRoles(scope: Scope) {
    if (openScopeId === scope.id) {
      setOpenScopeId(null)
      return
    }
    setRolesError(null)
    const result = await listScopeRoles(scope.id)
    if (!result.ok) {
      setRolesError(result.message)
      return
    }
    setOpenScopeId(scope.id)
    setOpenRoleIds(result.data.map((bound: ScopeRole) => bound.roleId))
  }

  function toggleRole(roleId: number) {
    setOpenRoleIds((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId]
    )
  }

  async function handleSaveRoles() {
    if (openScopeId === null) {
      return
    }
    setSavingRoles(true)
    setRolesError(null)
    const result = await setScopeRoles(openScopeId, openRoleIds)
    setSavingRoles(false)
    if (!result.ok) {
      setRolesError(result.message)
      return
    }
    setOpenScopeId(null)
  }

  return (
    <>
      <div className="topbar">
        <p className="crumb">Scopes</p>
        <h1>スコープ</h1>
        <p className="page-note">
          パスの前方一致でロールを配ります。配下にプロジェクトを置くだけでロールが降りてくるため、
          「この階層より下は社内規約」のような決まりに使います。
        </p>
      </div>
      <div className="body">
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s2)' }}>
          {creating ? (
            <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="/Users/you/work"
                aria-label="スコープのパス"
                autoFocus
              />
              <button type="button" className="btn btn-primary" onClick={handleCreate}>
                作成
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setCreating(false)
                  setNewPath('')
                  setCreateError(null)
                }}
              >
                やめる
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              新規スコープ
            </button>
          )}
        </div>
        {createError && <p style={{ color: 'var(--danger)' }}>{createError}</p>}

        {loading && <p>読み込み中...</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        {scopes && scopes.length === 0 && <p className="hint">スコープはまだありません。</p>}

        {scopes && scopes.length > 0 && (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>パス</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {scopes.map((scope) => (
                  <tr key={scope.id}>
                    <td className="cell-name">
                      <code>{scope.path}</code>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn" onClick={() => handleOpenRoles(scope)}>
                        {openScopeId === scope.id ? '閉じる' : 'ロール'}
                      </button>
                      <button type="button" className="btn" onClick={() => setPendingDelete(scope)}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rolesError && <p style={{ color: 'var(--danger)' }}>{rolesError}</p>}

        {openScopeId !== null && (
          <section>
            <div className="sec-head">
              <h2>このスコープが配るロール</h2>
            </div>
            {roles.length === 0 ? (
              <p className="hint">ロールがまだありません。</p>
            ) : (
              <ul className="check-list">
                {roles.map((role) => (
                  <li key={role.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={openRoleIds.includes(role.id)}
                        onChange={() => toggleRole(role.id)}
                      />
                      {role.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSaveRoles}
              disabled={savingRoles}
            >
              保存
            </button>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        message={
          pendingDelete
            ? `${pendingDelete.path} を削除します。このパス配下のプロジェクトにはロールが届かなくなります。ロール自体は残ります。`
            : ''
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
