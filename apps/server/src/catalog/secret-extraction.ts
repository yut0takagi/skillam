const PLACEHOLDER_PATTERNS = [/^todo/i, /^your_/i, /^<.*>$/, /^\$\{.*\}$/, /^change_?me$/i]

export function looksLikePlaceholder(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') {
    return true
  }
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export interface SecretToStore {
  refName: string
  value: string
}

export interface ExtractSecretsResult {
  sanitizedEnv: Record<string, string>
  secretsToStore: SecretToStore[]
}

export function extractSecretsFromEnv(
  serverName: string,
  env: Record<string, string>
): ExtractSecretsResult {
  const sanitizedEnv: Record<string, string> = {}
  const secretsToStore: SecretToStore[] = []

  for (const [key, value] of Object.entries(env)) {
    if (looksLikePlaceholder(value)) {
      sanitizedEnv[key] = value
      continue
    }
    const refName = `mcp:${encodeURIComponent(serverName)}:${encodeURIComponent(key)}`
    secretsToStore.push({ refName, value })
    sanitizedEnv[key] = `secret_ref:${refName}`
  }

  return { sanitizedEnv, secretsToStore }
}
