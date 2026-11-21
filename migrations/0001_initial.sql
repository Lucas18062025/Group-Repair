PRAGMA foreign_keys = ON;

CREATE TABLE workshops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Argentina/Tucuman',
  currency TEXT NOT NULL DEFAULT 'ARS',
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workshop_id, email)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_customers_workshop_phone ON customers(workshop_id, phone);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  category TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT,
  physical_condition TEXT,
  reported_fault TEXT,
  accessories TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE repair_orders (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  reference TEXT NOT NULL,
  reported_issue TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  estimated_completion_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workshop_id, reference)
);

CREATE TABLE order_status_events (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  order_id TEXT NOT NULL REFERENCES repair_orders(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE diagnostics (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  order_id TEXT NOT NULL REFERENCES repair_orders(id),
  findings TEXT NOT NULL,
  certainty TEXT NOT NULL,
  recommendation TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE quote_versions (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  order_id TEXT NOT NULL REFERENCES repair_orders(id),
  version INTEGER NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(workshop_id, order_id, version)
);

CREATE TABLE quote_lines (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  quote_version_id TEXT NOT NULL REFERENCES quote_versions(id),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  line_total_minor INTEGER NOT NULL
);

CREATE TABLE payment_transactions (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  order_id TEXT NOT NULL REFERENCES repair_orders(id),
  kind TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  method TEXT NOT NULL,
  reference TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE parts (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  cost_minor INTEGER NOT NULL,
  sale_price_minor INTEGER NOT NULL,
  minimum_stock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(workshop_id, sku)
);

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  part_id TEXT NOT NULL REFERENCES parts(id),
  order_id TEXT REFERENCES repair_orders(id),
  kind TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_workshop_created ON audit_events(workshop_id, created_at);
