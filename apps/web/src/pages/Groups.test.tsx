import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Groups } from './Groups.js'
import type { Group, Role } from '../api/types.js'

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

function renderGroups() {
  return render(
    <MemoryRouter>
      <Groups />
    </MemoryRouter>
  )
}

const group: Group = {
  id: 1,
  name: 'typescript',
  description: 'TS を使う PJT',
  createdAt: '2026-01-01T00:00:00.000Z'
}

const role: Role = {
  id: 7,
  name: 'ts-dev',
  description: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function baseHandler(groups: Group[] = [group], roles: Role[] = [role]) {
  return (url: string) => {
    if (url.endsWith('/groups')) {
      return { status: 200, body: groups }
    }
    if (url.endsWith('/roles') && !url.includes('/groups/')) {
      return { status: 200, body: roles }
    }
    if (url.includes('/groups/1/roles')) {
      return { status: 200, body: [{ roleId: 7, priority: 0 }] }
    }
    return { status: 200, body: [] }
  }
}

describe('Groups', () => {
  it('lists groups with name and description', async () => {
    stubFetch(baseHandler())
    renderGroups()

    await waitFor(() => expect(screen.getByText('typescript')).toBeDefined())
    expect(screen.getByText('TS を使う PJT')).toBeDefined()
  })

  it('shows an empty state when there are no groups', async () => {
    stubFetch(baseHandler([]))
    renderGroups()

    await waitFor(() => expect(screen.getByText('グループはまだありません。')).toBeDefined())
  })

  it('creates a group', async () => {
    let posted: unknown = null
    stubFetch((url, init) => {
      if (url.endsWith('/groups') && init?.method === 'POST') {
        posted = init.body ? JSON.parse(String(init.body)) : null
        return { status: 201, body: group }
      }
      return baseHandler([])(url)
    })
    renderGroups()

    await waitFor(() => expect(screen.getByText('グループはまだありません。')).toBeDefined())
    screen.getByRole('button', { name: '新規グループ' }).click()

    const nameInput = await screen.findByLabelText('グループ名')
    await userEvent.type(nameInput, 'typescript')
    await userEvent.click(screen.getByRole('button', { name: '作成' }))

    await waitFor(() => expect(posted).toEqual({ name: 'typescript', description: undefined }))
  })

  it('surfaces the server message when a duplicate name is rejected', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/groups') && init?.method === 'POST') {
        return { status: 409, body: { error: 'group typescript already exists' } }
      }
      return baseHandler()(url)
    })
    renderGroups()

    await waitFor(() => expect(screen.getByText('typescript')).toBeDefined())
    screen.getByRole('button', { name: '新規グループ' }).click()
    const nameInput = await screen.findByLabelText('グループ名')
    await userEvent.type(nameInput, 'typescript')
    await userEvent.click(screen.getByRole('button', { name: '作成' }))

    await waitFor(() => expect(screen.getByText('group typescript already exists')).toBeDefined())
  })

  it('opens the role list for a group with the bound roles checked', async () => {
    stubFetch(baseHandler())
    renderGroups()

    await waitFor(() => expect(screen.getByText('typescript')).toBeDefined())
    screen.getByRole('button', { name: 'ロール' }).click()

    await waitFor(() => expect(screen.getByText('このグループが配るロール')).toBeDefined())
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('saves the selected roles for a group', async () => {
    let putBody: unknown = null
    stubFetch((url, init) => {
      if (url.includes('/groups/1/roles') && init?.method === 'PUT') {
        putBody = init.body ? JSON.parse(String(init.body)) : null
        return { status: 200, body: [] }
      }
      return baseHandler()(url)
    })
    renderGroups()

    await waitFor(() => expect(screen.getByText('typescript')).toBeDefined())
    screen.getByRole('button', { name: 'ロール' }).click()
    await waitFor(() => expect(screen.getByText('このグループが配るロール')).toBeDefined())

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    checkbox.click()
    screen.getByRole('button', { name: '保存' }).click()

    await waitFor(() => expect(putBody).toEqual({ roleIds: [] }))
  })

  // Deleting a group drops the binding path, not the projects or roles it
  // linked — the confirmation has to say so.
  it('asks for confirmation before deleting and says what survives', async () => {
    stubFetch(baseHandler())
    renderGroups()

    await waitFor(() => expect(screen.getByText('typescript')).toBeDefined())
    screen.getByRole('button', { name: '削除' }).click()

    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    expect(screen.getByText(/プロジェクトとロール自体は残ります/)).toBeDefined()
  })
})
