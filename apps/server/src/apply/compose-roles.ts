import path from 'node:path'
import type { RolePermissionsShape } from './plan-settings.js'

// Where a role reached this project from. Kept on every composed item so the
// preview can answer "why is this skill here?" — with three binding paths, an
// unexplained entry is the difference between a tool someone chose and one
// that arrived because of where the directory happens to sit.
export type BindingOrigin =
  | { kind: 'scope'; path: string }
  | { kind: 'group'; name: string }
  | { kind: 'direct' }

export interface BindingSkill {
  skillSource: string
  skillPath: string
}

export interface BindingAgent {
  name: string
  markdownBody: string
  source: 'reference' | 'authored'
  sourcePath: string
}

export interface BindingMcpServer {
  name: string
  command: unknown
  env: Record<string, string>
}

export interface RoleBinding {
  roleId: number
  origin: BindingOrigin
  priority: number
  skills: BindingSkill[]
  agents: BindingAgent[]
  mcpServers: BindingMcpServer[]
  permissions: RolePermissionsShape
}

export interface ComposedSkill extends BindingSkill {
  name: string
  origin: BindingOrigin
}

export interface ComposedAgent extends BindingAgent {
  origin: BindingOrigin
}

export interface ComposedMcpServer extends BindingMcpServer {
  origin: BindingOrigin
}

export interface SuppressedAllow {
  entry: string
  deniedBy: BindingOrigin
}

export interface ComposedRole {
  skills: ComposedSkill[]
  agents: ComposedAgent[]
  mcpServers: ComposedMcpServer[]
  permissions: { allow: string[]; deny: string[] }
  // Entries a deny removed from allow. Reported rather than silently dropped:
  // without it, someone who granted a permission and finds it missing has no
  // way to discover which binding took it away.
  suppressedAllow: SuppressedAllow[]
}

export interface CompositionConflict {
  kind: 'skill' | 'agent' | 'mcpServer'
  name: string
  origins: BindingOrigin[]
}

function describeOrigin(origin: BindingOrigin): string {
  switch (origin.kind) {
    case 'scope':
      return `スコープ ${origin.path}`
    case 'group':
      return `グループ ${origin.name}`
    case 'direct':
      return '直接割り当て'
  }
}

const KIND_LABELS: Record<CompositionConflict['kind'], string> = {
  skill: 'Skill',
  agent: 'Agent',
  mcpServer: 'MCP サーバー'
}

// Thrown when two bindings contribute the same name pointing at different
// things. skillam refuses instead of letting precedence pick a winner: the
// preview shows the resulting diff, not the fact that two bindings disagreed,
// so a silent choice would install something the user never selected without
// any signal that a decision was made on their behalf. Same contract as
// GitTrackedTargetError — when the intent is ambiguous, stop and let a person
// decide.
export class RoleCompositionConflictError extends Error {
  readonly conflicts: CompositionConflict[]

  constructor(conflicts: CompositionConflict[]) {
    const details = conflicts
      .map(
        (conflict) =>
          `${KIND_LABELS[conflict.kind]} "${conflict.name}"（${conflict.origins
            .map(describeOrigin)
            .join(' と ')}）`
      )
      .join('、')
    super(
      `複数のロールが同じ名前で異なる内容を割り当てています: ${details}。` +
        'skillam はどちらを使うか推測しません。片方をロールから外すか、内容を揃えてください。'
    )
    this.name = 'RoleCompositionConflictError'
    this.conflicts = conflicts
  }
}

const ORIGIN_RANK: Record<BindingOrigin['kind'], number> = {
  scope: 0,
  group: 1,
  direct: 2
}

// Weakest first: scope, then group, then direct. Deeper scopes come after
// shallower ones so /work/company follows /work, matching the intuition that
// the more specific directory speaks last. Order decides only which origin is
// reported for a duplicate — the material itself is a union either way.
function compareBindings(a: RoleBinding, b: RoleBinding): number {
  const byKind = ORIGIN_RANK[a.origin.kind] - ORIGIN_RANK[b.origin.kind]
  if (byKind !== 0) {
    return byKind
  }
  if (a.origin.kind === 'scope' && b.origin.kind === 'scope') {
    const byDepth = a.origin.path.split(path.sep).length - b.origin.path.split(path.sep).length
    if (byDepth !== 0) {
      return byDepth
    }
  }
  if (a.priority !== b.priority) {
    return a.priority - b.priority
  }
  return a.roleId - b.roleId
}

// Structural equality over the fields that decide what lands on disk. Used to
// tell a harmless duplicate (two bindings asking for the same thing) apart
// from a genuine conflict (two bindings asking for different things under one
// name).
function sameContent(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

interface Collected<T> {
  item: T
  origin: BindingOrigin
}

// Collects named items across bindings, folding exact duplicates and recording
// a conflict when one name carries two different payloads. Conflicts are
// accumulated rather than thrown here so a single failed apply can report
// every disagreement at once instead of surfacing them one run at a time.
function collectNamed<Source, Item>(
  bindings: RoleBinding[],
  kind: CompositionConflict['kind'],
  select: (binding: RoleBinding) => Source[],
  nameOf: (source: Source) => string,
  build: (source: Source, origin: BindingOrigin) => Item,
  identityOf: (source: Source) => unknown,
  conflicts: CompositionConflict[]
): Item[] {
  const byName = new Map<
    string,
    Collected<Item> & { identity: unknown; origins: BindingOrigin[]; roleId: number }
  >()
  // Duplicates within a single role are kept here rather than folded, so the
  // materialize step still sees both and reports the destination-path clash it
  // has always reported. Composition only arbitrates *between* bindings.
  const passthrough: Item[] = []

  for (const binding of bindings) {
    for (const source of select(binding)) {
      const name = nameOf(source)
      const identity = identityOf(source)
      const existing = byName.get(name)
      if (!existing) {
        byName.set(name, {
          item: build(source, binding.origin),
          origin: binding.origin,
          identity,
          origins: [binding.origin],
          roleId: binding.roleId
        })
        continue
      }
      if (sameContent(existing.identity, identity)) {
        continue
      }
      // A name colliding inside one role is a broken role definition, not a
      // disagreement between bindings. Telling the user to unbind one of two
      // roles would be wrong when there is only one, so it goes downstream
      // untouched.
      if (existing.roleId === binding.roleId) {
        passthrough.push(build(source, binding.origin))
        continue
      }
      existing.origins.push(binding.origin)
    }
  }

  const items: Item[] = []
  for (const [name, entry] of byName) {
    if (entry.origins.length > 1) {
      conflicts.push({ kind, name, origins: entry.origins })
      continue
    }
    items.push(entry.item)
  }
  return [...items, ...passthrough]
}

function unionEntries(bindings: RoleBinding[], select: (binding: RoleBinding) => string[]): string[] {
  const seen = new Set<string>()
  const union: string[] = []
  for (const binding of bindings) {
    for (const entry of select(binding)) {
      if (!seen.has(entry)) {
        seen.add(entry)
        union.push(entry)
      }
    }
  }
  return union
}

export function composeRoles(bindings: RoleBinding[]): ComposedRole {
  const ordered = [...bindings].sort(compareBindings)
  const conflicts: CompositionConflict[] = []

  const skills = collectNamed<BindingSkill, ComposedSkill>(
    ordered,
    'skill',
    (binding) => binding.skills,
    (skill) => path.basename(skill.skillPath),
    (skill, origin) => ({ ...skill, name: path.basename(skill.skillPath), origin }),
    (skill) => skill.skillPath,
    conflicts
  )

  const agents = collectNamed<BindingAgent, ComposedAgent>(
    ordered,
    'agent',
    (binding) => binding.agents,
    (agent) => agent.name,
    (agent, origin) => ({ ...agent, origin }),
    (agent) => [agent.markdownBody, agent.source, agent.sourcePath],
    conflicts
  )

  const mcpServers = collectNamed<BindingMcpServer, ComposedMcpServer>(
    ordered,
    'mcpServer',
    (binding) => binding.mcpServers,
    (server) => server.name,
    (server, origin) => ({ ...server, origin }),
    // env carries secret references, so two bindings pointing one server at
    // different credentials has to count as a conflict, not a duplicate.
    (server) => [server.command, server.env],
    conflicts
  )

  if (conflicts.length > 0) {
    throw new RoleCompositionConflictError(conflicts)
  }

  const deny = unionEntries(ordered, (binding) => binding.permissions.deny ?? [])
  const allowUnion = unionEntries(ordered, (binding) => binding.permissions.allow ?? [])

  // The one place precedence is deliberately inverted: a deny wins over an
  // allow regardless of which binding it came from. Without this an
  // organisation-wide restriction could be voided by a direct binding on the
  // very project it was meant to constrain.
  const denySet = new Set(deny)
  const allow = allowUnion.filter((entry) => !denySet.has(entry))

  const suppressedAllow: SuppressedAllow[] = []
  for (const entry of allowUnion) {
    if (!denySet.has(entry)) {
      continue
    }
    const source = ordered.find((binding) => (binding.permissions.deny ?? []).includes(entry))
    if (source) {
      suppressedAllow.push({ entry, deniedBy: source.origin })
    }
  }

  return { skills, agents, mcpServers, permissions: { allow, deny }, suppressedAllow }
}
