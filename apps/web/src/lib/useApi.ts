import { useCallback, useEffect, useState } from 'react'
import type { ApiResult } from '../api/client.js'

export interface UseApiState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

export function useApi<T>(fetcher: () => Promise<ApiResult<T>>): UseApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetcher().then((result) => {
      if (cancelled) {
        return
      }
      if (result.ok) {
        setData(result.data)
        setError(null)
      } else {
        setData(null)
        setError(result.message)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
    // `fetcher` is deliberately not a dependency: callers pass inline arrow
    // functions whose identity changes every render, which would loop forever.
    // Re-fetching is explicit, via reload().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])

  return { data, error, loading, reload }
}
