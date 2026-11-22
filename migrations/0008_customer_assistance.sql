CREATE TABLE chat_conversations (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  public_key TEXT NOT NULL UNIQUE,
  customer_id TEXT REFERENCES customers(id),
  name TEXT,
  phone TEXT,
  email TEXT,
  consent_chat_storage INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ABIERTA',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_chat_conversations_workshop ON chat_conversations(workshop_id, status);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);

CREATE TABLE service_requests (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  reference TEXT NOT NULL,
  conversation_id TEXT REFERENCES chat_conversations(id),
  customer_id TEXT REFERENCES customers(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  equipment_type TEXT,
  brand TEXT,
  model TEXT,
  problem TEXT NOT NULL,
  accessories TEXT,
  request_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NUEVA',
  order_id TEXT REFERENCES repair_orders(id),
  consent_personal_data INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workshop_id, reference)
);
CREATE INDEX idx_service_requests_status ON service_requests(workshop_id, status, created_at);

CREATE TABLE knowledge_base (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_knowledge_active ON knowledge_base(workshop_id, active);

CREATE TABLE chat_rate_limits (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  subject_hash TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(workshop_id, subject_hash, window_start)
);

INSERT INTO knowledge_base
  (id,workshop_id,category,question,answer,active,created_at,updated_at)
VALUES
  ('knowledge-horario','workshop-main','Horarios','¿Cuál es el horario?','Lunes a sábado de 9:00 a 21:00 de corrido. Domingo cerrado.',1,'2026-11-22T00:00:00.000Z','2026-11-22T00:00:00.000Z'),
  ('knowledge-garantia','workshop-main','Garantías','¿Qué garantía tiene la reparación?','Las condiciones deben confirmarse con el taller al recibir la reparación. Consulta: +54 9 381 524-9553.',1,'2026-11-22T00:00:00.000Z','2026-11-22T00:00:00.000Z'),
  ('knowledge-contacto','workshop-main','Contacto','¿Cómo contacto al taller?','Consultas y garantías: +54 9 381 524-9553. San Miguel de Tucumán, Tucumán.',1,'2026-11-22T00:00:00.000Z','2026-11-22T00:00:00.000Z'),
  ('knowledge-reparacion','workshop-main','Reparación','¿Qué equipos reparan?','Reparación de celulares, electrodomésticos y equipos electrónicos. Microsoldadura y diagnóstico según evaluación técnica.',1,'2026-11-22T00:00:00.000Z','2026-11-22T00:00:00.000Z');
