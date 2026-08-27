import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Roles } from './Roles.js'
import type { Role } from '../api/types.js'

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

function renderRoles() {
  return render(
    <MemoryRouter>
      <Roles />
    </MemoryRouter>
  )
}

const role: Role = {
  id: 1,
  name: 'backend-dev',
  description: 'バックエンド開発用ロール',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('Roles', () => {
  it('lists roles with name and description', async () => {
    stubFetch((url) => {
      if (url.endsWith('/roles')) {
        return { status: 200, body: [role] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderRoles()

    await waitFor(() => expect(screen.getByText('backend-dev')).toBeDefined())
    expect(screen.getByText('バックエンド開発用ロール')).toBeDefined()
  })

  it('links each role to its editor', async () => {
    stubFetch((url) => {
      if (url.endsWith('/roles')) {
        return { status: 200, body: [role] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderRoles()

    await waitFor(() => expect(screen.getByText('backend-dev')).toBeDefined())
    const link = screen.getByRole('link', { name: 'backend-dev' })
    expect(link.getAttribute('href')).toBe('/roles/1')
  })

  it('creates a role and reloads the list', async () => {
    let created = false
    let listCallCount = 0
    stubFetch((url, init) => {
      if (url.endsWith('/roles') && init?.method === 'POST') {
        created = true
        return {
          status: 201,
          body: { id: 2, name: 'new-role', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
        }
      }
      if (url.endsWith('/roles')) {
        listCallCount += 1
        return { status: 200, body: created ? [role, { ...role, id: 2, name: 'new-role', description: '' }] : [role] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderRoles()

    await waitFor(() => expect(screen.getByText('backend-dev')).toBeDefined())
    await import('@testing-library/user-event').then(async ({ default: userEvent }) => {
      await userEvent.click(screen.getByRole('button', { name: '新規ロール' }))
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'new-role')
      await userEvent.click(screen.getByRole('button', { name: '作成' }))
    })

    await waitFor(() => expect(screen.getByText('new-role')).toBeDefined())
    expect(listCallCount).toBeGreaterThan(1)
  })

  it('shows the server message on a duplicate name', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/roles') && init?.method === 'POST') {
        return { status: 409, body: { error: 'この名前のロールは既に存在します' } }
      }
      if (url.endsWith('/roles')) {
        return { status: 200, body: [role] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderRoles()

    await waitFor(() => expect(screen.getByText('backend-dev')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    await userEvent.click(screen.getByRole('button', { name: '新規ロール' }))
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'backend-dev')
    await userEvent.click(screen.getByRole('button', { name: '作成' }))

    await waitFor(() => expect(screen.getByText('この名前のロールは既に存在します')).toBeDefined())
  })

  it('asks for confirmation before deleting, and cancel sends no DELETE', async () => {
    let deleteCalled = false
    stubFetch((url, init) => {
      if (url.endsWith('/roles') && (!init || init.method === undefined)) {
        return { status: 200, body: [role] }
      }
      if (init?.method === 'DELETE') {
        deleteCalled = true
        return { status: 204, body: undefined }
      }
      return { status: 200, body: [role] }
    })
    renderRoles()

    await waitFor(() => expect(screen.getByText('backend-dev')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    const row = screen.getByText('backend-dev').closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: '削除' }))

    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'やめる' }))

    expect(deleteCalled).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('deletes after confirming', async () => {
    let deleteCalled = false
    let deleted = false
    stubFetch((url, init) => {
      if (init?.method === 'DELETE') {
        deleteCalled = true
        deleted = true
        return { status: 204, body: undefined }
      }
      if (url.endsWith('/roles')) {
        return { status: 200, body: deleted ? [] : [role] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderRoles()

    await waitFor(() => expect(screen.getByText('backend-dev')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    const row = screen.getByText('backend-dev').closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: '削除' }))

    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: '実行する' }))

    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(screen.queryByText('backend-dev')).toBeNull())
  })
})
