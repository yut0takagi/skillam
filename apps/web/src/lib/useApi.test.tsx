import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useApi } from './useApi.js'

describe('useApi', () => {
  it('starts in a loading state', () => {
    const { result } = renderHook(() => useApi(async () => ({ ok: true as const, data: 1 })))

    expect(result.current.loading).toBe(true)
  })

  it('exposes the data once resolved', async () => {
    const { result } = renderHook(() => useApi(async () => ({ ok: true as const, data: 42 })))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe(42)
    expect(result.current.error).toBeNull()
  })

  it('exposes the message when the request fails', async () => {
    const { result } = renderHook(() =>
      useApi(async () => ({ ok: false as const, kind: 'network' as const, message: 'つながらない' }))
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('つながらない')
  })

  it('refetches when reload is called', async () => {
    let count = 0
    const { result } = renderHook(() =>
      useApi(async () => {
        count += 1
        return { ok: true as const, data: count }
      })
    )

    await waitFor(() => expect(result.current.data).toBe(1))
    result.current.reload()
    await waitFor(() => expect(result.current.data).toBe(2))
  })

  it('does not set state after unmount', async () => {
    let resolve: (v: { ok: true; data: number }) => void = () => {}
    const pending = new Promise<{ ok: true; data: number }>((r) => { resolve = r })
    const { unmount } = renderHook(() => useApi(() => pending))

    unmount()
    resolve({ ok: true, data: 1 })
    await pending

    // no React "state update on unmounted component" warning should occur
  })
})
