import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Scopes } from './Scopes.js'
import type { Project, Role, Scope } from '../api/types.js'

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

function renderScopes() {
  return render(
    <MemoryRouter>
      <Scopes />
    </MemoryRouter>
  )
}

const scope: Scope = {
  id: 1,
  path: '/Users/dev/work',
  createdAt: '2026-01-01T00:00:00.000Z'
}

const role: Role = {
  id: 7,
  name: 'company',
  description: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function baseHandler(scopes: Scope[] = [scope], roles: Role[] = [role]) {
  return (url: string) => {
    if (url.endsWith('/scopes')) {
      return { status: 200, body: scopes }
    }
    if (url.endsWith('/roles') && !url.includes('/scopes/')) {
      return { status: 200, body: roles }
    }
    if (url.includes('/scopes/1/roles')) {
      return { status: 200, body: [{ roleId: 7, priority: 0 }] }
    }
    return { status: 200, body: [] }
  }
}

describe('Scopes', () => {
  it('lists scopes by path', async () => {
    stubFetch(baseHandler())
    renderScopes()

    await waitFor(() => expect(screen.getByText('/Users/dev/work')).toBeDefined())
  })

  it('shows an empty state when there are no scopes', async () => {
    stubFetch(baseHandler([]))
    renderScopes()

    await waitFor(() => expect(screen.getByText('スコープはまだありません。')).toBeDefined())
  })

  it('creates a scope', async () => {
    let posted: unknown = null
    stubFetch((url, init) => {
      if (url.endsWith('/scopes') && init?.method === 'POST') {
        posted = init.body ? JSON.parse(String(init.body)) : null
        return { status: 201, body: scope }
      }
      return baseHandler([])(url)
    })
    renderScopes()

    await waitFor(() => expect(screen.getByText('スコープはまだありません。')).toBeDefined())
    screen.getByRole('button', { name: '新規スコープ' }).click()

    const pathInput = await screen.findByLabelText('スコープのパス')
    await userEvent.type(pathInput, '/Users/dev/work')
    await userEvent.click(screen.getByRole('button', { name: '作成' }))

    await waitFor(() => expect(posted).toEqual({ path: '/Users/dev/work' }))
  })

  // The server rejects a relative path because it could never match an
  // absolute project path; the page has to show that reason, not swallow it.
  it('surfaces the server message when a relative path is rejected', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/scopes') && init?.method === 'POST') {
        return { status: 400, body: { error: 'path must be absolute' } }
      }
      return baseHandler([])(url)
    })
    renderScopes()

    await waitFor(() => expect(screen.getByText('スコープはまだありません。')).toBeDefined())
    screen.getByRole('button', { name: '新規スコープ' }).click()
    const pathInput = await screen.findByLabelText('スコープのパス')
    await userEvent.type(pathInput, 'work/app')
    await userEvent.click(screen.getByRole('button', { name: '作成' }))

    await waitFor(() => expect(screen.getByText('path must be absolute')).toBeDefined())
  })

  it('opens the role list for a scope with the bound roles checked', async () => {
    stubFetch(baseHandler())
    renderScopes()

    await waitFor(() => expect(screen.getByText('/Users/dev/work')).toBeDefined())
    screen.getByRole('button', { name: 'ロール' }).click()

    await waitFor(() => expect(screen.getByText('このスコープが配るロール')).toBeDefined())
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('saves the selected roles for a scope', async () => {
    let putBody: unknown = null
    stubFetch((url, init) => {
      if (url.includes('/scopes/1/roles') && init?.method === 'PUT') {
        putBody = init.body ? JSON.parse(String(init.body)) : null
        return { status: 200, body: [] }
      }
      return baseHandler()(url)
    })
    renderScopes()

    await waitFor(() => expect(screen.getByText('/Users/dev/work')).toBeDefined())
    screen.getByRole('button', { name: 'ロール' }).click()
    await waitFor(() => expect(screen.getByText('このスコープが配るロール')).toBeDefined())

    ;(screen.getByRole('checkbox') as HTMLInputElement).click()
    screen.getByRole('button', { name: '保存' }).click()

    await waitFor(() => expect(putBody).toEqual({ roleIds: [] }))
  })

  it('warns that projects under the path lose the role before deleting', async () => {
    stubFetch(baseHandler())
    renderScopes()

    await waitFor(() => expect(screen.getByText('/Users/dev/work')).toBeDefined())
    screen.getByRole('button', { name: '削除' }).click()

    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    expect(screen.getByText(/ロールが届かなくなります/)).toBeDefined()
  })

  // A scope binds by path, so its reach is invisible: the list shows a path
  // and some roles, and nothing says which projects that actually covers.
  it('lists the projects a scope reaches', async () => {
    const reached: Project[] = [
      {
        id: 5,
        path: '/Users/dev/work/app',
        name: 'app',
        autoDetected: true,
        excluded: false,
        lastAppliedRoleId: null,
        lastAppliedAt: null,
        createdAt: 'x',
        updatedAt: 'x'
      }
    ]
    stubFetch((url) => {
      if (url.includes('/scopes/1/projects')) {
        return { status: 200, body: reached }
      }
      return baseHandler()(url)
    })
    renderScopes()

    await userEvent.click(await screen.findByRole('button', { name: '対象PJT' }))

    await waitFor(() => expect(screen.getByText('app')).toBeDefined())
    expect(screen.getByText('/Users/dev/work/app')).toBeDefined()
  })

  // An excluded project still matches the path. Hiding it turns "excluded on
  // purpose" into "missing for no visible reason".
  it('marks a reached project that is excluded', async () => {
    const reached: Project[] = [
      {
        id: 5,
        path: '/Users/dev/work/app',
        name: 'app',
        autoDetected: true,
        excluded: true,
        lastAppliedRoleId: null,
        lastAppliedAt: null,
        createdAt: 'x',
        updatedAt: 'x'
      }
    ]
    stubFetch((url) => {
      if (url.includes('/scopes/1/projects')) {
        return { status: 200, body: reached }
      }
      return baseHandler()(url)
    })
    renderScopes()

    await userEvent.click(await screen.findByRole('button', { name: '対象PJT' }))

    await waitFor(() => expect(screen.getByText('除外')).toBeDefined())
  })

  it('says so when a scope reaches nothing', async () => {
    stubFetch((url) => {
      if (url.includes('/scopes/1/projects')) {
        return { status: 200, body: [] }
      }
      return baseHandler()(url)
    })
    renderScopes()

    await userEvent.click(await screen.findByRole('button', { name: '対象PJT' }))

    await waitFor(() =>
      expect(screen.getByText('このスコープに当たるプロジェクトはありません。')).toBeDefined()
    )
  })

})
