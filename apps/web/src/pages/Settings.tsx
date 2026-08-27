import { useCallback, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog.js'
import {
  addAutoDetectRoot,
  deleteAutoDetectRoot,
  deleteSecret,
  listAutoDetectRoots,
  listSecrets,
  revealSecret
} from '../api/settings.js'
import { useApi } from '../lib/useApi.js'

export function Settings() {
  const rootsApi = useApi(useCallback(() => listAutoDetectRoots(), []))
  const secretsApi = useApi(useCallback(() => listSecrets(), []))

  const [newRootPath, setNewRootPath] = useState('')
  const [addRootError, setAddRootError] = useState<string | null>(null)
  const [pendingRootDeleteId, setPendingRootDeleteId] = useState<number | null>(null)

  const [pendingSecretDeleteId, setPendingSecretDeleteId] = useState<number | null>(null)
  const [revealedValues, setRevealedValues] = useState<Record<number, string>>({})
  const [revealError, setRevealError] = useState<string | null>(null)

  const handleAddRoot = useCallback(async () => {
    const path = newRootPath.trim()
    if (!path) {
      return
    }
    setAddRootError(null)
    const result = await addAutoDetectRoot(path)
    if (!result.ok) {
      setAddRootError(result.message)
      return
    }
    setNewRootPath('')
    rootsApi.reload()
  }, [newRootPath, rootsApi])

  const handleConfirmDeleteRoot = useCallback(async () => {
    if (pendingRootDeleteId === null) {
      return
    }
    const id = pendingRootDeleteId
    setPendingRootDeleteId(null)
    const result = await deleteAutoDetectRoot(id)
    if (result.ok) {
      rootsApi.reload()
    }
  }, [pendingRootDeleteId, rootsApi])

  const handleReveal = useCallback(async (id: number) => {
    setRevealError(null)
    const result = await revealSecret(id)
    if (!result.ok) {
      setRevealError(result.message)
      return
    }
    setRevealedValues((prev) => ({ ...prev, [id]: result.data.value }))
  }, [])

  const handleHide = useCallback((id: number) => {
    setRevealedValues((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const handleConfirmDeleteSecret = useCallback(async () => {
    if (pendingSecretDeleteId === null) {
      return
    }
    const id = pendingSecretDeleteId
    setPendingSecretDeleteId(null)
    const result = await deleteSecret(id)
    if (result.ok) {
      handleHide(id)
      secretsApi.reload()
    }
  }, [pendingSecretDeleteId, secretsApi, handleHide])

  const roots = rootsApi.data ?? []
  const secrets = secretsApi.data ?? []

  return (
    <>
      <div className="topbar">
        <p className="crumb">Settings</p>
        <h1>設定</h1>
        <p className="page-note">自動検出ルートとシークレットを管理します。</p>
      </div>
      <div className="body">
        <section>
          <div className="sec-head">
            <h2>自動検出ルート</h2>
          </div>
          {rootsApi.loading ? (
            <p>読み込み中…</p>
          ) : rootsApi.error ? (
            <p className="empty">{rootsApi.error}</p>
          ) : roots.length === 0 ? (
            <p className="empty">自動検出ルートは登録されていません。</p>
          ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>パス</th>
                    <th>登録日</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {roots.map((root) => (
                    <tr key={root.id}>
                      <td className="cell-path">{root.path}</td>
                      <td>{root.createdAt}</td>
                      <td className="actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => setPendingRootDeleteId(root.id)}
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {addRootError ? <p className="empty">{addRootError}</p> : null}

          <div className="toolbar">
            <div className="field grow">
              <input
                type="text"
                aria-label="ルートのパス"
                placeholder="/Users/dev/Projects"
                value={newRootPath}
                onChange={(event) => setNewRootPath(event.target.value)}
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={handleAddRoot}>
              ルートを追加
            </button>
          </div>
        </section>

        <section>
          <div className="sec-head">
            <h2>シークレット</h2>
          </div>
          {revealError ? <p className="empty">{revealError}</p> : null}
          {secretsApi.loading ? (
            <p>読み込み中…</p>
          ) : secretsApi.error ? (
            <p className="empty">{secretsApi.error}</p>
          ) : secrets.length === 0 ? (
            <p className="empty">シークレットは登録されていません。</p>
          ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>参照名</th>
                    <th>値</th>
                    <th>更新</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {secrets.map((secret) => {
                    const revealedValue = revealedValues[secret.id]
                    const isRevealed = revealedValue !== undefined
                    return (
                      <tr key={secret.id}>
                        <td className="cell-name">{secret.refName}</td>
                        <td>
                          {isRevealed ? (
                            <span className="cell-path">{revealedValue}</span>
                          ) : (
                            <span className="pill pill-mute">非表示</span>
                          )}
                        </td>
                        <td>{secret.updatedAt}</td>
                        <td className="actions">
                          {isRevealed ? (
                            <button type="button" className="btn btn-sm" onClick={() => handleHide(secret.id)}>
                              隠す
                            </button>
                          ) : (
                            <button type="button" className="btn btn-sm" onClick={() => handleReveal(secret.id)}>
                              表示
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => setPendingSecretDeleteId(secret.id)}
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">
            値は一覧に出しません。「表示」を押したときだけ復号します。マスターキーは macOS キーチェーンに保管されています。
          </p>
        </section>
      </div>

      <ConfirmDialog
        open={pendingRootDeleteId !== null}
        message="この自動検出ルートを削除します。よろしいですか?"
        onConfirm={handleConfirmDeleteRoot}
        onCancel={() => setPendingRootDeleteId(null)}
      />

      <ConfirmDialog
        open={pendingSecretDeleteId !== null}
        message="このシークレットを削除します。参照しているロールは適用できなくなります。よろしいですか?"
        onConfirm={handleConfirmDeleteSecret}
        onCancel={() => setPendingSecretDeleteId(null)}
      />
    </>
  )
}
