const DEV_BASE_URL = 'http://127.0.0.1:4317'

function baseUrl(): string {
  // The desktop shell injects the real port via preload, because the server
  // takes a dynamic port. A plain browser has no injection, so fall back.
  const injected = (globalThis as { skillam?: { apiBaseUrl?: string } }).skillam?.apiBaseUrl
  return injected ?? DEV_BASE_URL
}

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
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) }
  if (init?.body !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers
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
