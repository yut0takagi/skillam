import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoleEditor } from './RoleEditor.js'
import type { RoleDetail, SkillCandidate } from '../api/types.js'

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const { status, body } = handler(String(url), init)
      return { ok: status < 400, status, json: async () => body }
    })
  )
}

afterEach(() => vi.unstubAllGlobals())

function renderEditor(id = '1') {
  return render(
    <MemoryRouter initialEntries={[`/roles/${id}`]}>
      <Routes>
        <Route path="/roles/:id" element={<RoleEditor />} />
      </Routes>
    </MemoryRouter>
  )
}

const roleDetail: RoleDetail = {
  id: 1,
  name: 'backend-dev',
  description: 'バックエンド開発用ロール',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  skills: [{ id: 1, skillSource: 'user', skillPath: '/Users/dev/.claude/skills/deploy/SKILL.md' }],
  mcpServers: [
    { id: 1, name: 'github', command: { type: 'stdio', command: 'gh-mcp' }, env: { TOKEN: 'secret_ref:abc123' } }
  ],
  agents: [{ id: 1, name: 'reviewer', markdownBody: '# reviewer', source: 'reference', sourcePath: '/Users/dev/.claude/agents/reviewer.md' }],
  permissions: { roleId: 1, permissions: { allow: ['Bash(git *)'], deny: ['Bash(rm *)'] } }
}

const skillCandidates: SkillCandidate[] = [
  { source: 'user', name: 'deploy', description: 'デプロイ作業を自動化するスキル', path: '/Users/dev/.claude/skills/deploy/SKILL.md' },
  { source: 'user', name: 'lint-fix', description: 'lint エラーを自動修正するスキル', path: '/Users/dev/.claude/skills/lint-fix/SKILL.md' },
  { source: 'plugin', name: 'commit-helper', description: 'コミットメッセージを整えるスキル', path: '/plugins/foo/skills/commit-helper/SKILL.md' }
]

function defaultHandler(url: string) {
  if (url.includes('/catalog/skills')) {
    return { status: 200, body: skillCandidates }
  }
  if (url.includes('/roles/1')) {
    return { status: 200, body: roleDetail }
  }
  return { status: 404, body: { error: 'not found' } }
}

describe('RoleEditor', () => {
  it('shows the role name', async () => {
    stubFetch(defaultHandler)
    renderEditor()

    await waitFor(() => expect(screen.getByText('backend-dev')).toBeDefined())
  })

  it('checks skills already assigned to the role', async () => {
    stubFetch(defaultHandler)
    renderEditor()

    await waitFor(() => expect(screen.getByText('deploy')).toBeDefined())
    await waitFor(() => {
      const deployCheckbox = screen.getByRole('checkbox', { name: /deploy/ }) as HTMLInputElement
      expect(deployCheckbox.checked).toBe(true)
    })
    const lintCheckbox = screen.getByRole('checkbox', { name: /lint-fix/ }) as HTMLInputElement
    expect(lintCheckbox.checked).toBe(false)
  })

  it('filtering narrows the visible skill list', async () => {
    stubFetch(defaultHandler)
    renderEditor()

    await waitFor(() => expect(screen.getByText('deploy')).toBeDefined())
    const checklist = document.querySelector('.checklist') as HTMLElement
    expect(within(checklist).getByText('lint-fix')).toBeDefined()

    const filterInput = screen.getByRole('searchbox')
    await userEvent.type(filterInput, 'lint')

    // "deploy" is filtered out of the candidate picker, even though it still
    // shows up in the "selected" summary panel elsewhere on the page.
    expect(within(checklist).queryByText('deploy')).toBeNull()
    expect(within(checklist).getByText('lint-fix')).toBeDefined()
  })

  it('saving skills sends skillSource/skillPath pairs', async () => {
    let sentBody: unknown = null
    stubFetch((url, init) => {
      if (url.includes('/roles/1/skills') && init?.method === 'PUT') {
        sentBody = JSON.parse(String(init.body))
        return { status: 200, body: [] }
      }
      return defaultHandler(url)
    })
    renderEditor()

    await waitFor(() => expect(screen.getByText('lint-fix')).toBeDefined())
    const lintCheckbox = screen.getByRole('checkbox', { name: /lint-fix/ })
    await userEvent.click(lintCheckbox)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toEqual({
      skills: expect.arrayContaining([
        { skillSource: 'user', skillPath: '/Users/dev/.claude/skills/deploy/SKILL.md' },
        { skillSource: 'user', skillPath: '/Users/dev/.claude/skills/lint-fix/SKILL.md' }
      ])
    })
    expect((sentBody as { skills: unknown[] }).skills).toHaveLength(2)
  })

  it('renders a secret_ref env value as a masked pill, not the raw string', async () => {
    stubFetch(defaultHandler)
    renderEditor()

    await waitFor(() => expect(screen.getByText('backend-dev')).toBeDefined())
    await userEvent.click(screen.getByRole('tab', { name: /MCP サーバー/ }))

    await waitFor(() => expect(screen.getByText('シークレット参照')).toBeDefined())
    expect(screen.queryByText('secret_ref:abc123')).toBeNull()
    expect(screen.queryByDisplayValue('secret_ref:abc123')).toBeNull()
  })

  it('permissions save sends allow/deny lists', async () => {
    let sentBody: unknown = null
    stubFetch((url, init) => {
      if (url.includes('/roles/1/permissions') && init?.method === 'PUT') {
        sentBody = JSON.parse(String(init.body))
        return { status: 200, body: { roleId: 1, permissions: { allow: [], deny: [] } } }
      }
      return defaultHandler(url)
    })
    renderEditor()

    await waitFor(() => expect(screen.getByText('backend-dev')).toBeDefined())
    await userEvent.click(screen.getByRole('tab', { name: /Permissions/ }))

    await waitFor(() => expect(screen.getByDisplayValue('Bash(git *)')).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toEqual({
      permissions: { allow: ['Bash(git *)'], deny: ['Bash(rm *)'] }
    })
  })
})
