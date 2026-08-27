import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createProject, listProjects, scanProjects } from '../api/projects.js'
import { listRoles } from '../api/roles.js'
import { useApi } from '../lib/useApi.js'

export function Dashboard() {
  const projectsApi = useApi(useCallback(() => listProjects(), []))
  const candidatesApi = useApi(useCallback(() => scanProjects(), []))
  const rolesApi = useApi(useCallback(() => listRoles(), []))

  const [registerError, setRegisterError] = useState<string | null>(null)
  const [pendingPath, setPendingPath] = useState<string | null>(null)

  const roleNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const role of rolesApi.data ?? []) {
      map.set(role.id, role.name)
    }
    return map
  }, [rolesApi.data])

  const reloadAll = useCallback(() => {
    projectsApi.reload()
    candidatesApi.reload()
  }, [projectsApi, candidatesApi])

  const handleRegister = useCallback(
    async (path: string, name: string) => {
      setRegisterError(null)
      setPendingPath(path)
      const result = await createProject(path, name)
      setPendingPath(null)
      if (!result.ok) {
        setRegisterError(result.message)
        return
      }
      reloadAll()
    },
    [reloadAll]
  )

  const loading = projectsApi.loading || candidatesApi.loading
  const projects = projectsApi.data ?? []
  const candidates = candidatesApi.data ?? []

  return (
    <>
      <div className="topbar">
        <p className="crumb">Dashboard</p>
        <h1>プロジェクト</h1>
        <p className="page-note">
          登録済みのプロジェクトと、自動検出ルート配下で見つかった未登録の候補を分けて表示します。候補は個別に登録するまで管理対象になりません。
        </p>
        <button type="button" className="btn" style={{ marginTop: 'var(--s3)' }} onClick={reloadAll}>
          再スキャン
        </button>
      </div>
      <div className="body">
        {loading ? (
          <p>読み込み中…</p>
        ) : (
          <>
            <section>
              <div className="sec-head">
                <h2>登録済み</h2>
              </div>
              {projectsApi.error ? (
                <p className="empty">{projectsApi.error}</p>
              ) : projects.length === 0 ? (
                <p className="empty">登録されたプロジェクトはありません。</p>
              ) : (
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>名前</th>
                        <th>パス</th>
                        <th>適用中のロール</th>
                        <th>最終適用</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map((project) => (
                        <tr key={project.id}>
                          <td className="cell-name">
                            <Link to={`/projects/${project.id}`}>{project.name}</Link>
                          </td>
                          <td className="cell-path">{project.path}</td>
                          <td>
                            {project.lastAppliedRoleId === null ? (
                              <span className="pill pill-mute">未適用</span>
                            ) : (
                              <span className="pill pill-ok">
                                {roleNameById.get(project.lastAppliedRoleId) ?? `#${project.lastAppliedRoleId}`}
                              </span>
                            )}
                          </td>
                          <td>{project.lastAppliedAt ?? '—'}</td>
                          <td className="actions">
                            <Link to={`/projects/${project.id}`} className="btn btn-sm">
                              開く
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {candidatesApi.error ? (
              <section>
                <div className="sec-head">
                  <h2>未登録の検出結果</h2>
                </div>
                <p className="empty">{candidatesApi.error}</p>
              </section>
            ) : candidates.length > 0 ? (
              <section>
                <div className="sec-head">
                  <h2>未登録の検出結果</h2>
                </div>
                {registerError ? <p className="empty">{registerError}</p> : null}
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>候補</th>
                        <th>パス</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((candidate) => (
                        <tr key={candidate.path}>
                          <td className="cell-name">{candidate.name}</td>
                          <td className="cell-path">{candidate.path}</td>
                          <td className="actions">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={pendingPath === candidate.path}
                              onClick={() => handleRegister(candidate.path, candidate.name)}
                            >
                              登録する
                            </button>
                            <button type="button" className="btn btn-sm" disabled title="未実装">
                              無視
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="hint">自動登録はしません。個別に選んでください。</p>
              </section>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}
