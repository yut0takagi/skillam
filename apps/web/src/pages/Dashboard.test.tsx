import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from './Dashboard.js'
import type { Project, ScanCandidate, Role, DriftReport } from '../api/types.js'

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const { status, body } = handler(String(url), init)
      return { ok: status < 400, status, json: async () => body }
    })
  )
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
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

const candidate: ScanCandidate = {
  path: '/Users/dev/other-project',
  name: 'other-project'
}

const role: Role = {
  id: 7,
  name: 'backend-dev',
  description: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function defaultHandler(url: string) {
  if (url.includes('/projects/scan')) {
    return { status: 200, body: [] }
  }
  if (url.includes('/drift')) {
    return { status: 200, body: [] }
  }
  if (url.includes('/projects')) {
    return { status: 200, body: [project] }
  }
  if (url.includes('/roles')) {
    return { status: 200, body: [role] }
  }
  return { status: 404, body: { error: 'not found' } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Dashboard', () => {
  it('lists registered projects with name and path', async () => {
    stubFetch(defaultHandler)
    renderDashboard()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    expect(screen.getByText('/Users/dev/skillam')).toBeDefined()
  })

  it('shows the server error message when the list fails', async () => {
    stubFetch((url) => {
      if (url.includes('/projects/scan')) {
        return { status: 200, body: [] }
      }
      if (url.includes('/roles')) {
        return { status: 200, body: [] }
      }
      return { status: 500, body: { error: 'データベースに接続できません' } }
    })
    renderDashboard()

    await waitFor(() => expect(screen.getByText('データベースに接続できません')).toBeDefined())
  })

  it('shows the empty state when nothing is registered', async () => {
    stubFetch((url) => {
      if (url.includes('/projects/scan')) {
        return { status: 200, body: [] }
      }
      if (url.includes('/roles')) {
        return { status: 200, body: [] }
      }
      if (url.includes('/projects')) {
        return { status: 200, body: [] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderDashboard()

    await waitFor(() =>
      expect(screen.getByText('登録されたプロジェクトはありません。')).toBeDefined()
    )
  })

  it('links each project to /projects/:id', async () => {
    stubFetch(defaultHandler)
    renderDashboard()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    const link = screen.getByRole('link', { name: 'skillam' })
    expect(link.getAttribute('href')).toBe('/projects/1')
  })

  it('lists unregistered candidates separately', async () => {
    stubFetch((url) => {
      if (url.includes('/projects/scan')) {
        return { status: 200, body: [candidate] }
      }
      if (url.includes('/roles')) {
        return { status: 200, body: [role] }
      }
      if (url.includes('/projects')) {
        return { status: 200, body: [project] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderDashboard()

    await waitFor(() => expect(screen.getByText('other-project')).toBeDefined())
    expect(screen.getByText('/Users/dev/other-project')).toBeDefined()
    // still shows the registered section too
    expect(screen.getByText('skillam')).toBeDefined()
  })

  it('registering a candidate calls POST /projects and reloads', async () => {
    let projectsListCallCount = 0
    let registered = false
    stubFetch((url, init) => {
      if (url.includes('/projects/scan')) {
        return { status: 200, body: registered ? [] : [candidate] }
      }
      if (url.includes('/roles')) {
        return { status: 200, body: [role] }
      }
      if (url.endsWith('/projects') && init?.method === 'POST') {
        registered = true
        return {
          status: 201,
          body: {
            id: 2,
            path: candidate.path,
            name: candidate.name,
            autoDetected: false,
            excluded: false,
            lastAppliedRoleId: null,
            lastAppliedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      }
      if (url.endsWith('/projects')) {
        projectsListCallCount += 1
        return { status: 200, body: registered ? [project, { ...project, id: 2, name: candidate.name }] : [project] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderDashboard()

    await waitFor(() => expect(screen.getByText('other-project')).toBeDefined())
    const candidateRow = screen.getByText('other-project').closest('tr') as HTMLElement
    const registerButton = within(candidateRow).getByRole('button', { name: '登録する' })
    registerButton.click()

    await waitFor(() => expect(projectsListCallCount).toBeGreaterThan(1))
    // Once registered, the candidate moves into the registered table, so
    // "other-project" still exists — but the candidates section (and its
    // 登録する button) must be gone.
    await waitFor(() => expect(screen.queryByText('未登録の検出結果')).toBeNull())
    expect(screen.queryByRole('button', { name: '登録する' })).toBeNull()
  })

  it('paginates a long list of unregistered candidates', async () => {
    const manyCandidates: ScanCandidate[] = Array.from({ length: 80 }, (_, i) => ({
      path: `/Users/dev/project-${i}`,
      name: `project-${i}`
    }))
    stubFetch((url) => {
      if (url.includes('/projects/scan')) {
        return { status: 200, body: manyCandidates }
      }
      if (url.includes('/roles')) {
        return { status: 200, body: [role] }
      }
      if (url.endsWith('/projects')) {
        return { status: 200, body: [project] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderDashboard()

    await waitFor(() => expect(screen.getByText('project-0')).toBeDefined())
    expect(screen.getByText('80 件中 1–25 件')).toBeDefined()
    expect(screen.queryByText('project-79')).toBeNull()

    const userEvent = (await import('@testing-library/user-event')).default
    await userEvent.click(screen.getByRole('button', { name: '次へ' }))

    await waitFor(() => expect(screen.getByText('project-25')).toBeDefined())
    expect(screen.queryByText('project-0')).toBeNull()
  })

  it('shows a drift badge with its count for a project with drift', async () => {
    const driftReport: DriftReport = {
      projectId: project.id,
      projectPath: project.path,
      hasDrift: true,
      items: [
        { kind: 'permission-missing', target: 'Bash(git *)', detail: 'missing' },
        { kind: 'mcp-server-missing', target: 'github', detail: 'missing' },
        { kind: 'materialized-missing', target: '/foo', detail: 'missing' }
      ],
      lastAppliedAt: '2026-08-01T00:00:00.000Z'
    }
    stubFetch((url) => {
      if (url.includes('/projects/scan')) {
        return { status: 200, body: [] }
      }
      if (url.includes('/drift')) {
        return { status: 200, body: [driftReport] }
      }
      if (url.includes('/roles')) {
        return { status: 200, body: [role] }
      }
      if (url.includes('/projects')) {
        return { status: 200, body: [project] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderDashboard()

    await waitFor(() => expect(screen.getByText('3件のズレ')).toBeDefined())
  })

  it('shows no drift badge for a clean project', async () => {
    const driftReport: DriftReport = {
      projectId: project.id,
      projectPath: project.path,
      hasDrift: false,
      items: [],
      lastAppliedAt: '2026-08-01T00:00:00.000Z'
    }
    stubFetch((url) => {
      if (url.includes('/projects/scan')) {
        return { status: 200, body: [] }
      }
      if (url.includes('/drift')) {
        return { status: 200, body: [driftReport] }
      }
      if (url.includes('/roles')) {
        return { status: 200, body: [role] }
      }
      if (url.includes('/projects')) {
        return { status: 200, body: [project] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderDashboard()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    expect(screen.queryByText(/件のズレ/)).toBeNull()
  })

  it('shows no drift badge for a never-applied project (not "unknown")', async () => {
    const neverApplied: Project = { ...project, lastAppliedRoleId: null, lastAppliedAt: null }
    const driftReport: DriftReport = {
      projectId: neverApplied.id,
      projectPath: neverApplied.path,
      hasDrift: false,
      items: [],
      lastAppliedAt: null
    }
    stubFetch((url) => {
      if (url.includes('/projects/scan')) {
        return { status: 200, body: [] }
      }
      if (url.includes('/drift')) {
        return { status: 200, body: [driftReport] }
      }
      if (url.includes('/roles')) {
        return { status: 200, body: [role] }
      }
      if (url.includes('/projects')) {
        return { status: 200, body: [neverApplied] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderDashboard()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    expect(screen.queryByText(/件のズレ/)).toBeNull()
    expect(screen.queryByText('unknown')).toBeNull()
  })

  it('a failed /drift request does not break the project list', async () => {
    stubFetch((url) => {
      if (url.includes('/projects/scan')) {
        return { status: 200, body: [] }
      }
      if (url.includes('/drift')) {
        return { status: 500, body: { error: 'drift check failed' } }
      }
      if (url.includes('/roles')) {
        return { status: 200, body: [role] }
      }
      if (url.includes('/projects')) {
        return { status: 200, body: [project] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderDashboard()

    await waitFor(() => expect(screen.getByText('skillam')).toBeDefined())
    expect(screen.getByText('/Users/dev/skillam')).toBeDefined()
    expect(screen.queryByText(/件のズレ/)).toBeNull()
  })

  it('shows the message when registering fails', async () => {
    stubFetch((url, init) => {
      if (url.includes('/projects/scan')) {
        return { status: 200, body: [candidate] }
      }
      if (url.includes('/roles')) {
        return { status: 200, body: [role] }
      }
      if (url.endsWith('/projects') && init?.method === 'POST') {
        return { status: 409, body: { error: 'このパスは既に登録されています' } }
      }
      if (url.endsWith('/projects')) {
        return { status: 200, body: [project] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderDashboard()

    await waitFor(() => expect(screen.getByText('other-project')).toBeDefined())
    const candidateRow = screen.getByText('other-project').closest('tr') as HTMLElement
    const registerButton = within(candidateRow).getByRole('button', { name: '登録する' })
    registerButton.click()

    await waitFor(() =>
      expect(screen.getByText('このパスは既に登録されています')).toBeDefined()
    )
  })
})
