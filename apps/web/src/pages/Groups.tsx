import { useCallback, useState } from 'react'
import { createGroup, deleteGroup, listGroups, listGroupRoles, setGroupRoles } from '../api/groups.js'
import { listRoles } from '../api/roles.js'
import { useApi } from '../lib/useApi.js'
import { ConfirmDialog } from '../components/ConfirmDialog.js'
import type { Group, GroupRole } from '../api/types.js'

export function Groups() {
  const { data: groups, error, loading, reload } = useApi(listGroups)
  const rolesApi = useApi(useCallback(() => listRoles(), []))

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null)

  const [openGroupId, setOpenGroupId] = useState<number | null>(null)
  const [openRoleIds, setOpenRoleIds] = useState<number[]>([])
  const [rolesError, setRolesError] = useState<string | null>(null)
  const [savingRoles, setSavingRoles] = useState(false)

  const roles = rolesApi.data ?? []

  async function handleCreate() {
    setCreateError(null)
    if (newName.trim() === '') {
      setCreateError('グループ名を入力してください。')
      return
    }
    const result = await createGroup(newName.trim(), newDescription.trim() || undefined)
    if (!result.ok) {
      setCreateError(result.message)
      return
    }
    setCreating(false)
    setNewName('')
    setNewDescription('')
    reload()
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) {
      return
    }
    await deleteGroup(pendingDelete.id)
    setPendingDelete(null)
    if (openGroupId === pendingDelete.id) {
      setOpenGroupId(null)
    }
    reload()
  }

  async function handleOpenRoles(group: Group) {
    if (openGroupId === group.id) {
      setOpenGroupId(null)
      return
    }
    setRolesError(null)
    const result = await listGroupRoles(group.id)
    if (!result.ok) {
      setRolesError(result.message)
      return
    }
    setOpenGroupId(group.id)
    setOpenRoleIds(result.data.map((bound: GroupRole) => bound.roleId))
  }

  function toggleRole(roleId: number) {
    setOpenRoleIds((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId]
    )
  }

  async function handleSaveRoles() {
    if (openGroupId === null) {
      return
    }
    setSavingRoles(true)
    setRolesError(null)
    const result = await setGroupRoles(openGroupId, openRoleIds)
    setSavingRoles(false)
    if (!result.ok) {
      setRolesError(result.message)
      return
    }
    setOpenGroupId(null)
  }

  return (
    <>
      <div className="topbar">
        <p className="crumb">Groups</p>
        <h1>グループ</h1>
        <p className="page-note">
          ディレクトリの位置に関係なく、所属させたプロジェクトへロールを配ります。
          「TypeScript を使う PJT」のような、パスでは表せないまとまりに使います。
        </p>
      </div>
      <div className="body">
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s2)' }}>
          {creating ? (
            <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="グループ名"
                aria-label="グループ名"
                autoFocus
              />
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="説明（任意）"
                aria-label="グループの説明"
              />
              <button type="button" className="btn btn-primary" onClick={handleCreate}>
                作成
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setCreating(false)
                  setNewName('')
                  setNewDescription('')
                  setCreateError(null)
                }}
              >
                やめる
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              新規グループ
            </button>
          )}
        </div>
        {createError && <p style={{ color: 'var(--danger)' }}>{createError}</p>}

        {loading && <p>読み込み中...</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        {groups && groups.length === 0 && (
          <p className="hint">グループはまだありません。</p>
        )}

        {groups && groups.length > 0 && (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>名前</th>
                  <th>説明</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id}>
                    <td className="cell-name">{group.name}</td>
                    <td>{group.description || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn" onClick={() => handleOpenRoles(group)}>
                        {openGroupId === group.id ? '閉じる' : 'ロール'}
                      </button>
                      <button type="button" className="btn" onClick={() => setPendingDelete(group)}>
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

        {openGroupId !== null && (
          <section>
            <div className="sec-head">
              <h2>このグループが配るロール</h2>
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
            ? `${pendingDelete.name} を削除します。所属とロールの割り当ては外れますが、プロジェクトとロール自体は残ります。`
            : ''
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
