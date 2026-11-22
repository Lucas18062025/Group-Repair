ALTER TABLE customers ADD COLUMN owner_user_id TEXT REFERENCES users(id);
ALTER TABLE customers ADD COLUMN surname TEXT;
ALTER TABLE customers ADD COLUMN observations TEXT;
ALTER TABLE customers ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVO';

ALTER TABLE devices ADD COLUMN owner_user_id TEXT REFERENCES users(id);

ALTER TABLE repair_orders ADD COLUMN owner_user_id TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_owner ON repair_orders(owner_user_id);
