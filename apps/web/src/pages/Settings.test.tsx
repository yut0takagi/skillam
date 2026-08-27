import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Settings } from './Settings.js'
import type { AutoDetectRoot, SecretSummary } from '../api/types.js'

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

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>
  )
}

const root: AutoDetectRoot = {
  id: 1,
  path: '/Users/dev/Projects',
  createdAt: '2026-01-01T00:00:00.000Z'
}

const secret: SecretSummary = {
  id: 1,
  refName: 'GITHUB_TOKEN',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z'
}

function defaultHandler(url: string) {
  if (url.includes('/auto-detect-roots')) {
    return { status: 200, body: [root] }
  }
  if (url.includes('/secrets')) {
    return { status: 200, body: [secret] }
  }
  return { status: 404, body: { error: 'not found' } }
}

describe('Settings', () => {
  it('lists auto-detect roots', async () => {
    stubFetch(defaultHandler)
    renderSettings()

    await waitFor(() => expect(screen.getByText('/Users/dev/Projects')).toBeDefined())
  })

  it('adds an auto-detect root and reloads the list', async () => {
    let added = false
    let listCallCount = 0
    stubFetch((url, init) => {
      if (url.endsWith('/auto-detect-roots') && init?.method === 'POST') {
        added = true
        return {
          status: 201,
          body: { id: 2, path: '/Users/dev/Other', createdAt: '2026-01-03T00:00:00.000Z' }
        }
      }
      if (url.includes('/auto-detect-roots')) {
        listCallCount += 1
        return { status: 200, body: added ? [root, { id: 2, path: '/Users/dev/Other', createdAt: '2026-01-03T00:00:00.000Z' }] : [root] }
      }
      if (url.includes('/secrets')) {
        return { status: 200, body: [secret] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderSettings()

    await waitFor(() => expect(screen.getByText('/Users/dev/Projects')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    const input = screen.getByRole('textbox', { name: /ルート|パス/ })
    await userEvent.type(input, '/Users/dev/Other')
    await userEvent.click(screen.getByRole('button', { name: 'ルートを追加' }))

    await waitFor(() => expect(screen.getByText('/Users/dev/Other')).toBeDefined())
    expect(listCallCount).toBeGreaterThan(1)
  })

  it('confirms before deleting a root, and cancel sends no DELETE', async () => {
    let deleteCalled = false
    stubFetch((url, init) => {
      if (init?.method === 'DELETE') {
        deleteCalled = true
        return { status: 204, body: undefined }
      }
      return defaultHandler(url)
    })
    renderSettings()

    await waitFor(() => expect(screen.getByText('/Users/dev/Projects')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    const row = screen.getByText('/Users/dev/Projects').closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: '削除' }))

    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'やめる' }))

    expect(deleteCalled).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('deletes a root after confirming', async () => {
    let deleteCalled = false
    let deleted = false
    stubFetch((url, init) => {
      if (url.includes('/auto-detect-roots') && init?.method === 'DELETE') {
        deleteCalled = true
        deleted = true
        return { status: 204, body: undefined }
      }
      if (url.includes('/auto-detect-roots')) {
        return { status: 200, body: deleted ? [] : [root] }
      }
      if (url.includes('/secrets')) {
        return { status: 200, body: [secret] }
      }
      return { status: 404, body: { error: 'not found' } }
    })
    renderSettings()

    await waitFor(() => expect(screen.getByText('/Users/dev/Projects')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    const row = screen.getByText('/Users/dev/Projects').closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: '削除' }))

    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: '実行する' }))

    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(screen.queryByText('/Users/dev/Projects')).toBeNull())
  })

  it('lists secrets without any value shown', async () => {
    stubFetch(defaultHandler)
    renderSettings()

    await waitFor(() => expect(screen.getByText('GITHUB_TOKEN')).toBeDefined())
    expect(screen.getByText('非表示')).toBeDefined()
  })

  it('does not call the reveal endpoint until 表示 is clicked', async () => {
    let revealCalled = false
    stubFetch((url, init) => {
      if (url.includes('/reveal')) {
        revealCalled = true
        return { status: 200, body: { value: 'ghp_supersecret' } }
      }
      return defaultHandler(url)
    })
    renderSettings()

    await waitFor(() => expect(screen.getByText('GITHUB_TOKEN')).toBeDefined())
    expect(revealCalled).toBe(false)

    const userEvent = (await import('@testing-library/user-event')).default
    const row = screen.getByText('GITHUB_TOKEN').closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: '表示' }))

    await waitFor(() => expect(revealCalled).toBe(true))
    await waitFor(() => expect(screen.getByText('ghp_supersecret')).toBeDefined())
    expect(within(row).getByRole('button', { name: '隠す' })).toBeDefined()
  })

  it('confirms before deleting a secret, naming the consequence', async () => {
    let deleteCalled = false
    stubFetch((url, init) => {
      if (url.includes('/secrets/') && init?.method === 'DELETE') {
        deleteCalled = true
        return { status: 204, body: undefined }
      }
      return defaultHandler(url)
    })
    renderSettings()

    await waitFor(() => expect(screen.getByText('GITHUB_TOKEN')).toBeDefined())
    const userEvent = (await import('@testing-library/user-event')).default
    const row = screen.getByText('GITHUB_TOKEN').closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: '削除' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/適用できなくなります|失敗します/)).toBeDefined()
    await userEvent.click(within(dialog).getByRole('button', { name: 'やめる' }))

    expect(deleteCalled).toBe(false)
  })
})
