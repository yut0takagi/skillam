import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getRole, setRoleAgents, setRoleMcpServers, setRolePermissions, setRoleSkills } from '../api/roles.js'
import { listSkillCandidates } from '../api/catalog.js'
import { useApi } from '../lib/useApi.js'
import { usePagination } from '../lib/usePagination.js'
import { Pagination } from '../components/Pagination.js'
import type { RoleAgent, RoleMcpServer, SkillCandidate } from '../api/types.js'

type TabKey = 'skills' | 'mcp' | 'agents' | 'permissions'

const SOURCE_LABELS: Record<string, string> = {
  user: 'user',
  plugin: 'plugin',
  'project-local': 'project-local'
}

function commandToText(command: unknown): string {
  if (command === null || command === undefined) {
    return ''
  }
  if (typeof command === 'string') {
    return command
  }
  try {
    return JSON.stringify(command)
  } catch {
    return String(command)
  }
}

export function RoleEditor() {
  const { id } = useParams<{ id: string }>()
  const roleId = Number(id)
  const { data: role, error, loading, reload } = useApi(() => getRole(roleId))
  const { data: skillCandidates } = useApi(listSkillCandidates)

  const [tab, setTab] = useState<TabKey>('skills')
  const [selectedSkillPaths, setSelectedSkillPaths] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [agents, setAgents] = useState<RoleAgent[]>([])
  const [mcpServers, setMcpServers] = useState<RoleMcpServer[]>([])
  const [allowList, setAllowList] = useState<string[]>([])
  const [denyList, setDenyList] = useState<string[]>([])
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (role) {
      setSelectedSkillPaths(new Set(role.skills.map((s) => s.skillPath)))
      setAgents(role.agents)
      setMcpServers(role.mcpServers)
      const permissions = (role.permissions?.permissions ?? {}) as { allow?: string[]; deny?: string[] }
      setAllowList(permissions.allow ?? [])
      setDenyList(permissions.deny ?? [])
    }
  }, [role])

  const filteredCandidates = useMemo(() => {
    if (!skillCandidates) {
      return []
    }
    const needle = filter.trim().toLowerCase()
    if (!needle) {
      return skillCandidates
    }
    return skillCandidates.filter(
      (c) => c.name.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle)
    )
  }, [skillCandidates, filter])

  const candidatesPagination = usePagination(filteredCandidates)

  const groupedCandidates = useMemo(() => {
    const groups: Record<string, SkillCandidate[]> = {}
    for (const candidate of candidatesPagination.pageItems) {
      groups[candidate.source] = groups[candidate.source] ?? []
      groups[candidate.source].push(candidate)
    }
    return groups
  }, [candidatesPagination.pageItems])

  const selectedCandidates = useMemo(() => {
    if (!skillCandidates) {
      return []
    }
    return skillCandidates.filter((c) => selectedSkillPaths.has(c.path))
  }, [skillCandidates, selectedSkillPaths])

  function toggleSkill(path: string) {
    setSelectedSkillPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  async function handleSave() {
    setSaveMessage(null)
    setSaveError(null)

    if (tab === 'skills') {
      const skills = selectedCandidates.map((c) => ({ skillSource: c.source, skillPath: c.path }))
      const result = await setRoleSkills(roleId, skills)
      if (!result.ok) {
        setSaveError(result.message)
        return
      }
      setSaveMessage('保存しました。')
      reload()
      return
    }

    if (tab === 'agents') {
      const invalid = agents.find((a) => a.source === 'reference' && !a.sourcePath.trim())
      if (invalid) {
        setSaveError(`エージェント「${invalid.name}」は reference のため sourcePath が必要です。`)
        return
      }
      const result = await setRoleAgents(
        roleId,
        agents.map((a) => ({ name: a.name, markdownBody: a.markdownBody, source: a.source, sourcePath: a.sourcePath }))
      )
      if (!result.ok) {
        setSaveError(result.message)
        return
      }
      setSaveMessage('保存しました。')
      reload()
      return
    }

    if (tab === 'permissions') {
      const result = await setRolePermissions(roleId, { allow: allowList, deny: denyList })
      if (!result.ok) {
        setSaveError(result.message)
        return
      }
      setSaveMessage('保存しました。')
      reload()
      return
    }

    if (tab === 'mcp') {
      const result = await setRoleMcpServers(
        roleId,
        mcpServers.map((s) => ({ name: s.name, command: s.command, env: s.env }))
      )
      if (!result.ok) {
        setSaveError(result.message)
        return
      }
      setSaveMessage('保存しました。')
      reload()
    }
  }

  function handleRemoveMcpServer(serverId: number) {
    setMcpServers((prev) => prev.filter((s) => s.id !== serverId))
    setSaveMessage(null)
  }

  if (loading) {
    return (
      <div className="body">
        <p>読み込み中...</p>
      </div>
    )
  }

  if (error || !role) {
    return (
      <div className="body">
        <p style={{ color: 'var(--danger)' }}>{error ?? 'ロールが見つかりません。'}</p>
      </div>
    )
  }

  return (
    <>
      <div className="topbar">
        <p className="crumb">Roles</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--s4)' }}>
          <div>
            <h1>{role.name}</h1>
            {role.description && <p className="page-note">{role.description}</p>}
          </div>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            保存
          </button>
        </div>
        {saveMessage && <p style={{ color: 'var(--ok)' }}>{saveMessage}</p>}
        {saveError && <p style={{ color: 'var(--danger)' }}>{saveError}</p>}
      </div>

      <div className="body">
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'skills'}
            className="tab"
            onClick={() => setTab('skills')}
          >
            Skills <span className="tab-count">{role.skills.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'mcp'}
            className="tab"
            onClick={() => setTab('mcp')}
          >
            MCP サーバー <span className="tab-count">{mcpServers.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'agents'}
            className="tab"
            onClick={() => setTab('agents')}
          >
            サブエージェント <span className="tab-count">{role.agents.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'permissions'}
            className="tab"
            onClick={() => setTab('permissions')}
          >
            Permissions <span className="tab-count">{allowList.length + denyList.length}</span>
          </button>
        </div>

        {tab === 'skills' && (
          <div className="split">
            <div className="stack">
              <div className="toolbar">
                <div className="field grow">
                  <input
                    type="search"
                    role="searchbox"
                    placeholder="スキルを名前・説明で検索"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              <div className="checklist">
                {Object.entries(groupedCandidates).map(([source, candidates]) => (
                  <div className="check-group" key={source}>
                    <div className="sec-head">
                      <span>{SOURCE_LABELS[source] ?? source}</span>
                      <span className="sec-meta">{candidates.length}件</span>
                    </div>
                    {candidates.map((candidate) => (
                      <label className="check" key={candidate.path}>
                        <input
                          type="checkbox"
                          checked={selectedSkillPaths.has(candidate.path)}
                          onChange={() => toggleSkill(candidate.path)}
                          aria-label={candidate.name}
                        />
                        <span className="check-main">
                          <span className="check-name" style={{ fontFamily: 'var(--mono)' }}>
                            {candidate.name}
                          </span>
                          <span
                            className="check-desc"
                            style={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '48ch'
                            }}
                          >
                            {candidate.description}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
                {filteredCandidates.length === 0 && <p className="empty">該当するスキルがありません。</p>}
              </div>
              <Pagination
                page={candidatesPagination.page}
                pageCount={candidatesPagination.pageCount}
                total={candidatesPagination.total}
                rangeStart={candidatesPagination.rangeStart}
                rangeEnd={candidatesPagination.rangeEnd}
                onChange={candidatesPagination.setPage}
              />
            </div>
            <div className="panel">
              <div className="panel-head">選択中 ({selectedCandidates.length})</div>
              <div className="panel-body">
                {selectedCandidates.length === 0 && <p className="empty">選択されたスキルはありません。</p>}
                {selectedCandidates.map((candidate) => (
                  <div className="row" key={candidate.path}>
                    <span className="check-name" style={{ fontFamily: 'var(--mono)' }}>
                      {candidate.name}
                    </span>
                    <span className="spacer" />
                    <button type="button" className="btn btn-sm" onClick={() => toggleSkill(candidate.path)}>
                      外す
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'mcp' && (
          <div className="stack">
            <p className="hint">シークレットの値はここでは編集できません。値の変更は「設定」から行います。</p>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>名前</th>
                    <th>コマンド</th>
                    <th>環境変数</th>
                    <th style={{ textAlign: 'right' }}>外す</th>
                  </tr>
                </thead>
                <tbody>
                  {mcpServers.map((server) => (
                    <tr key={server.id}>
                      <td className="cell-name">{server.name}</td>
                      <td className="cell-path" style={{ fontFamily: 'var(--mono)' }}>
                        {commandToText(server.command)}
                      </td>
                      <td>
                        {Object.entries(server.env).map(([key, value]) => (
                          <div key={key} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--mono)' }}>{key}</span>
                            {value.startsWith('secret_ref:') ? (
                              <span className="pill pill-warn">シークレット参照</span>
                            ) : (
                              <span>{value}</span>
                            )}
                          </div>
                        ))}
                      </td>
                      <td className="actions" style={{ textAlign: 'right' }}>
                        <button type="button" className="btn btn-sm" onClick={() => handleRemoveMcpServer(server.id)}>
                          外す
                        </button>
                      </td>
                    </tr>
                  ))}
                  {mcpServers.length === 0 && (
                    <tr>
                      <td colSpan={4} className="empty">
                        MCPサーバーは割り当てられていません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'agents' && (
          <div className="stack">
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>名前</th>
                    <th>種別</th>
                    <th>参照元パス</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent, index) => (
                    <tr key={agent.id}>
                      <td className="cell-name" style={{ fontFamily: 'var(--mono)' }}>
                        {agent.name}
                      </td>
                      <td>
                        <span className={agent.source === 'reference' ? 'pill pill-mute' : 'pill pill-ok'}>
                          {agent.source}
                        </span>
                      </td>
                      <td>
                        {agent.source === 'reference' ? (
                          <>
                            <input
                              type="text"
                              value={agent.sourcePath}
                              placeholder="必須: 参照元スキルのパス"
                              onChange={(e) => {
                                const value = e.target.value
                                setAgents((prev) =>
                                  prev.map((a, i) => (i === index ? { ...a, sourcePath: value } : a))
                                )
                              }}
                              style={{ width: '100%' }}
                            />
                            {!agent.sourcePath.trim() && (
                              <p className="hint" style={{ color: 'var(--danger)' }}>
                                reference エージェントには sourcePath が必要です。
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="cell-path">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {agents.length === 0 && (
                    <tr>
                      <td colSpan={3} className="empty">
                        サブエージェントは割り当てられていません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'permissions' && (
          <div className="split" style={{ display: 'flex', gap: 'var(--s5)' }}>
            <PermissionListEditor title="allow" values={allowList} onChange={setAllowList} />
            <PermissionListEditor title="deny" values={denyList} onChange={setDenyList} />
          </div>
        )}
      </div>
    </>
  )
}

function PermissionListEditor({
  title,
  values,
  onChange
}: {
  title: string
  values: string[]
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  function addValue() {
    const trimmed = draft.trim()
    if (!trimmed) {
      return
    }
    onChange([...values, trimmed])
    setDraft('')
  }

  function removeValue(index: number) {
    onChange(values.filter((_, i) => i !== index))
  }

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-head">{title}</div>
      <div className="panel-body stack">
        {values.map((value, index) => (
          <div className="row" key={`${value}-${index}`}>
            <input
              type="text"
              value={value}
              onChange={(e) => {
                const next = [...values]
                next[index] = e.target.value
                onChange(next)
              }}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn btn-sm" onClick={() => removeValue(index)}>
              削除
            </button>
          </div>
        ))}
        <div className="row">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="例: Bash(git *)"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-sm" onClick={addValue}>
            追加
          </button>
        </div>
      </div>
    </div>
  )
}
