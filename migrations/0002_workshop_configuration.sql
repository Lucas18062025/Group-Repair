ALTER TABLE workshops ADD COLUMN jurisdiction TEXT NOT NULL DEFAULT 'San Miguel de Tucumán, Tucumán, Argentina';
ALTER TABLE workshops ADD COLUMN address TEXT;
ALTER TABLE workshops ADD COLUMN warranty_phone TEXT NOT NULL DEFAULT '+54 9 381 524-9553';
ALTER TABLE workshops ADD COLUMN opening_schedule TEXT NOT NULL DEFAULT 'Lunes a sábado de 9:00 a 21:00 de corrido';
ALTER TABLE workshops ADD COLUMN closed_days TEXT NOT NULL DEFAULT 'domingo';

UPDATE workshops
SET timezone = 'America/Argentina/Tucuman',
    currency = 'ARS',
    jurisdiction = 'San Miguel de Tucumán, Tucumán, Argentina',
    warranty_phone = '+54 9 381 524-9553',
    opening_schedule = 'Lunes a sábado de 9:00 a 21:00 de corrido',
    closed_days = 'domingo';
