const BASE_URL = 'http://127.0.0.1:4317'

export type ApiErrorKind = 'badRequest' | 'notFound' | 'conflict' | 'failure' | 'network'

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ApiErrorKind; message: string }

function kindForStatus(status: number): ApiErrorKind {
  if (status === 404) {
    return 'notFound'
  }
  if (status === 409) {
    return 'conflict'
  }
  if (status >= 400 && status < 500) {
    return 'badRequest'
  }
  return 'failure'
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {})
      }
    })
  } catch {
    return {
      ok: false,
      kind: 'network',
      message: 'サーバーに接続できません。skillam のサーバーが起動しているか確認してください。'
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  if (response.ok) {
    return { ok: true, data: body as T }
  }

  const message =
    typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `リクエストが失敗しました (HTTP ${response.status})`

  return { ok: false, kind: kindForStatus(response.status), message }
}
