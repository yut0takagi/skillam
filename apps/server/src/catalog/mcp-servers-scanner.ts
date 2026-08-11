// apps/server/src/catalog/mcp-servers-scanner.ts
import fs from 'node:fs'
import path from 'node:path'

export interface McpServerCandidate {
  source: 'user' | 'project-local'
  name: string
  command: unknown
}

interface ScanMcpServersInput {
  claudeJsonPath: string
  projectPaths: string[]
}

function readMcpServersObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { mcpServers?: unknown }
    if (parsed && typeof parsed === 'object' && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
      return parsed.mcpServers as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

export function scanMcpServers(input: ScanMcpServersInput): McpServerCandidate[] {
  const candidates: McpServerCandidate[] = []

  const userServers = readMcpServersObject(input.claudeJsonPath)
  for (const [name, command] of Object.entries(userServers)) {
    candidates.push({ source: 'user', name, command })
  }

  for (const projectPath of input.projectPaths) {
    const mcpJsonServers = readMcpServersObject(path.join(projectPath, '.mcp.json'))
    const settingsServers = readMcpServersObject(path.join(projectPath, '.claude', 'settings.json'))
    const merged: Record<string, unknown> = { ...settingsServers, ...mcpJsonServers }
    for (const [name, command] of Object.entries(merged)) {
      candidates.push({ source: 'project-local', name, command })
    }
  }

  return candidates
}
