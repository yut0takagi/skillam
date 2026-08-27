export interface PaginationProps {
  page: number
  pageCount: number
  total: number
  rangeStart: number
  rangeEnd: number
  onChange: (page: number) => void
}

const WINDOW = 2

/**
 * Builds a windowed list of page numbers with ellipsis markers, always
 * including page 1 and pageCount. E.g. for page=9, pageCount=22:
 * [1, '…', 7, 8, 9, 10, 11, '…', 22]
 */
function buildPageWindow(page: number, pageCount: number): (number | 'ellipsis')[] {
  const pages = new Set<number>()
  pages.add(1)
  pages.add(pageCount)
  for (let p = page - WINDOW; p <= page + WINDOW; p++) {
    if (p >= 1 && p <= pageCount) {
      pages.add(p)
    }
  }

  const sorted = [...pages].sort((a, b) => a - b)
  const result: (number | 'ellipsis')[] = []
  let prev: number | null = null
  for (const p of sorted) {
    if (prev !== null && p - prev > 1) {
      result.push('ellipsis')
    }
    result.push(p)
    prev = p
  }
  return result
}

export function Pagination({ page, pageCount, total, rangeStart, rangeEnd, onChange }: PaginationProps) {
  if (pageCount <= 1) {
    return null
  }

  const pageWindow = buildPageWindow(page, pageCount)

  return (
    <nav className="pagination" aria-label="ページ送り">
      <p className="pagination-label">
        {total} 件中 {rangeStart}–{rangeEnd} 件
      </p>
      <div className="pagination-pages">
        <button type="button" className="page-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          前へ
        </button>
        {pageWindow.map((entry, index) =>
          entry === 'ellipsis' ? (
            <span key={`ellipsis-${index}`} className="page-ellipsis" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              className="page-btn"
              aria-current={entry === page ? 'page' : undefined}
              onClick={() => onChange(entry)}
            >
              {entry}
            </button>
          )
        )}
        <button
          type="button"
          className="page-btn"
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
        >
          次へ
        </button>
      </div>
    </nav>
  )
}
