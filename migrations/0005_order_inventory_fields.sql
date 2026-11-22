ALTER TABLE repair_orders ADD COLUMN received_at TEXT;
ALTER TABLE repair_orders ADD COLUMN observations TEXT;
ALTER TABLE repair_orders ADD COLUMN accessories TEXT;
ALTER TABLE repair_orders ADD COLUMN assigned_user_id TEXT REFERENCES users(id);

UPDATE repair_orders
SET received_at = created_at
WHERE received_at IS NULL;
