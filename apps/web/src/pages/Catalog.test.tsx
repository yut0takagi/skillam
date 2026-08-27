import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Catalog } from './Catalog.js'
import type { SkillCandidate, AgentCandidate, McpServerCandidate, PermissionsCandidate } from '../api/types.js'

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

function renderCatalog() {
  return render(
    <MemoryRouter>
      <Catalog />
    </MemoryRouter>
  )
}

const skillUser: SkillCandidate = {
  source: 'user',
  name: 'commit-helper',
  description: 'コミットメッセージを整える',
  path: '/Users/dev/.claude/skills/commit-helper/SKILL.md'
}

const skillPlugin: SkillCandidate = {
  source: 'plugin',
  name: 'pdf-tools',
  description: 'PDFの読み書き',
  path: '/Users/dev/.claude/plugins/pdf/SKILL.md'
}

const agent: AgentCandidate = {
  source: 'user',
  name: 'code-reviewer',
  description: 'コードレビュー担当',
  markdownBody: '# reviewer',
  path: '/Users/dev/.claude/agents/code-reviewer.md'
}

const mcpServer: McpServerCandidate = {
  source: 'user',
  name: 'github',
  command: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] }
}

const permission: PermissionsCandidate = {
  source: 'project-local',
  projectPath: '/Users/dev/skillam',
  permissions: { allow: ['Bash(git:*)', 'Read'], deny: ['Bash(rm:*)'] }
}

function defaultHandler(url: string) {
  if (url.includes('/catalog/skills')) {
    return { status: 200, body: [skillUser, skillPlugin] }
  }
  if (url.includes('/catalog/agents')) {
    return { status: 200, body: [agent] }
  }
  if (url.includes('/catalog/mcp-servers')) {
    return { status: 200, body: [mcpServer] }
  }
  if (url.includes('/catalog/permissions')) {
    return { status: 200, body: [permission] }
  }
  return { status: 404, body: { error: 'not found' } }
}

describe('Catalog', () => {
  it('renders skills with their source', async () => {
    stubFetch(defaultHandler)
    renderCatalog()

    await waitFor(() => expect(screen.getByText('commit-helper')).toBeDefined())
    expect(screen.getByText('pdf-tools')).toBeDefined()
    const row = screen.getByText('commit-helper').closest('tr') as HTMLElement
    expect(within(row).getByText('user')).toBeDefined()
  })

  it('narrows the list with the filter input', async () => {
    stubFetch(defaultHandler)
    renderCatalog()

    await waitFor(() => expect(screen.getByText('commit-helper')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    const filterInput = screen.getByRole('textbox', { name: /絞り込み|フィルタ/ })
    await userEvent.type(filterInput, 'pdf')

    await waitFor(() => expect(screen.queryByText('commit-helper')).toBeNull())
    expect(screen.getByText('pdf-tools')).toBeDefined()
  })

  it('switching tabs loads that resource', async () => {
    stubFetch(defaultHandler)
    renderCatalog()

    await waitFor(() => expect(screen.getByText('commit-helper')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    await userEvent.click(screen.getByRole('tab', { name: /サブエージェント/ }))

    await waitFor(() => expect(screen.getByText('code-reviewer')).toBeDefined())
    expect(screen.queryByText('commit-helper')).toBeNull()
  })

  it('shows mcp servers with command column when that tab is active', async () => {
    stubFetch(defaultHandler)
    renderCatalog()

    await waitFor(() => expect(screen.getByText('commit-helper')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    await userEvent.click(screen.getByRole('tab', { name: /MCP サーバー/ }))

    await waitFor(() => expect(screen.getByText('github')).toBeDefined())
    expect(screen.getByText(/npx/)).toBeDefined()
  })

  it('shows permission candidates with a compact summary instead of raw JSON', async () => {
    stubFetch(defaultHandler)
    renderCatalog()

    await waitFor(() => expect(screen.getByText('commit-helper')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    await userEvent.click(screen.getByRole('tab', { name: /Permissions/ }))

    await waitFor(() => expect(screen.getByText('/Users/dev/skillam')).toBeDefined())
    expect(screen.getByText(/allow 2 件/)).toBeDefined()
    expect(screen.getByText(/deny 1 件/)).toBeDefined()
    expect(screen.queryByText(/"allow"/)).toBeNull()
  })

  it('shows the server error message', async () => {
    stubFetch((url) => {
      if (url.includes('/catalog/skills')) {
        return { status: 500, body: { error: 'カタログを読み込めません' } }
      }
      return defaultHandler(url)
    })
    renderCatalog()

    await waitFor(() => expect(screen.getByText('カタログを読み込めません')).toBeDefined())
  })

  it('paginates a long list instead of capping and hiding rows', async () => {
    const manySkills: SkillCandidate[] = Array.from({ length: 200 }, (_, i) => ({
      source: 'plugin' as const,
      name: `skill-${i}`,
      description: `説明 ${i}`,
      path: `/plugins/skill-${i}/SKILL.md`
    }))
    stubFetch((url) => {
      if (url.includes('/catalog/skills')) {
        return { status: 200, body: manySkills }
      }
      return defaultHandler(url)
    })
    renderCatalog()

    await waitFor(() => expect(screen.getByText('skill-0')).toBeDefined())
    // First page shows only the first 25 of 200, with a range label — not a
    // hard cap that tells the user to filter.
    expect(screen.getByText('200 件中 1–25 件')).toBeDefined()
    expect(screen.queryByText('skill-199')).toBeNull()
    expect(screen.queryByText(/絞り込んでください/)).toBeNull()

    const userEvent = (await import('@testing-library/user-event')).default
    await userEvent.click(screen.getByRole('button', { name: '8' }))

    await waitFor(() => expect(screen.getByText('skill-175')).toBeDefined())
    expect(screen.queryByText('skill-0')).toBeNull()
  })

  it('reload button refetches the active tab', async () => {
    let skillsCallCount = 0
    stubFetch((url) => {
      if (url.includes('/catalog/skills')) {
        skillsCallCount += 1
        return { status: 200, body: [skillUser] }
      }
      return defaultHandler(url)
    })
    renderCatalog()

    await waitFor(() => expect(screen.getByText('commit-helper')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    await userEvent.click(screen.getByRole('button', { name: '再スキャン' }))

    await waitFor(() => expect(skillsCallCount).toBeGreaterThan(1))
  })
})
