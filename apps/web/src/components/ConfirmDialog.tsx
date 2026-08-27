export interface ConfirmDialogProps {
  open: boolean
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, message, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) {
    return null
  }
  return (
    <div className="dialog-backdrop">
      <div role="dialog" aria-modal="true" className="dialog">
        <p>{message}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>やめる</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>実行する</button>
        </div>
      </div>
    </div>
  )
}
