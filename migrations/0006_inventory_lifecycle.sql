ALTER TABLE parts ADD COLUMN category TEXT;
ALTER TABLE parts ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVO';
ALTER TABLE parts ADD COLUMN updated_at TEXT;
ALTER TABLE parts ADD COLUMN archived_at TEXT;

UPDATE parts
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE stock_movements ADD COLUMN stock_before INTEGER;
ALTER TABLE stock_movements ADD COLUMN stock_after INTEGER;
ALTER TABLE stock_movements ADD COLUMN reference TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_reference
ON stock_movements(reference)
WHERE reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parts_workshop_status
ON parts(workshop_id,status);
