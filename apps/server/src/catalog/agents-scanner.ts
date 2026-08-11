// apps/server/src/catalog/agents-scanner.ts
import fs from 'node:fs'
import path from 'node:path'
import { findDirsNamed, parseFrontmatterField } from './scan-helpers.js'

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

export function scanAgents(input: ScanAgentsInput): AgentCandidate[] {
  const candidates: AgentCandidate[] = []

  if (input.userAgentsRoot) {
    candidates.push(...scanDirectAgentChildren(input.userAgentsRoot, 'user'))
  }

  if (input.pluginsCacheRoot) {
    for (const agentsDir of findDirsNamed(input.pluginsCacheRoot, 'agents')) {
      candidates.push(...scanDirectAgentChildren(agentsDir, 'plugin'))
    }
  }

  for (const projectPath of input.projectPaths) {
    const projectAgentsRoot = path.join(projectPath, '.claude', 'agents')
    candidates.push(...scanDirectAgentChildren(projectAgentsRoot, 'project-local'))
  }

  return candidates
}
