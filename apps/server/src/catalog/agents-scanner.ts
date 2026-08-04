// apps/server/src/catalog/agents-scanner.ts
import fs from 'node:fs'
import path from 'node:path'

export interface AgentCandidate {
  source: 'user' | 'plugin' | 'project-local'
  name: string
  description: string
  markdownBody: string
  path: string
}

interface ScanAgentsInput {
  userAgentsRoot: string | undefined
  pluginsCacheRoot: string | undefined
  projectPaths: string[]
}

const MAX_PLUGIN_SEARCH_DEPTH = 8

function parseFrontmatterField(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))
  return match ? match[1].trim() : undefined
}

function readAgentAt(filePath: string, source: AgentCandidate['source']): AgentCandidate | undefined {
  const content = fs.readFileSync(filePath, 'utf-8')
  const name = parseFrontmatterField(content, 'name')
  if (!name) {
    return undefined
  }
  const description = parseFrontmatterField(content, 'description') ?? ''
  return { source, name, description, markdownBody: content, path: filePath }
}

function scanDirectAgentChildren(
  agentsRoot: string,
  source: AgentCandidate['source']
): AgentCandidate[] {
  if (!fs.existsSync(agentsRoot)) {
    return []
  }
  const candidates: AgentCandidate[] = []
  for (const entry of fs.readdirSync(agentsRoot)) {
    if (!entry.endsWith('.md')) {
      continue
    }
    const entryPath = path.join(agentsRoot, entry)
    let stat: fs.Stats
    try {
      stat = fs.statSync(entryPath)
    } catch {
      continue
    }
    if (!stat.isFile()) {
      continue
    }
    const agent = readAgentAt(entryPath, source)
    if (agent) {
      candidates.push(agent)
    }
  }
  return candidates
}

function findPluginAgentDirs(root: string): string[] {
  const found: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > MAX_PLUGIN_SEARCH_DEPTH) {
      return
    }
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }
      const entryPath = path.join(dir, entry.name)
      let isDir = entry.isDirectory()
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(entryPath).isDirectory()
        } catch {
          continue
        }
      }
      if (!isDir) {
        continue
      }
      if (entry.name === 'agents') {
        found.push(entryPath)
        continue
      }
      walk(entryPath, depth + 1)
    }
  }

  if (fs.existsSync(root)) {
    walk(root, 0)
  }
  return found
}

export function scanAgents(input: ScanAgentsInput): AgentCandidate[] {
  const candidates: AgentCandidate[] = []

  if (input.userAgentsRoot) {
    candidates.push(...scanDirectAgentChildren(input.userAgentsRoot, 'user'))
  }

  if (input.pluginsCacheRoot) {
    for (const agentsDir of findPluginAgentDirs(input.pluginsCacheRoot)) {
      candidates.push(...scanDirectAgentChildren(agentsDir, 'plugin'))
    }
  }

  for (const projectPath of input.projectPaths) {
    const projectAgentsRoot = path.join(projectPath, '.claude', 'agents')
    candidates.push(...scanDirectAgentChildren(projectAgentsRoot, 'project-local'))
  }

  return candidates
}
