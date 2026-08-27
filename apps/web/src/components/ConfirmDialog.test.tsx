import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog.js'

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmDialog open={false} message="消しますか" onConfirm={() => {}} onCancel={() => {}} />)

    expect(screen.queryByText('消しますか')).toBeNull()
  })

  it('calls onConfirm when the confirm button is pressed', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog open message="消しますか" onConfirm={onConfirm} onCancel={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: '実行する' }))

    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when the cancel button is pressed', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open message="消しますか" onConfirm={() => {}} onCancel={onCancel} />)

    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('exposes itself as a modal dialog', () => {
    render(<ConfirmDialog open message="消しますか" onConfirm={() => {}} onCancel={() => {}} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })
})
