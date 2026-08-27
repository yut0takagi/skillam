import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createRole, deleteRole, exportRole, importRole, listRoles } from '../api/roles.js'
import { useApi } from '../lib/useApi.js'
import { ConfirmDialog } from '../components/ConfirmDialog.js'
import type { Role } from '../api/types.js'

export function Roles() {
  const { data: roles, error, loading, reload } = useApi(listRoles)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Role | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function handleExport(role: Role) {
    setExportError(null)
    const result = await exportRole(role.id)
    if (!result.ok) {
      setExportError(result.message)
      return
    }
    // Blob + object URL: works in a plain browser and (per the desktop shell
    // plan in docs/superpowers/plans/2026-08-27-skillam-phase5-electron.md)
    // is expected to work the same way once the renderer loads from
    // file:// — the Electron shell does not exist yet in this repo, so this
    // has not been exercised inside an actual Electron window.
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `${role.name}.skillam-role.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  function handleImportClick() {
    setImportError(null)
    setImportNotice(null)
    fileInputRef.current?.click()
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    setImportError(null)
    setImportNotice(null)

    let payload: unknown
    try {
      const text = await file.text()
      payload = JSON.parse(text)
    } catch {
      setImportError('ファイルの読み込みに失敗しました。有効なJSONファイルを選択してください。')
      return
    }

    const result = await importRole(payload)
    if (!result.ok) {
      setImportError(result.message)
      return
    }
    setImportNotice(
      `ロール「${result.data.name}」を読み込みました。Skill・エージェントの参照パスは絶対パスのため、この環境に存在しない場合は適用時に失敗します。パスを修正してから適用してください。`
    )
    reload()
  }

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
        <input
          type="file"
          accept="application/json"
          ref={fileInputRef}
          onChange={handleImportFile}
          style={{ display: 'none' }}
          aria-label="ロールファイルを選択"
        />
        {importError && <p style={{ color: 'var(--danger)' }}>{importError}</p>}
        {importNotice && <p className="hint">{importNotice}</p>}
        {exportError && <p style={{ color: 'var(--danger)' }}>{exportError}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s2)' }}>
          <button type="button" className="btn" onClick={handleImportClick}>
            インポート
          </button>
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
                  <th style={{ textAlign: 'right' }}>操作</th>
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
                      <button type="button" className="btn btn-sm" onClick={() => handleExport(role)}>
                        エクスポート
                      </button>
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
