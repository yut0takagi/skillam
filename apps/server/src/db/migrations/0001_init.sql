CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE role_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  skill_source TEXT NOT NULL CHECK (skill_source IN ('user', 'project-local', 'plugin')),
  skill_path TEXT NOT NULL
);

CREATE TABLE role_mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  command_json TEXT NOT NULL,
  env_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE role_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  markdown_body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('reference', 'authored'))
);

CREATE TABLE role_permissions (
  role_id INTEGER PRIMARY KEY REFERENCES roles(id) ON DELETE CASCADE,
  permissions_json TEXT NOT NULL DEFAULT '{}'
);
