CREATE TABLE secrets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_name TEXT NOT NULL UNIQUE,
  encrypted_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
