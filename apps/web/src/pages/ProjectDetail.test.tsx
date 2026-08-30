import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDetail } from './ProjectDetail.js'
import type { ApplyHistoryEntry, ApplyPlan, DriftReport, Project, Role } from '../api/types.js'

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
  origins: [],
  suppressedAllow: [],
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

const cleanDrift: DriftReport = {
  projectId: 1,
  projectPath: '/Users/dev/skillam',
  hasDrift: false,
  items: [],
  lastAppliedAt: '2026-08-01T00:00:00.000Z'
}

function baseHandler(overrides: {
  history?: ApplyHistoryEntry[]
  roles?: Role[]
  project?: Project
  drift?: DriftReport | { status: number; body: unknown }
} = {}) {
  const history = overrides.history ?? [historyEntry]
  const roles = overrides.roles ?? [role]
  const proj = overrides.project ?? project
  const drift = overrides.drift ?? cleanDrift

  return (url: string, init?: RequestInit) => {
    if (url.includes('/projects/1/drift')) {
      if (drift && typeof drift === 'object' && 'status' in drift) {
        return drift
      }
      return { status: 200, body: drift }
    }
    if (url.includes('/apply-history')) {
      return { status: 200, body: history }
    }
    if (url.endsWith('/roles') && !url.includes('/projects/')) {
      return { status: 200, body: roles }
    }
    if (url.includes('/projects/1/groups')) {
      return { status: 200, body: [] }
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

  // Composed apply is the default: every binding path reaching the project is
  // applied at once. Sending a roleId would ask for one role in isolation and
  // silently drop the group and scope bindings.
  it('previews without a roleId so every binding is composed', async () => {
    let previewBody: unknown = 'not-called'
    stubFetch((url, init) => {
      if (url.includes('/apply/preview')) {
        previewBody = init?.body ? JSON.parse(String(init.body)) : null
        return { status: 200, body: plan }
      }
      if (url.includes('/projects/1/roles') && (!init || init.method === undefined || init.method === 'GET')) {
        return { status: 200, body: [{ roleId: 2, priority: 0 }, { roleId: 7, priority: 1 }] }
      }
      return baseHandler({ roles: [role, { ...role, id: 2, name: 'frontend-dev' }] })(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const previewButton = await screen.findByRole('button', { name: 'プレビュー' })
    previewButton.click()

    await waitFor(() => expect(previewBody).toEqual({}))
  })

  it('applies without a roleId so every binding is composed', async () => {
    let applyBody: unknown = 'not-called'
    stubFetch((url, init) => {
      if (url.includes('/apply/preview')) {
        return { status: 200, body: plan }
      }
      if (url.includes('/apply') && init?.method === 'POST') {
        applyBody = init.body ? JSON.parse(String(init.body)) : null
        return { status: 200, body: { status: 'success', historyId: 1, plan } }
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    ;(await screen.findByRole('button', { name: 'プレビュー' })).click()
    const applyButton = await screen.findByRole('button', { name: '適用する' })
    applyButton.click()

    await waitFor(() => expect(applyBody).toEqual({}))
  })

  it('no longer offers a single-role selector', async () => {
    stubFetch((url, init) => {
      if (url.includes('/projects/1/roles') && (!init || init.method === undefined || init.method === 'GET')) {
        return { status: 200, body: [{ roleId: 2, priority: 0 }, { roleId: 7, priority: 1 }] }
      }
      return baseHandler({ roles: [role, { ...role, id: 2, name: 'frontend-dev' }] })(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    expect(screen.queryByLabelText('適用するロール')).toBeNull()
  })

  it('lists the groups a project belongs to as a binding path', async () => {
    stubFetch((url, init) => {
      if (url.includes('/projects/1/groups')) {
        return { status: 200, body: [{ id: 3, name: 'typescript', description: '', createdAt: 'x' }] }
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('typescript')).toBeDefined())
    expect(screen.getAllByText('グループ').length).toBeGreaterThan(0)
  })

  it('shows where each item came from after preview', async () => {
    const planWithOrigins: ApplyPlan = {
      ...plan,
      origins: [
        { kind: 'skill', name: 'playwright', origin: { kind: 'group', name: 'typescript' } },
        { kind: 'skill', name: 'drawio', origin: { kind: 'scope', path: '/Users/dev/work' } }
      ]
    }
    stubFetch((url, init) => {
      if (url.includes('/apply/preview')) {
        return { status: 200, body: planWithOrigins }
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    ;(await screen.findByRole('button', { name: 'プレビュー' })).click()

    await waitFor(() => expect(screen.getByText('playwright')).toBeDefined())
    expect(screen.getByText('グループ typescript')).toBeDefined()
    expect(screen.getByText('スコープ /Users/dev/work')).toBeDefined()
  })

  // A permission that vanishes with no explanation is the failure this display
  // exists to prevent.
  it('shows which binding denied an allow that was dropped', async () => {
    const planWithSuppressed: ApplyPlan = {
      ...plan,
      suppressedAllow: [
        { entry: 'Bash(rm -rf*)', deniedBy: { kind: 'scope', path: '/Users/dev/work' } }
      ]
    }
    stubFetch((url, init) => {
      if (url.includes('/apply/preview')) {
        return { status: 200, body: planWithSuppressed }
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    ;(await screen.findByRole('button', { name: 'プレビュー' })).click()

    await waitFor(() => expect(screen.getByText('deny で落ちた許可')).toBeDefined())
    expect(screen.getByText('Bash(rm -rf*)')).toBeDefined()
    expect(screen.getByText('スコープ /Users/dev/work')).toBeDefined()
  })

  it('renders drift items with kind, target, and detail', async () => {
    const driftReport: DriftReport = {
      projectId: 1,
      projectPath: '/Users/dev/skillam',
      hasDrift: true,
      items: [
        { kind: 'permission-missing', target: 'Bash(git *)', detail: '権限が見つかりません' },
        { kind: 'mcp-server-missing', target: 'github', detail: 'MCPサーバーが見つかりません' }
      ],
      lastAppliedAt: '2026-08-01T00:00:00.000Z'
    }
    stubFetch(baseHandler({ drift: driftReport }))
    renderDetail()

    await waitFor(() => expect(screen.getByText('Bash(git *)')).toBeDefined())
    expect(screen.getByText('権限が見つかりません')).toBeDefined()
    const driftRows = screen.getAllByTestId('drift-row')
    expect(driftRows).toHaveLength(2)
    expect(within(driftRows[1]).getByText('github')).toBeDefined()
    expect(screen.getByText('MCPサーバーが見つかりません')).toBeDefined()
  })

  it('shows the server 409 message instead of a generic error when drift config is unparsable', async () => {
    stubFetch(
      baseHandler({
        drift: { status: 409, body: { error: '.claude/settings.json が壊れています' } }
      })
    )
    renderDetail()

    await waitFor(() => expect(screen.getByText('.claude/settings.json が壊れています')).toBeDefined())
  })

  // Preview stays enabled with nothing directly assigned: a scope binding
  // matches by path and is invisible from here, so only the server can say
  // whether anything reaches this project.
  it('keeps プレビュー enabled when no role is directly assigned', async () => {
    stubFetch((url, init) => {
      if (url.includes('/apply-history')) {
        return { status: 200, body: [] }
      }
      if (url.includes('/projects/1/groups')) {
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
    expect((previewButton as HTMLButtonElement).disabled).toBe(false)
  })

  // Group membership was display-only: the API existed from the start but no
  // screen called it, so the whole group binding path was unreachable without
  // hand-crafting a PUT.
  it('saves group membership from the sidebar', async () => {
    const requests: { url: string; body: unknown }[] = []
    stubFetch((url, init) => {
      if (url.endsWith('/groups') && !url.includes('/projects/')) {
        return {
          status: 200,
          body: [
            { id: 3, name: 'typescript', description: '', createdAt: 'x', updatedAt: 'x' },
            { id: 4, name: 'infra', description: '', createdAt: 'x', updatedAt: 'x' }
          ]
        }
      }
      if (url.includes('/projects/1/groups') && init?.method === 'PUT') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return { status: 200, body: [] }
      }
      if (url.includes('/projects/1/groups')) {
        return { status: 200, body: [{ id: 3, name: 'typescript', description: '', createdAt: 'x' }] }
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    const infra = await screen.findByLabelText('infra')
    await userEvent.click(infra)
    await userEvent.click(screen.getByRole('button', { name: 'グループを保存' }))

    await waitFor(() => expect(requests.length).toBe(1))
    expect(requests[0].body).toEqual({ groupIds: [3, 4] })
  })

  it('starts with the groups the project already belongs to checked', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/groups') && !url.includes('/projects/')) {
        return {
          status: 200,
          body: [
            { id: 3, name: 'typescript', description: '', createdAt: 'x', updatedAt: 'x' },
            { id: 4, name: 'infra', description: '', createdAt: 'x', updatedAt: 'x' }
          ]
        }
      }
      if (url.includes('/projects/1/groups')) {
        return { status: 200, body: [{ id: 4, name: 'infra', description: '', createdAt: 'x' }] }
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    const infra = (await screen.findByLabelText('infra')) as HTMLInputElement
    await waitFor(() => expect(infra.checked).toBe(true))
    expect((screen.getByLabelText('typescript') as HTMLInputElement).checked).toBe(false)
  })

  it('reports a failure to save group membership', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/groups') && !url.includes('/projects/')) {
        return {
          status: 200,
          body: [{ id: 3, name: 'typescript', description: '', createdAt: 'x', updatedAt: 'x' }]
        }
      }
      if (url.includes('/projects/1/groups') && init?.method === 'PUT') {
        return { status: 400, body: { error: 'group 3 not found' } }
      }
      if (url.includes('/projects/1/groups')) {
        return { status: 200, body: [] }
      }
      return baseHandler()(url, init)
    })
    renderDetail()

    await userEvent.click(await screen.findByLabelText('typescript'))
    await userEvent.click(screen.getByRole('button', { name: 'グループを保存' }))

    await waitFor(() => expect(screen.getByText('group 3 not found')).toBeDefined())
  })

})
