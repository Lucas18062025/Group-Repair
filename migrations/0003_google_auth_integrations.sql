ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE users ADD COLUMN deactivated_at TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;

CREATE TABLE google_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(google_sub)
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id, revoked_at);

CREATE TABLE oauth_states (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  nonce TEXT,
  pkce_verifier_hash TEXT,
  pkce_verifier TEXT,
  user_id TEXT REFERENCES users(id),
  service TEXT,
  redirect_uri TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);

CREATE TABLE google_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  service TEXT NOT NULL,
  account_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  scopes TEXT,
  expires_at TEXT,
  connected_at TEXT,
  last_sync_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, service)
);

CREATE TABLE gemini_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  model TEXT NOT NULL,
  input_chars INTEGER NOT NULL,
  output_chars INTEGER NOT NULL,
  latency_ms INTEGER,
  success INTEGER NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE gemini_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  content_preview TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_gemini_history_user ON gemini_history(user_id, created_at);

CREATE TABLE integration_audit (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  service TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);
