import { useState } from 'react'
import { Link } from 'react-router-dom'
import { createRole, deleteRole, listRoles } from '../api/roles.js'
import { useApi } from '../lib/useApi.js'
import { ConfirmDialog } from '../components/ConfirmDialog.js'
import type { Role } from '../api/types.js'

export function Roles() {
  const { data: roles, error, loading, reload } = useApi(listRoles)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Role | null>(null)

  async function handleCreate() {
    const name = newName.trim()
    if (!name) {
      return
    }
    const result = await createRole(name)
    if (!result.ok) {
      setCreateError(result.message)
      return
    }
    setCreating(false)
    setNewName('')
    setCreateError(null)
    reload()
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) {
      return
    }
    await deleteRole(pendingDelete.id)
    setPendingDelete(null)
    reload()
  }

  return (
    <>
      <div className="topbar">
        <p className="crumb">Roles</p>
        <h1>ロール</h1>
        <p className="page-note">
          Skills / MCPサーバー / サブエージェント / Permissions をまとめた定義。プロジェクトへ割り当てて適用します。
        </p>
      </div>
      <div className="body">
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {creating ? (
            <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ロール名"
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
                  setNewName('')
                  setCreateError(null)
                }}
              >
                やめる
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              新規ロール
            </button>
          )}
        </div>
        {createError && <p style={{ color: 'var(--danger)' }}>{createError}</p>}

        {loading && <p>読み込み中...</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        {roles && (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>名前</th>
                  <th>説明</th>
                  <th style={{ textAlign: 'right' }}>削除</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id}>
                    <td className="cell-name">
                      <Link to={`/roles/${role.id}`}>{role.name}</Link>
                    </td>
                    <td>{role.description}</td>
                    <td className="actions" style={{ textAlign: 'right' }}>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => setPendingDelete(role)}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
                {roles.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty">
                      ロールはまだありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        message={pendingDelete ? `ロール「${pendingDelete.name}」を削除しますか？` : ''}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
