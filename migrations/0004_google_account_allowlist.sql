CREATE TABLE google_access_allowlist (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  google_sub TEXT,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workshop_id, email)
);
CREATE INDEX idx_google_allowlist_sub ON google_access_allowlist(workshop_id, google_sub);
