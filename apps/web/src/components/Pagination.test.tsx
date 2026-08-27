import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Pagination } from './Pagination.js'

describe('Pagination', () => {
  it('renders nothing when pageCount is 1', () => {
    const { container } = render(
      <Pagination page={1} pageCount={1} total={10} rangeStart={1} rangeEnd={10} onChange={vi.fn()} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when pageCount is 0', () => {
    const { container } = render(
      <Pagination page={1} pageCount={0} total={0} rangeStart={0} rangeEnd={0} onChange={vi.fn()} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('shows the range label', () => {
    render(<Pagination page={2} pageCount={5} total={120} rangeStart={26} rangeEnd={50} onChange={vi.fn()} />)

    expect(screen.getByText('120 件中 26–50 件')).toBeDefined()
  })

  it('clicking a page number calls onChange with that page', async () => {
    const onChange = vi.fn()
    render(<Pagination page={1} pageCount={5} total={100} rangeStart={1} rangeEnd={25} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '3' }))

    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('前へ is disabled on the first page', () => {
    render(<Pagination page={1} pageCount={5} total={100} rangeStart={1} rangeEnd={25} onChange={vi.fn()} />)

    const button = screen.getByRole('button', { name: '前へ' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('次へ is disabled on the last page', () => {
    render(<Pagination page={5} pageCount={5} total={100} rangeStart={101} rangeEnd={100} onChange={vi.fn()} />)

    const button = screen.getByRole('button', { name: '次へ' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('前へ/次へ are enabled and call onChange with adjacent pages', async () => {
    const onChange = vi.fn()
    render(<Pagination page={3} pageCount={5} total={100} rangeStart={51} rangeEnd={75} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '前へ' }))
    expect(onChange).toHaveBeenCalledWith(2)

    await userEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('marks the current page with aria-current="page"', () => {
    render(<Pagination page={3} pageCount={5} total={100} rangeStart={51} rangeEnd={75} onChange={vi.fn()} />)

    const current = screen.getByRole('button', { name: '3' })
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: '1' }).getAttribute('aria-current')).toBeNull()
  })

  it('wraps in a nav with an accessible label', () => {
    render(<Pagination page={1} pageCount={5} total={100} rangeStart={1} rangeEnd={25} onChange={vi.fn()} />)

    expect(screen.getByRole('navigation', { name: 'ページ送り' })).toBeDefined()
  })

  it('renders a windowed set of pages for a large pageCount, with ellipses that are not buttons', () => {
    render(<Pagination page={9} pageCount={22} total={550} rangeStart={201} rangeEnd={225} onChange={vi.fn()} />)

    // first and last page always present
    expect(screen.getByRole('button', { name: '1' })).toBeDefined()
    expect(screen.getByRole('button', { name: '22' })).toBeDefined()
    // current page and window around it
    expect(screen.getByRole('button', { name: '9' })).toBeDefined()
    expect(screen.getByRole('button', { name: '8' })).toBeDefined()
    expect(screen.getByRole('button', { name: '10' })).toBeDefined()

    // not every page number in between is rendered as a button
    expect(screen.queryByRole('button', { name: '15' })).toBeNull()
    expect(screen.queryByRole('button', { name: '2' })).toBeNull()

    // ellipses exist but are not buttons
    const nav = screen.getByRole('navigation', { name: 'ページ送り' })
    const ellipses = nav.querySelectorAll('.page-ellipsis')
    expect(ellipses.length).toBeGreaterThan(0)
    for (const el of ellipses) {
      expect(el.tagName).not.toBe('BUTTON')
    }
  })
})
