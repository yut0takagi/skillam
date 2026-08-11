CREATE TABLE project_roles (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, role_id)
);

CREATE TABLE apply_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  diff_json TEXT NOT NULL DEFAULT '{}',
  managed_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT NOT NULL DEFAULT '',
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE projects ADD COLUMN last_applied_role_id INTEGER REFERENCES roles(id);
ALTER TABLE projects ADD COLUMN last_applied_at TEXT;

ALTER TABLE role_agents ADD COLUMN source_path TEXT NOT NULL DEFAULT '';
