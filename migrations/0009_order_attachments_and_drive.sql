ALTER TABLE google_connections ADD COLUMN workshop_id TEXT REFERENCES workshops(id);
ALTER TABLE google_connections ADD COLUMN connection_type TEXT NOT NULL DEFAULT 'PERSONAL';
ALTER TABLE google_connections ADD COLUMN revoked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_google_connections_ws ON google_connections(workshop_id, connection_type, status);

CREATE TABLE IF NOT EXISTS order_attachments (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  order_id TEXT NOT NULL REFERENCES repair_orders(id),
  device_id TEXT REFERENCES devices(id),
  storage_provider TEXT NOT NULL, -- 'R2' | 'GOOGLE_DRIVE'
  source_connection_id TEXT REFERENCES google_connections(id),
  external_file_id TEXT,
  object_key TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'OTROS',
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL DEFAULT 'INTERNAL',
  web_view_link TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_attachments_order ON order_attachments(workshop_id, order_id, deleted_at);
