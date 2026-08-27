import { useCallback, useMemo, useState } from 'react'
import {
  listAgentCandidates,
  listMcpCandidates,
  listPermissionCandidates,
  listSkillCandidates
} from '../api/catalog.js'
import { useApi } from '../lib/useApi.js'
import { usePagination } from '../lib/usePagination.js'
import { Pagination } from '../components/Pagination.js'
import type {
  AgentCandidate,
  McpServerCandidate,
  PermissionsCandidate,
  SkillCandidate
} from '../api/types.js'

type TabKey = 'skills' | 'agents' | 'mcp-servers' | 'permissions'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'skills', label: 'Skills' },
  { key: 'agents', label: 'サブエージェント' },
  { key: 'mcp-servers', label: 'MCP サーバー' },
  { key: 'permissions', label: 'Permissions' }
]

function permissionCount(permissions: unknown, key: string): number {
  if (typeof permissions !== 'object' || permissions === null) {
    return 0
  }
  const value = (permissions as Record<string, unknown>)[key]
  return Array.isArray(value) ? value.length : 0
}

function sourceBreakdown(items: { source: string }[]): string {
  const counts = new Map<string, number>()
  for (const item of items) {
    counts.set(item.source, (counts.get(item.source) ?? 0) + 1)
  }
  const order = ['user', 'plugin', 'project-local']
  const keys = [...order.filter((key) => counts.has(key)), ...[...counts.keys()].filter((key) => !order.includes(key))]
  return keys.map((key) => `${key} ${counts.get(key)}`).join(' · ')
}

export function Catalog() {
  const [activeTab, setActiveTab] = useState<TabKey>('skills')
  const [filter, setFilter] = useState('')

  const skillsApi = useApi(useCallback(() => listSkillCandidates(), []))
  const agentsApi = useApi(useCallback(() => listAgentCandidates(), []))
  const mcpApi = useApi(useCallback(() => listMcpCandidates(), []))
  const permissionsApi = useApi(useCallback(() => listPermissionCandidates(), []))

  const apiByTab = {
    skills: skillsApi,
    agents: agentsApi,
    'mcp-servers': mcpApi,
    permissions: permissionsApi
  } as const

  const activeApi = apiByTab[activeTab]

  const handleRescan = useCallback(() => {
    apiByTab[activeTab].reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, skillsApi, agentsApi, mcpApi, permissionsApi])

  const lowerFilter = filter.trim().toLowerCase()

  const filteredSkills = useMemo(() => {
    const items = skillsApi.data ?? []
    if (!lowerFilter) return items
    return items.filter(
      (item) => item.name.toLowerCase().includes(lowerFilter) || item.description.toLowerCase().includes(lowerFilter)
    )
  }, [skillsApi.data, lowerFilter])

  const filteredAgents = useMemo(() => {
    const items = agentsApi.data ?? []
    if (!lowerFilter) return items
    return items.filter(
      (item) => item.name.toLowerCase().includes(lowerFilter) || item.description.toLowerCase().includes(lowerFilter)
    )
  }, [agentsApi.data, lowerFilter])

  const filteredMcp = useMemo(() => {
    const items = mcpApi.data ?? []
    if (!lowerFilter) return items
    return items.filter((item) => item.name.toLowerCase().includes(lowerFilter))
  }, [mcpApi.data, lowerFilter])

  const filteredPermissions = useMemo(() => {
    const items = permissionsApi.data ?? []
    if (!lowerFilter) return items
    return items.filter((item) => item.projectPath.toLowerCase().includes(lowerFilter))
  }, [permissionsApi.data, lowerFilter])

  const skillsPagination = usePagination(filteredSkills)
  const agentsPagination = usePagination(filteredAgents)
  const mcpPagination = usePagination(filteredMcp)
  const permissionsPagination = usePagination(filteredPermissions)

  const paginationByTab = {
    skills: skillsPagination,
    agents: agentsPagination,
    'mcp-servers': mcpPagination,
    permissions: permissionsPagination
  } as const

  const activePagination = paginationByTab[activeTab]

  const breakdownText = useMemo(() => {
    if (activeTab === 'skills') return sourceBreakdown(skillsApi.data ?? [])
    if (activeTab === 'agents') return sourceBreakdown(agentsApi.data ?? [])
    if (activeTab === 'mcp-servers') return sourceBreakdown(mcpApi.data ?? [])
    return sourceBreakdown((permissionsApi.data ?? []).map((item) => ({ source: item.source })))
  }, [activeTab, skillsApi.data, agentsApi.data, mcpApi.data, permissionsApi.data])

  return (
    <>
      <div className="topbar">
        <p className="crumb">Catalog</p>
        <h1>カタログ</h1>
        <p className="page-note">ローカル環境をスキャンして見つかった、ロールに組み込める候補。</p>
        <button type="button" className="btn" style={{ marginTop: 'var(--s3)' }} onClick={handleRescan}>
          再スキャン
        </button>
      </div>
      <div className="body">
        <div className="tabs" role="tablist">
          {TABS.map((tab) => {
            const count = apiByTab[tab.key].data?.length ?? 0
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`tab${activeTab === tab.key ? ' tab-active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label} <span className="tab-count">{count}</span>
              </button>
            )
          })}
        </div>

        <div className="toolbar">
          <div className="field grow">
            <input
              type="text"
              aria-label="絞り込み"
              placeholder="名前・説明で絞り込み"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <p className="sec-meta">{breakdownText}</p>
        </div>

        {activeApi.loading ? (
          <p>読み込み中…</p>
        ) : activeApi.error ? (
          <p className="empty">{activeApi.error}</p>
        ) : (
          <>
            {activeTab === 'skills' && <SkillsTable items={skillsPagination.pageItems} />}
            {activeTab === 'agents' && <AgentsTable items={agentsPagination.pageItems} />}
            {activeTab === 'mcp-servers' && <McpTable items={mcpPagination.pageItems} />}
            {activeTab === 'permissions' && <PermissionsTable items={permissionsPagination.pageItems} />}

            <Pagination
              page={activePagination.page}
              pageCount={activePagination.pageCount}
              total={activePagination.total}
              rangeStart={activePagination.rangeStart}
              rangeEnd={activePagination.rangeEnd}
              onChange={activePagination.setPage}
            />
          </>
        )}
      </div>
    </>
  )
}

function SkillsTable({ items }: { items: SkillCandidate[] }) {
  const rows = items
  if (rows.length === 0) {
    return <p className="empty">条件に一致する候補はありません。</p>
  }
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>発見元</th>
            <th>名前</th>
            <th>説明</th>
            <th>パス</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.path}>
              <td>
                <span className="pill pill-src">{item.source}</span>
              </td>
              <td className="cell-name">{item.name}</td>
              <td>{item.description}</td>
              <td className="cell-path">{item.path}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AgentsTable({ items }: { items: AgentCandidate[] }) {
  const rows = items
  if (rows.length === 0) {
    return <p className="empty">条件に一致する候補はありません。</p>
  }
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>発見元</th>
            <th>名前</th>
            <th>説明</th>
            <th>パス</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.path}>
              <td>
                <span className="pill pill-src">{item.source}</span>
              </td>
              <td className="cell-name">{item.name}</td>
              <td>{item.description}</td>
              <td className="cell-path">{item.path}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function McpTable({ items }: { items: McpServerCandidate[] }) {
  const rows = items
  if (rows.length === 0) {
    return <p className="empty">条件に一致する候補はありません。</p>
  }
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>発見元</th>
            <th>名前</th>
            <th>コマンド</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.name}>
              <td>
                <span className="pill pill-src">{item.source}</span>
              </td>
              <td className="cell-name">{item.name}</td>
              <td className="cell-path">{commandSummary(item.command)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function commandSummary(command: unknown): string {
  if (typeof command === 'object' && command !== null && 'command' in command) {
    const cmd = command as { command?: unknown; args?: unknown }
    const args = Array.isArray(cmd.args) ? cmd.args.join(' ') : ''
    return [String(cmd.command ?? ''), args].filter(Boolean).join(' ')
  }
  return typeof command === 'string' ? command : JSON.stringify(command)
}

function PermissionsTable({ items }: { items: PermissionsCandidate[] }) {
  const rows = items
  if (rows.length === 0) {
    return <p className="empty">条件に一致する候補はありません。</p>
  }
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>発見元</th>
            <th>プロジェクト</th>
            <th>概要</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const allowCount = permissionCount(item.permissions, 'allow')
            const denyCount = permissionCount(item.permissions, 'deny')
            return (
              <tr key={item.projectPath}>
                <td>
                  <span className="pill pill-src">{item.source}</span>
                </td>
                <td className="cell-path">{item.projectPath}</td>
                <td>
                  allow {allowCount} 件 / deny {denyCount} 件
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
