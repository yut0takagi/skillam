import { describe, expect, it } from 'vitest'
import { planMaterialize } from './plan-materialize.js'

describe('planMaterialize', () => {
  it('creates a link that does not exist yet', () => {
    const result = planMaterialize({
      desired: [{ kind: 'link', path: '.claude/skills/drawio', target: '/home/u/.claude/skills/drawio' }],
      current: {},
      previouslyManaged: []
    })

    expect(result.operations).toEqual([
      { type: 'create-link', path: '.claude/skills/drawio', target: '/home/u/.claude/skills/drawio' }
    ])
    expect(result.managed).toEqual(['.claude/skills/drawio'])
  })

  it('emits no operation when the link already points at the target', () => {
    const result = planMaterialize({
      desired: [{ kind: 'link', path: '.claude/skills/drawio', target: '/home/u/.claude/skills/drawio' }],
      current: { '.claude/skills/drawio': { kind: 'link', target: '/home/u/.claude/skills/drawio' } },
      previouslyManaged: ['.claude/skills/drawio']
    })

    expect(result.operations).toEqual([])
  })

  it('recreates a link that points somewhere else', () => {
    const result = planMaterialize({
      desired: [{ kind: 'link', path: '.claude/skills/drawio', target: '/new/drawio' }],
      current: { '.claude/skills/drawio': { kind: 'link', target: '/old/drawio' } },
      previouslyManaged: ['.claude/skills/drawio']
    })

    expect(result.operations).toEqual([
      { type: 'create-link', path: '.claude/skills/drawio', target: '/new/drawio' }
    ])
  })

  it('writes an authored agent file whose content differs', () => {
    const result = planMaterialize({
      desired: [{ kind: 'file', path: '.claude/agents/writer.md', content: '# new' }],
      current: { '.claude/agents/writer.md': { kind: 'file', content: '# old' } },
      previouslyManaged: ['.claude/agents/writer.md']
    })

    expect(result.operations).toEqual([
      { type: 'write-file', path: '.claude/agents/writer.md', content: '# new' }
    ])
  })

  it('emits no operation when the authored file content already matches', () => {
    const result = planMaterialize({
      desired: [{ kind: 'file', path: '.claude/agents/writer.md', content: '# same' }],
      current: { '.claude/agents/writer.md': { kind: 'file', content: '# same' } },
      previouslyManaged: ['.claude/agents/writer.md']
    })

    expect(result.operations).toEqual([])
  })

  it('removes an entry that skillam applied last time but the role no longer has', () => {
    const result = planMaterialize({
      desired: [],
      current: { '.claude/skills/drawio': { kind: 'link', target: '/home/u/.claude/skills/drawio' } },
      previouslyManaged: ['.claude/skills/drawio']
    })

    expect(result.operations).toEqual([{ type: 'remove', path: '.claude/skills/drawio' }])
    expect(result.managed).toEqual([])
  })

  it('does not remove a path that skillam never managed', () => {
    const result = planMaterialize({
      desired: [],
      current: { '.claude/skills/manual': { kind: 'link', target: '/somewhere' } },
      previouslyManaged: []
    })

    expect(result.operations).toEqual([])
  })

  it('orders removals before creations', () => {
    const result = planMaterialize({
      desired: [{ kind: 'link', path: '.claude/skills/new', target: '/new' }],
      current: { '.claude/skills/old': { kind: 'link', target: '/old' } },
      previouslyManaged: ['.claude/skills/old']
    })

    expect(result.operations.map((operation) => operation.type)).toEqual(['remove', 'create-link'])
  })

  it('replaces a real file that sits where a link should go', () => {
    const result = planMaterialize({
      desired: [{ kind: 'link', path: '.claude/skills/drawio', target: '/home/u/drawio' }],
      current: { '.claude/skills/drawio': { kind: 'file', content: 'oops' } },
      previouslyManaged: []
    })

    expect(result.operations).toEqual([
      { type: 'create-link', path: '.claude/skills/drawio', target: '/home/u/drawio' }
    ])
  })

  it('still emits a removal for a managed path that is already gone from disk', () => {
    const result = planMaterialize({
      desired: [],
      current: {},
      previouslyManaged: ['.claude/skills/vanished']
    })

    expect(result.operations).toEqual([{ type: 'remove', path: '.claude/skills/vanished' }])
  })
})
