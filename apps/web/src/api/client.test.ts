import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from './client.js'

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  it('returns ok with the parsed body on success', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { id: 1 }))

    const result = await apiRequest<{ id: number }>('/roles/1')

    expect(result).toEqual({ ok: true, data: { id: 1 } })
  })

  it('returns a conflict result for 409 so the caller can say nothing was written', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { error: '衝突しました' }))

    const result = await apiRequest('/projects/1/apply', { method: 'POST' })

    expect(result).toEqual({ ok: false, kind: 'conflict', message: '衝突しました' })
  })

  it('returns a failure result for 500 so the caller can warn about partial writes', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { error: '書き込みに失敗' }))

    const result = await apiRequest('/projects/1/apply', { method: 'POST' })

    expect(result).toEqual({ ok: false, kind: 'failure', message: '書き込みに失敗' })
  })

  it('returns a notFound result for 404', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { error: 'role not found' }))

    const result = await apiRequest('/roles/9999')

    expect(result).toEqual({ ok: false, kind: 'notFound', message: 'role not found' })
  })

  it('returns a badRequest result for 400', async () => {
    vi.stubGlobal('fetch', mockFetch(400, { error: 'name is required' }))

    const result = await apiRequest('/roles', { method: 'POST' })

    expect(result).toEqual({ ok: false, kind: 'badRequest', message: 'name is required' })
  })

  it('reports a network error instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))

    const result = await apiRequest('/roles')

    expect(result).toEqual({
      ok: false,
      kind: 'network',
      message: 'サーバーに接続できません。skillam のサーバーが起動しているか確認してください。'
    })
  })

  it('handles a 204 with no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => {
          throw new Error('no body')
        }
      })
    )

    const result = await apiRequest('/roles/1', { method: 'DELETE' })

    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('falls back to a generic message when the error body has no error field', async () => {
    vi.stubGlobal('fetch', mockFetch(503, { something: 'else' }))

    const result = await apiRequest('/roles')

    expect(result).toEqual({
      ok: false,
      kind: 'failure',
      message: 'リクエストが失敗しました (HTTP 503)'
    })
  })
})
