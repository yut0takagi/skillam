import { diffLines } from '../lib/diff.js'
import type { FileChange } from '../api/types.js'

const KIND_PREFIX: Record<string, string> = { context: ' ', added: '+', removed: '-' }
const KIND_CLASS: Record<string, string> = {
  context: 'dline',
  added: 'dline dline-added',
  removed: 'dline dline-removed'
}

export function DiffView({ change }: { change: FileChange }) {
  const lines = diffLines(change.before, change.after)
  const isNew = change.before === null
  const unchanged = change.before === change.after

  return (
    <section className="diff">
      <h3 className="diff-head">
        <code className="diff-path">{change.path}</code>
        {isNew ? <span>新規作成</span> : null}
        {unchanged ? <span>変更なし</span> : null}
      </h3>
      <pre className="diff-body">
        {lines.map((line, index) => (
          <div key={index} className={KIND_CLASS[line.kind]}>
            <span className="dsign" aria-hidden="true">{KIND_PREFIX[line.kind]}</span>
            <span className="dtext" data-kind={line.kind}>{line.text}</span>
          </div>
        ))}
      </pre>
    </section>
  )
}
