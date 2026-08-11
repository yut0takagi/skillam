import type Database from 'better-sqlite3'
import { parseManagedState, serializeManagedState } from './managed-state.js'
import type { ApplyHistoryEntry, ApplyStatus, RecordApplyInput } from './apply-history.types.js'

interface ApplyHistoryRow {
  id: number
  project_id: number
  role_id: number | null
  diff_json: string
  managed_json: string
  status: string
  error_message: string
  applied_at: string
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}) ?? '{}'
  } catch {
    return '{}'
  }
}

function toEntry(row: ApplyHistoryRow): ApplyHistoryEntry {
  let diff: unknown = {}
  try {
    diff = JSON.parse(row.diff_json)
  } catch {
    diff = {}
  }
  return {
    id: row.id,
    projectId: row.project_id,
    roleId: row.role_id,
    diff,
    managed: parseManagedState(row.managed_json),
    status: row.status as ApplyStatus,
    errorMessage: row.error_message,
    appliedAt: row.applied_at
  }
}

export class ApplyHistoryRepository {
  constructor(private readonly db: Database.Database) {}

  record(input: RecordApplyInput): ApplyHistoryEntry {
    const row = this.db
      .prepare(
        `INSERT INTO apply_history (project_id, role_id, diff_json, managed_json, status, error_message)
         VALUES (@projectId, @roleId, @diffJson, @managedJson, @status, @errorMessage)
         RETURNING *`
      )
      .get({
        projectId: input.projectId,
        roleId: input.roleId,
        diffJson: safeStringify(input.diff),
        managedJson: serializeManagedState(input.managed),
        status: input.status,
        errorMessage: input.errorMessage ?? ''
      }) as ApplyHistoryRow
    return toEntry(row)
  }

  listForProject(projectId: number): ApplyHistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM apply_history WHERE project_id = ? ORDER BY id DESC')
      .all(projectId) as ApplyHistoryRow[]
    return rows.map(toEntry)
  }

  lastSuccessful(projectId: number): ApplyHistoryEntry | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM apply_history WHERE project_id = ? AND status = 'success' ORDER BY id DESC LIMIT 1"
      )
      .get(projectId) as ApplyHistoryRow | undefined
    return row ? toEntry(row) : undefined
  }

  /**
   * The most recent successful apply for the project, plus every row
   * recorded after it (oldest first). When there has never been a
   * successful apply, returns the project's entire history. This is what
   * lets a retry after a failed apply treat everything skillam has
   * attempted since its last known-good state as its own — including
   * partial writes left behind by the failure — instead of tripping the
   * "not created by skillam" conflict guard on its own leftovers.
   */
  listSinceLastSuccess(projectId: number): ApplyHistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM apply_history
         WHERE project_id = @projectId
           AND id >= COALESCE(
             (SELECT id FROM apply_history
              WHERE project_id = @projectId AND status = 'success'
              ORDER BY id DESC LIMIT 1),
             0
           )
         ORDER BY id ASC`
      )
      .all({ projectId }) as ApplyHistoryRow[]
    return rows.map(toEntry)
  }
}
