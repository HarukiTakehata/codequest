-- CodeQuest v1.0 baseline. migrations/0001_init.sql and db/schema.sql must stay identical.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('student','teacher','admin')),
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  password_hash TEXT,
  password_updated_at TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  auth_version INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  auth_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS user_auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  identifier TEXT NOT NULL,
  event_type TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instance_settings (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  langs TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'beginner',
  entry TEXT NOT NULL DEFAULT 'start.txt',
  version INTEGER NOT NULL DEFAULT 1,
  pack_json TEXT,
  pack_key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS freeform_drafts (
  user_id TEXT NOT NULL REFERENCES users(id),
  lang TEXT NOT NULL CHECK (lang IN ('javascript','python','cpp','shell','java')),
  code TEXT NOT NULL DEFAULT '',
  stdin TEXT NOT NULL DEFAULT '',
  testcases_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lang)
);

CREATE TABLE IF NOT EXISTS issued_batches (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','teacher')),
  count INTEGER NOT NULL CHECK (count > 0),
  download_token_hash TEXT NOT NULL UNIQUE,
  csv_text TEXT,
  expires_at TEXT NOT NULL,
  downloaded_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issued_batches_pending
  ON issued_batches(revoked_at, downloaded_at, expires_at, created_at);
CREATE TRIGGER IF NOT EXISTS issued_batches_clear_csv_after_download
AFTER UPDATE OF downloaded_at ON issued_batches
WHEN NEW.downloaded_at IS NOT NULL AND OLD.downloaded_at IS NULL
BEGIN
  UPDATE issued_batches SET csv_text = NULL WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS user_issuance (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES issued_batches(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_issuance_batch ON user_issuance(batch_id, created_at);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  actor_username TEXT NOT NULL,
  actor_email TEXT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_events_created
  ON admin_audit_events(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_events_target
  ON admin_audit_events(target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status, created_at);
CREATE INDEX IF NOT EXISTS idx_users_role_password_state ON users(role, must_change_password);
