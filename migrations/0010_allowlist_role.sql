-- Agrega rol por defecto a la allowlist de Google para asignación automática.
ALTER TABLE google_access_allowlist ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer';
CREATE INDEX idx_google_allowlist_role ON google_access_allowlist(workshop_id, role);