import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePagination } from './usePagination.js'

function items(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i)
}

describe('usePagination', () => {
  it('starts at page 1 and slices the current page', () => {
    const { result } = renderHook(() => usePagination(items(60), 25))

    expect(result.current.page).toBe(1)
    expect(result.current.pageItems).toEqual(items(25))
  })

  it('computes pageCount from items length and perPage', () => {
    const { result } = renderHook(() => usePagination(items(60), 25))

    expect(result.current.pageCount).toBe(3)
  })

  it('pageCount is never 0, even for an empty list', () => {
    const { result } = renderHook(() => usePagination(items(0), 25))

    expect(result.current.pageCount).toBe(1)
    expect(result.current.pageItems).toEqual([])
  })

  it('setPage moves to the requested page and slices accordingly', () => {
    const { result } = renderHook(() => usePagination(items(60), 25))

    act(() => result.current.setPage(2))

    expect(result.current.page).toBe(2)
    expect(result.current.pageItems).toEqual(items(60).slice(25, 50))
  })

  it('setPage clamps below 1 up to 1', () => {
    const { result } = renderHook(() => usePagination(items(60), 25))

    act(() => result.current.setPage(0))
    expect(result.current.page).toBe(1)

    act(() => result.current.setPage(-5))
    expect(result.current.page).toBe(1)
  })

  it('setPage clamps above pageCount down to pageCount', () => {
    const { result } = renderHook(() => usePagination(items(60), 25))

    act(() => result.current.setPage(999))

    expect(result.current.page).toBe(3)
    expect(result.current.pageItems).toEqual(items(60).slice(50, 60))
  })

  it('resets to page 1 when items shrink below the current page', () => {
    let data = items(500)
    const { result, rerender } = renderHook(({ data }) => usePagination(data, 25), {
      initialProps: { data }
    })

    act(() => result.current.setPage(8))
    expect(result.current.page).toBe(8)

    data = items(3)
    rerender({ data })

    expect(result.current.page).toBe(1)
    expect(result.current.pageItems).toEqual(items(3))
  })

  it('total reflects the full item count, not just the current page', () => {
    const { result } = renderHook(() => usePagination(items(60), 25))

    expect(result.current.total).toBe(60)
  })

  it('rangeStart/rangeEnd describe the visible slice', () => {
    const { result } = renderHook(() => usePagination(items(60), 25))

    expect(result.current.rangeStart).toBe(1)
    expect(result.current.rangeEnd).toBe(25)

    act(() => result.current.setPage(3))
    expect(result.current.rangeStart).toBe(51)
    expect(result.current.rangeEnd).toBe(60)
  })

  it('rangeStart/rangeEnd are 0 when the list is empty', () => {
    const { result } = renderHook(() => usePagination(items(0), 25))

    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(0)
  })

  it('defaults perPage to 25', () => {
    const { result } = renderHook(() => usePagination(items(60)))

    expect(result.current.pageItems).toHaveLength(25)
    expect(result.current.pageCount).toBe(3)
  })
})
