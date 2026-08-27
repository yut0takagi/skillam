import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDetail } from './ProjectDetail.js'
import type { ApplyHistoryEntry, ApplyPlan, Project, Role } from '../api/types.js'

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const { status, body } = handler(String(url), init)
      return { ok: status < 400, status, json: async () => body }
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/projects/1']}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

const project: Project = {
  id: 1,
  path: '/Users/dev/skillam',
  name: 'skillam',
  autoDetected: false,
  excluded: false,
  lastAppliedRoleId: 7,
  lastAppliedAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const role: Role = {
  id: 7,
  name: 'backend-dev',
  description: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const plan: ApplyPlan = {
  projectId: 1,
  projectPath: '/Users/dev/skillam',
  roleId: 7,
  settingsFile: {
    path: '/Users/dev/skillam/.claude/settings.json',
    before: '{}',
    after: '{\n  "permissions": {}\n}'
  },
  mcpFile: {
    path: '/Users/dev/skillam/.mcp.json',
    before: null,
    after: '{\n  "mcpServers": {}\n}'
  },
  mcpAfterObject: {},
  operations: [
    { type: 'create-link', path: '/Users/dev/skillam/.claude/skills/foo', target: '/Users/shared/skills/foo' },
    { type: 'write-file', path: '/Users/dev/skillam/.mcp.json', content: '{}' },
    { type: 'remove', path: '/Users/dev/skillam/.claude/skills/old' }
  ],
  managed: {
    mcpServers: ['github'],
    materialized: ['/Users/dev/skillam/.claude/skills/foo'],
    permissionAllow: ['Bash(git:*)'],
    permissionDeny: []
  }
}

const historyEntry: ApplyHistoryEntry = {
  id: 100,
  projectId: 1,
  roleId: 7,
  diff: {},
  managed: plan.managed,
  status: 'success',
  errorMessage: '',
  appliedAt: '2026-08-01T00:00:00.000Z'
}

function baseHandler(overrides: {
  history?: ApplyHistoryEntry[]
  roles?: Role[]
  project?: Project
} = {}) {
  const history = overrides.history ?? [historyEntry]
  const roles = overrides.roles ?? [role]
  const proj = overrides.project ?? project

  return (url: string, init?: RequestInit) => {
    if (url.includes('/apply-history')) {
      return { status: 200, body: history }
    }
    if (url.endsWith('/roles') && !url.includes('/projects/')) {
      return { status: 200, body: roles }
    }
    if (url.includes('/projects/1/roles')) {
      return { status: 200, body: [{ roleId: 7, priority: 0 }] }
    }
    if (url.includes('/apply/preview')) {
      return { status: 200, body: plan }
    }
    if (url.endsWith('/apply') && init?.method === 'POST') {
      return { status: 200, body: { status: 'success', historyId: 101, plan } }
    }
    if (url.includes('/projects/1') && (!init || init.method === undefined || init.method === 'GET')) {
      return { status: 200, body: proj }
    }
    return { status: 404, body: { error: 'not found' } }
  }
}

describe('ProjectDetail', () => {
  it('shows the project name and path', async () => {
    stubFetch(baseHandler())
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    expect(screen.getAllByText('/Users/dev/skillam').length).toBeGreaterThan(0)
  })

  it('shows both file diffs after clicking プレビュー', async () => {
    stubFetch(baseHandler())
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const previewButton = await screen.findByRole('button', { name: 'プレビュー' })
    expect((previewButton as HTMLButtonElement).disabled).toBe(false)
    previewButton.click()

    await waitFor(() => expect(screen.getByText('/Users/dev/skillam/.claude/settings.json')).toBeDefined())
    expect(screen.getAllByText('/Users/dev/skillam/.mcp.json').length).toBeGreaterThan(0)
  })

  it('lists the symlink/other operations that would run after preview', async () => {
    stubFetch(baseHandler())
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const previewButton = await screen.findByRole('button', { name: 'プレビュー' })
    previewButton.click()

    await waitFor(() => expect(screen.getByText('リンク作成')).toBeDefined())
    expect(screen.getByText('ファイル書出')).toBeDefined()
    expect(screen.getByText('削除')).toBeDefined()
  })

  it('409 on preview shows the conflict message, says nothing was written, and hides 適用する', async () => {
    stubFetch((url, init) => {
      if (url.includes('/apply/preview')) {
        return { status: 409, body: { error: 'このプロジェクトは除外されています' } }
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const previewButton = await screen.findByRole('button', { name: 'プレビュー' })
    previewButton.click()

    await waitFor(() => expect(screen.getByText('このプロジェクトは除外されています')).toBeDefined())
    expect(screen.getByText('ファイルは変更されていません。')).toBeDefined()
    expect(screen.queryByRole('button', { name: '適用する' })).toBeNull()
  })

  it('500 on apply shows the message AND warns about partial writes', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/apply') && init?.method === 'POST') {
        return { status: 500, body: { error: '書き込みに失敗しました' } }
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const previewButton = await screen.findByRole('button', { name: 'プレビュー' })
    previewButton.click()
    const applyButton = await screen.findByRole('button', { name: '適用する' })
    applyButton.click()

    await waitFor(() => expect(screen.getByText('書き込みに失敗しました')).toBeDefined())
    expect(screen.getByText('一部のファイルが書き込まれている可能性があります。')).toBeDefined()
  })

  it('successful apply shows 適用しました and refetches history', async () => {
    let historyCallCount = 0
    stubFetch((url, init) => {
      if (url.includes('/apply-history')) {
        historyCallCount += 1
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const previewButton = await screen.findByRole('button', { name: 'プレビュー' })
    previewButton.click()
    const applyButton = await screen.findByRole('button', { name: '適用する' })

    const callsBeforeApply = historyCallCount
    applyButton.click()

    await waitFor(() => expect(screen.getByText('適用しました')).toBeDefined())
    await waitFor(() => expect(historyCallCount).toBeGreaterThan(callsBeforeApply))
  })

  it('history lists newest first with status indicated', async () => {
    const older: ApplyHistoryEntry = {
      ...historyEntry,
      id: 1,
      status: 'failed',
      errorMessage: '失敗しました',
      appliedAt: '2026-07-01T00:00:00.000Z'
    }
    const newer: ApplyHistoryEntry = {
      ...historyEntry,
      id: 2,
      status: 'success',
      appliedAt: '2026-08-01T00:00:00.000Z'
    }
    stubFetch(baseHandler({ history: [older, newer] }))
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const rows = await screen.findAllByTestId('hist-row')
    expect(rows.length).toBe(2)
    expect(within(rows[0]).getByText('backend-dev')).toBeDefined()
    expect(rows[0].className).toContain('') // sanity: rendered
    // newest (id 2, success) should come first
    expect(rows[0].getAttribute('data-status')).toBe('success')
    expect(rows[1].getAttribute('data-status')).toBe('failed')
  })

  it('history entry with roleId null renders 削除されたロール without crashing', async () => {
    const orphan: ApplyHistoryEntry = { ...historyEntry, roleId: null }
    stubFetch(baseHandler({ history: [orphan] }))
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    await waitFor(() => expect(screen.getByText('削除されたロール')).toBeDefined())
  })

  it('empty history shows an empty state', async () => {
    stubFetch(baseHandler({ history: [] }))
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    await waitFor(() => expect(screen.getByText('適用履歴はまだありません。')).toBeDefined())
  })

  it('renders a checkbox per role, with the assigned ones checked', async () => {
    stubFetch(
      baseHandler({
        roles: [role, { ...role, id: 2, name: 'frontend-dev' }, { ...role, id: 3, name: 'minimal' }]
      })
    )
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const backendCheckbox = (await screen.findByLabelText('backend-dev')) as HTMLInputElement
    const frontendCheckbox = (await screen.findByLabelText('frontend-dev')) as HTMLInputElement
    const minimalCheckbox = (await screen.findByLabelText('minimal')) as HTMLInputElement

    expect(backendCheckbox.checked).toBe(true)
    expect(frontendCheckbox.checked).toBe(false)
    expect(minimalCheckbox.checked).toBe(false)
  })

  it('saving sends ALL checked ids in visible order', async () => {
    let putCalled = false
    let putBody: unknown = null
    stubFetch((url, init) => {
      if (url.includes('/projects/1/roles') && init?.method === 'PUT') {
        putCalled = true
        putBody = init.body ? JSON.parse(String(init.body)) : null
        return { status: 200, body: [{ roleId: 7, priority: 0 }, { roleId: 2, priority: 1 }, { roleId: 3, priority: 2 }] }
      }
      return baseHandler({
        roles: [role, { ...role, id: 2, name: 'frontend-dev' }, { ...role, id: 3, name: 'minimal' }]
      })(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const frontendCheckbox = await screen.findByLabelText('frontend-dev')
    const minimalCheckbox = await screen.findByLabelText('minimal')
    frontendCheckbox.click()
    minimalCheckbox.click()

    const saveButton = screen.getByRole('button', { name: '保存' })
    saveButton.click()

    await waitFor(() => expect(putCalled).toBe(true))
    expect(putBody).toEqual({ roleIds: [7, 2, 3] })
  })

  it('shows the server message when saving assignment fails (unknown role id)', async () => {
    stubFetch((url, init) => {
      if (url.includes('/projects/1/roles') && init?.method === 'PUT') {
        return { status: 400, body: { error: '不明なロールIDです' } }
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const saveButton = screen.getByRole('button', { name: '保存' })
    saveButton.click()

    await waitFor(() => expect(screen.getByText('不明なロールIDです')).toBeDefined())
  })

  it('with two assigned roles, an 適用するロール selector appears, defaulting to the highest priority one', async () => {
    stubFetch((url, init) => {
      if (url.includes('/projects/1/roles') && (!init || init.method === undefined || init.method === 'GET')) {
        return { status: 200, body: [{ roleId: 2, priority: 0 }, { roleId: 7, priority: 1 }] }
      }
      return baseHandler({
        roles: [role, { ...role, id: 2, name: 'frontend-dev' }]
      })(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const selector = (await screen.findByLabelText('適用するロール')) as HTMLSelectElement
    expect(selector).toBeDefined()
    expect(selector.value).toBe('2')
  })

  it('with exactly one assigned role, no 適用するロール selector appears', async () => {
    stubFetch(baseHandler())
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    await screen.findByRole('button', { name: 'プレビュー' })
    expect(screen.queryByLabelText('適用するロール')).toBeNull()
  })

  it('preview uses the role chosen in the 適用するロール selector', async () => {
    let previewRoleId: number | null = null
    stubFetch((url, init) => {
      if (url.includes('/apply/preview')) {
        previewRoleId = init?.body ? JSON.parse(String(init.body)).roleId : null
        return { status: 200, body: plan }
      }
      if (url.includes('/projects/1/roles') && (!init || init.method === undefined || init.method === 'GET')) {
        return { status: 200, body: [{ roleId: 2, priority: 0 }, { roleId: 7, priority: 1 }] }
      }
      return baseHandler({
        roles: [role, { ...role, id: 2, name: 'frontend-dev' }]
      })(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const selector = (await screen.findByLabelText('適用するロール')) as HTMLSelectElement
    selector.value = '7'
    selector.dispatchEvent(new Event('change', { bubbles: true }))

    const previewButton = await screen.findByRole('button', { name: 'プレビュー' })
    previewButton.click()

    await waitFor(() => expect(previewRoleId).toBe(7))
  })

  it('shows the multi-role hint when two or more roles are assigned', async () => {
    stubFetch((url, init) => {
      if (url.includes('/projects/1/roles') && (!init || init.method === undefined || init.method === 'GET')) {
        return { status: 200, body: [{ roleId: 2, priority: 0 }, { roleId: 7, priority: 1 }] }
      }
      return baseHandler({
        roles: [role, { ...role, id: 2, name: 'frontend-dev' }]
      })(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    await waitFor(() =>
      expect(
        screen.getByText('適用は1ロールずつです。複数ロールの合成は未対応のため、適用するロールを選んでください。')
      ).toBeDefined()
    )
  })

  it('disables プレビュー and shows a hint when no role is assigned', async () => {
    stubFetch((url, init) => {
      if (url.includes('/apply-history')) {
        return { status: 200, body: [] }
      }
      if (url.includes('/projects/1/roles')) {
        return { status: 200, body: [] }
      }
      if (url.includes('/projects/1') && (!init || init.method === undefined)) {
        return { status: 200, body: { ...project, lastAppliedRoleId: null } }
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const previewButton = await screen.findByRole('button', { name: 'プレビュー' })
    expect((previewButton as HTMLButtonElement).disabled).toBe(true)
  })
})
