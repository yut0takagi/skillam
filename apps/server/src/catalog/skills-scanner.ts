// apps/server/src/catalog/skills-scanner.ts
import fs from 'node:fs'
import path from 'node:path'

export interface SkillCandidate {
  source: 'user' | 'plugin' | 'project-local'
  name: string
  description: string
  path: string
}

interface ScanSkillsInput {
  userSkillsRoot: string | undefined
  pluginsCacheRoot: string | undefined
  projectPaths: string[]
}

const MAX_PLUGIN_SEARCH_DEPTH = 8

function parseFrontmatterField(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))
  return match ? match[1].trim() : undefined
}

function readSkillAt(dir: string, source: SkillCandidate['source']): SkillCandidate | undefined {
  const skillMdPath = path.join(dir, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) {
    return undefined
  }
  const content = fs.readFileSync(skillMdPath, 'utf-8')
  const name = parseFrontmatterField(content, 'name')
  const description = parseFrontmatterField(content, 'description')
  if (!name || !description) {
    return undefined
  }
  return { source, name, description, path: dir }
}

function scanDirectSkillChildren(
  skillsRoot: string,
  source: SkillCandidate['source']
): SkillCandidate[] {
  if (!fs.existsSync(skillsRoot)) {
    return []
  }
  const candidates: SkillCandidate[] = []
  for (const entry of fs.readdirSync(skillsRoot)) {
    const entryPath = path.join(skillsRoot, entry)
    let stat: fs.Stats
    try {
      stat = fs.statSync(entryPath)
    } catch {
      continue
    }
    if (!stat.isDirectory()) {
      continue
    }
    const skill = readSkillAt(entryPath, source)
    if (skill) {
      candidates.push(skill)
    }
  }
  return candidates
}

function findPluginSkillDirs(root: string): string[] {
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
      if (entry.name === 'skills') {
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

export function scanSkills(input: ScanSkillsInput): SkillCandidate[] {
  const candidates: SkillCandidate[] = []

  if (input.userSkillsRoot) {
    candidates.push(...scanDirectSkillChildren(input.userSkillsRoot, 'user'))
  }

  if (input.pluginsCacheRoot) {
    for (const skillsDir of findPluginSkillDirs(input.pluginsCacheRoot)) {
      candidates.push(...scanDirectSkillChildren(skillsDir, 'plugin'))
    }
  }

  for (const projectPath of input.projectPaths) {
    const projectSkillsRoot = path.join(projectPath, '.claude', 'skills')
    candidates.push(...scanDirectSkillChildren(projectSkillsRoot, 'project-local'))
  }

  return candidates
}
