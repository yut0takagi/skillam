import { diffLines } from '../lib/diff.js'
import type { FileChange } from '../api/types.js'

const KIND_PREFIX: Record<string, string> = { context: ' ', added: '+', removed: '-' }
const KIND_COLOR: Record<string, string> = {
  context: 'transparent',
  added: '#e6ffed',
  removed: '#ffeef0'
}

export function DiffView({ change }: { change: FileChange }) {
  const lines = diffLines(change.before, change.after)
  const isNew = change.before === null
  const unchanged = change.before === change.after

  return (
    <section>
      <h3>
        <code>{change.path}</code>
        {isNew ? <span>新規作成</span> : null}
        {unchanged ? <span>変更なし</span> : null}
      </h3>
      <pre>
        {lines.map((line, index) => (
          <div key={index} style={{ backgroundColor: KIND_COLOR[line.kind] }}>
            <span aria-hidden="true">{KIND_PREFIX[line.kind]}</span>
            <span data-kind={line.kind}>{line.text}</span>
          </div>
        ))}
      </pre>
    </section>
  )
}
