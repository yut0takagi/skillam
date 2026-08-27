import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DiffView } from './DiffView.js'

describe('DiffView', () => {
  it('shows the file path', () => {
    render(<DiffView change={{ path: '/p/.claude/settings.json', before: null, after: '{}\n' }} />)

    expect(screen.getByText('/p/.claude/settings.json')).toBeDefined()
  })

  it('labels a file that does not exist yet as new', () => {
    render(<DiffView change={{ path: '/p/.mcp.json', before: null, after: '{}\n' }} />)

    expect(screen.getByText('新規作成')).toBeDefined()
  })

  it('says there is no change when before and after match', () => {
    render(<DiffView change={{ path: '/p/.mcp.json', before: '{}\n', after: '{}\n' }} />)

    expect(screen.getByText('変更なし')).toBeDefined()
  })

  it('renders added and removed lines with distinguishable roles', () => {
    render(<DiffView change={{ path: '/p/x.json', before: 'old\n', after: 'new\n' }} />)

    expect(screen.getByText('old').getAttribute('data-kind')).toBe('removed')
    expect(screen.getByText('new').getAttribute('data-kind')).toBe('added')
  })

  it('does not label an unchanged existing file as new', () => {
    render(<DiffView change={{ path: '/p/x.json', before: '{}\n', after: '{}\n' }} />)

    expect(screen.queryByText('新規作成')).toBeNull()
  })
})
