import { useMemo, useState } from 'react'

export interface UsePaginationResult<T> {
  page: number
  pageCount: number
  pageItems: T[]
  total: number
  rangeStart: number
  rangeEnd: number
  setPage: (page: number) => void
}

function clamp(page: number, pageCount: number): number {
  if (page < 1) return 1
  if (page > pageCount) return pageCount
  return page
}

export function usePagination<T>(items: T[], perPage = 25): UsePaginationResult<T> {
  const [rawPage, setRawPage] = useState(1)

  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / perPage))

  // When `items` shrinks (e.g. the user filters a long list down) the
  // previously selected page may no longer exist. Clamp on read rather than
  // via an effect so there is no render where pageItems is empty just
  // because the page number hasn't caught up yet.
  const page = clamp(rawPage, pageCount)

  const pageItems = useMemo(() => {
    const start = (page - 1) * perPage
    return items.slice(start, start + perPage)
  }, [items, page, perPage])

  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = total === 0 ? 0 : Math.min(page * perPage, total)

  function setPage(next: number) {
    setRawPage(clamp(next, pageCount))
  }

  return { page, pageCount, pageItems, total, rangeStart, rangeEnd, setPage }
}
