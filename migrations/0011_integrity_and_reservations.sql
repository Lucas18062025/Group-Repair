ALTER TABLE audit_events ADD COLUMN request_id TEXT;
ALTER TABLE audit_events ADD COLUMN before_json TEXT;
ALTER TABLE audit_events ADD COLUMN after_json TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_request ON audit_events(workshop_id, request_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_workshop_reference
ON stock_movements(workshop_id, reference)
WHERE reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS part_reservations (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  part_id TEXT NOT NULL REFERENCES parts(id),
  order_id TEXT REFERENCES repair_orders(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  reference TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  released_at TEXT,
  UNIQUE(workshop_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_part_reservations_part ON part_reservations(workshop_id, part_id, status);

ALTER TABLE oauth_states ADD COLUMN csrf_token TEXT;
