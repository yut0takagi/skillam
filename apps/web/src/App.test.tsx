import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from './App.js'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  )
}

describe('AppRoutes', () => {
  it('shows the dashboard at the root path', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'プロジェクト' })).toBeDefined()
  })

  it('shows roles at /roles', () => {
    renderAt('/roles')
    expect(screen.getByRole('heading', { name: 'ロール' })).toBeDefined()
  })

  it('shows the catalog at /catalog', () => {
    renderAt('/catalog')
    expect(screen.getByRole('heading', { name: 'カタログ' })).toBeDefined()
  })

  it('shows settings at /settings', () => {
    renderAt('/settings')
    expect(screen.getByRole('heading', { name: '設定' })).toBeDefined()
  })

  it('offers navigation to every section', () => {
    renderAt('/')
    for (const label of ['プロジェクト', 'ロール', 'カタログ', '設定']) {
      expect(screen.getByRole('link', { name: label })).toBeDefined()
    }
  })
})
