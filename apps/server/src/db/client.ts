import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function resolveDbPath(): string {
  const override = process.env.SKILLAM_DB_PATH
  if (override) {
    return override
  }
  return path.join(os.homedir(), '.skillam', 'skillam.db')
}

export function openDb(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}
