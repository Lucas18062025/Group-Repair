import { canTransition, type OrderStatus } from "./domain/status";
import { calculateLineTotal } from "./domain/money";

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  exec(query: string): Promise<unknown>;
}

interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  DB: D1Database;
  ASSETS: AssetBinding;
}

const WORKSHOP_ID = "workshop-main";
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cuerpo JSON inválido");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} es obligatorio`);
  }
  return value.trim();
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${field} debe ser un entero`);
  }
  return value;
}

async function ensureWorkshop(db: D1Database): Promise<void> {
  await db.prepare(
    "INSERT OR IGNORE INTO workshops (id,name,timezone,currency,created_at) VALUES (?1,?2,?3,?4,?5)"
  ).bind(WORKSHOP_ID, "Mi taller", "America/Argentina/Buenos_Aires", "ARS", now()).run();
}

async function audit(
  db: D1Database,
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown = null
): Promise<void> {
  await db.prepare(
    "INSERT INTO audit_events (id,workshop_id,actor_id,action,entity_type,entity_id,metadata,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
  ).bind(uuid(), WORKSHOP_ID, null, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null, now()).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      await ensureWorkshop(env.DB);
      const url = new URL(request.url);

      if (url.pathname === "/api/health") {
        return json({ ok: true });
      }

      if (url.pathname === "/api/dashboard" && request.method === "GET") {
        const [orders, customers, devices, lowStock, payments] = await Promise.all([
          env.DB.prepare("SELECT status, COUNT(*) AS count FROM repair_orders WHERE workshop_id=?1 GROUP BY status").bind(WORKSHOP_ID).all<{ status: string; count: number }>(),
          env.DB.prepare("SELECT COUNT(*) AS count FROM customers WHERE workshop_id=?1").bind(WORKSHOP_ID).first<number>("count"),
          env.DB.prepare("SELECT COUNT(*) AS count FROM devices WHERE workshop_id=?1").bind(WORKSHOP_ID).first<number>("count"),
          env.DB.prepare(`
            SELECT p.id,p.sku,p.name,p.minimum_stock,
              COALESCE(SUM(CASE WHEN sm.kind IN ('IN','RETURN','ADJUSTMENT_IN') THEN sm.quantity ELSE -sm.quantity END),0) AS stock
            FROM parts p LEFT JOIN stock_movements sm ON sm.part_id=p.id
            WHERE p.workshop_id=?1 GROUP BY p.id HAVING stock <= p.minimum_stock
          `).bind(WORKSHOP_ID).all(),
          env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN kind='REFUND' THEN -amount_minor ELSE amount_minor END),0) AS total FROM payment_transactions WHERE workshop_id=?1").bind(WORKSHOP_ID).first<number>("total")
        ]);
        return json({
          ordersByStatus: orders.results,
          customerCount: customers ?? 0,
          deviceCount: devices ?? 0,
          lowStock: lowStock.results,
          collectedMinor: payments ?? 0
        });
      }

      if (url.pathname === "/api/customers" && request.method === "GET") {
        const result = await env.DB.prepare(
          "SELECT id,name,phone,email,address,created_at FROM customers WHERE workshop_id=?1 ORDER BY created_at DESC LIMIT 100"
        ).bind(WORKSHOP_ID).all();
        return json({ customers: result.results });
      }

      if (url.pathname === "/api/customers" && request.method === "POST") {
        const body = await readJson(request);
        const id = uuid();
        const timestamp = now();
        await env.DB.prepare(
          "INSERT INTO customers (id,workshop_id,name,phone,email,address,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
        ).bind(id, WORKSHOP_ID, text(body.name, "Nombre"), text(body.phone, "Teléfono"), body.email ? text(body.email, "Email") : null, body.address ? text(body.address, "Dirección") : null, timestamp, timestamp).run();
        await audit(env.DB, "customer.created", "customer", id, { name: body.name });
        return json({ id }, 201);
      }

      if (url.pathname === "/api/devices" && request.method === "POST") {
        const body = await readJson(request);
        const id = uuid();
        await env.DB.prepare(
          "INSERT INTO devices (id,workshop_id,customer_id,category,brand,model,serial_number,physical_condition,reported_fault,accessories,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"
        ).bind(id, WORKSHOP_ID, text(body.customerId, "Cliente"), text(body.category, "Categoría"), text(body.brand, "Marca"), text(body.model, "Modelo"), body.serialNumber ? text(body.serialNumber, "Serie/IMEI") : null, body.physicalCondition ? text(body.physicalCondition, "Condición") : null, body.reportedFault ? text(body.reportedFault, "Falla") : null, body.accessories ? text(body.accessories, "Accesorios") : null, now()).run();
        await audit(env.DB, "device.created", "device", id);
        return json({ id }, 201);
      }

      if (url.pathname === "/api/orders" && request.method === "GET") {
        const result = await env.DB.prepare(`
          SELECT ro.id,ro.reference,ro.reported_issue,ro.priority,ro.status,ro.created_at,
                 c.name AS customer_name,d.brand,d.model
          FROM repair_orders ro
          JOIN customers c ON c.id=ro.customer_id
          JOIN devices d ON d.id=ro.device_id
          WHERE ro.workshop_id=?1 ORDER BY ro.created_at DESC LIMIT 100
        `).bind(WORKSHOP_ID).all();
        return json({ orders: result.results });
      }

      if (url.pathname === "/api/orders" && request.method === "POST") {
        const body = await readJson(request);
        const id = uuid();
        const timestamp = now();
        const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM repair_orders WHERE workshop_id=?1").bind(WORKSHOP_ID).first<{ count: number }>("count");
        const reference = `GR-${String((count?.count ?? 0) + 1).padStart(5, "0")}`;
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO repair_orders (id,workshop_id,customer_id,device_id,reference,reported_issue,priority,status,estimated_completion_at,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"
          ).bind(id, WORKSHOP_ID, text(body.customerId, "Cliente"), text(body.deviceId, "Equipo"), reference, text(body.reportedIssue, "Problema"), body.priority ? text(body.priority, "Prioridad") : "normal", "RECEIVED", body.estimatedCompletionAt ? text(body.estimatedCompletionAt, "Fecha estimada") : null, timestamp, timestamp),
          env.DB.prepare(
            "INSERT INTO order_status_events (id,workshop_id,order_id,from_status,to_status,actor_id,reason,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
          ).bind(uuid(), WORKSHOP_ID, id, null, "RECEIVED", null, "Orden creada", timestamp)
        ]);
        await audit(env.DB, "order.created", "repair_order", id, { reference });
        return json({ id, reference }, 201);
      }

      const statusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
      if (statusMatch && request.method === "PATCH") {
        const body = await readJson(request);
        const orderId = statusMatch[1];
        const toStatus = text(body.status, "Estado").toUpperCase() as OrderStatus;
        const order = await env.DB.prepare(
          "SELECT status FROM repair_orders WHERE id=?1 AND workshop_id=?2"
        ).bind(orderId, WORKSHOP_ID).first<{ status: OrderStatus }>("status");
        if (!order) return json({ error: "Orden no encontrada" }, 404);
        if (!canTransition(order.status, toStatus)) {
          return json({ error: `Transición inválida: ${order.status} → ${toStatus}` }, 409);
        }
        if (toStatus === "APPROVED") {
          const approved = await env.DB.prepare(
            "SELECT id FROM quote_versions WHERE order_id=?1 AND workshop_id=?2 AND status='approved' LIMIT 1"
          ).bind(orderId, WORKSHOP_ID).first("id");
          if (!approved) return json({ error: "Se requiere un presupuesto aprobado" }, 409);
        }
        const timestamp = now();
        await env.DB.batch([
          env.DB.prepare("UPDATE repair_orders SET status=?1,updated_at=?2 WHERE id=?3 AND workshop_id=?4").bind(toStatus, timestamp, orderId, WORKSHOP_ID),
          env.DB.prepare(
            "INSERT INTO order_status_events (id,workshop_id,order_id,from_status,to_status,actor_id,reason,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
          ).bind(uuid(), WORKSHOP_ID, orderId, order.status, toStatus, null, body.reason ? text(body.reason, "Motivo") : null, timestamp)
        ]);
        await audit(env.DB, "order.status_changed", "repair_order", orderId, { from: order.status, to: toStatus });
        return json({ status: toStatus });
      }

      if (url.pathname.match(/^\/api\/orders\/[^/]+\/diagnostics$/) && request.method === "POST") {
        const body = await readJson(request);
        const orderId = url.pathname.split("/")[3];
        const id = uuid();
        await env.DB.prepare(
          "INSERT INTO diagnostics (id,workshop_id,order_id,findings,certainty,recommendation,actor_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
        ).bind(id, WORKSHOP_ID, orderId, text(body.findings, "Hallazgos"), text(body.certainty, "Certeza"), body.recommendation ? text(body.recommendation, "Recomendación") : null, null, now()).run();
        await audit(env.DB, "diagnostic.created", "diagnostic", id);
        return json({ id }, 201);
      }

      if (url.pathname.match(/^\/api\/orders\/[^/]+\/quotes$/) && request.method === "POST") {
        const body = await readJson(request);
        const orderId = url.pathname.split("/")[3];
        const lines = body.lines;
        if (!Array.isArray(lines) || lines.length === 0) throw new Error("El presupuesto requiere partidas");
        const quoteId = uuid();
        let subtotal = 0;
        const statements: D1PreparedStatement[] = [];
        const version = 1;
        for (const line of lines) {
          if (!line || typeof line !== "object") throw new Error("Partida inválida");
          const record = line as Record<string, unknown>;
          const quantity = integer(record.quantity, "Cantidad");
          const price = integer(record.unitPriceMinor, "Precio unitario");
          const total = calculateLineTotal(quantity, price);
          subtotal += total;
          statements.push(
            env.DB.prepare(
              "INSERT INTO quote_lines (id,workshop_id,quote_version_id,description,quantity,unit_price_minor,line_total_minor) VALUES (?1,?2,?3,?4,?5,?6,?7)"
            ).bind(uuid(), WORKSHOP_ID, quoteId, text(record.description, "Descripción"), quantity, price, total)
          );
        }
        const tax = integer(body.taxMinor ?? 0, "Impuesto");
        const total = subtotal + tax;
        const status = body.status === "approved" ? "approved" : "draft";
        statements.unshift(
          env.DB.prepare(
            "INSERT INTO quote_versions (id,workshop_id,order_id,version,subtotal_minor,tax_minor,total_minor,status,expires_at,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"
          ).bind(quoteId, WORKSHOP_ID, orderId, version, subtotal, tax, total, status, body.expiresAt ? text(body.expiresAt, "Vencimiento") : null, now())
        );
        await env.DB.batch(statements);
        await audit(env.DB, "quote.created", "quote", quoteId, { status, totalMinor: total });
        return json({ id: quoteId, subtotalMinor: subtotal, totalMinor: total, status }, 201);
      }

      if (url.pathname.match(/^\/api\/orders\/[^/]+\/payments$/) && request.method === "POST") {
        const body = await readJson(request);
        const orderId = url.pathname.split("/")[3];
        const amount = integer(body.amountMinor, "Importe");
        if (amount <= 0) throw new Error("El importe debe ser positivo");
        const kind = body.kind === "REFUND" ? "REFUND" : "PAYMENT";
        const id = uuid();
        await env.DB.prepare(
          "INSERT INTO payment_transactions (id,workshop_id,order_id,kind,amount_minor,method,reference,actor_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
        ).bind(id, WORKSHOP_ID, orderId, kind, amount, text(body.method, "Método"), body.reference ? text(body.reference, "Referencia") : null, null, now()).run();
        await audit(env.DB, kind === "REFUND" ? "payment.refunded" : "payment.created", "payment", id, { amountMinor: amount });
        return json({ id }, 201);
      }

      if (url.pathname === "/api/parts" && request.method === "GET") {
        const result = await env.DB.prepare(`
          SELECT p.id,p.sku,p.name,p.location,p.cost_minor,p.sale_price_minor,p.minimum_stock,
            COALESCE(SUM(CASE WHEN sm.kind IN ('IN','RETURN','ADJUSTMENT_IN') THEN sm.quantity ELSE -sm.quantity END),0) AS stock
          FROM parts p LEFT JOIN stock_movements sm ON sm.part_id=p.id
          WHERE p.workshop_id=?1 GROUP BY p.id ORDER BY p.name
        `).bind(WORKSHOP_ID).all();
        return json({ parts: result.results });
      }

      if (url.pathname === "/api/parts" && request.method === "POST") {
        const body = await readJson(request);
        const id = uuid();
        await env.DB.prepare(
          "INSERT INTO parts (id,workshop_id,sku,name,location,cost_minor,sale_price_minor,minimum_stock,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
        ).bind(id, WORKSHOP_ID, text(body.sku, "SKU"), text(body.name, "Nombre"), body.location ? text(body.location, "Ubicación") : null, integer(body.costMinor, "Costo"), integer(body.salePriceMinor, "Precio"), integer(body.minimumStock ?? 0, "Stock mínimo"), now()).run();
        await audit(env.DB, "part.created", "part", id);
        return json({ id }, 201);
      }

      const movementMatch = url.pathname.match(/^\/api\/parts\/([^/]+)\/movements$/);
      if (movementMatch && request.method === "POST") {
        const body = await readJson(request);
        const partId = movementMatch[1];
        const quantity = integer(body.quantity, "Cantidad");
        if (quantity <= 0) throw new Error("La cantidad debe ser positiva");
        const kind = text(body.kind, "Tipo").toUpperCase();
        const allowed = ["IN", "OUT", "RETURN", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"];
        if (!allowed.includes(kind)) throw new Error("Tipo de movimiento inválido");
        const stockRow = await env.DB.prepare(`
          SELECT COALESCE(SUM(CASE WHEN kind IN ('IN','RETURN','ADJUSTMENT_IN') THEN quantity ELSE -quantity END),0) AS stock
          FROM stock_movements WHERE part_id=?1 AND workshop_id=?2
        `).bind(partId, WORKSHOP_ID).first<{ stock: number }>("stock");
        const stock = stockRow?.stock ?? 0;
        if (["OUT", "ADJUSTMENT_OUT"].includes(kind) && stock - quantity < 0) {
          return json({ error: "Stock insuficiente" }, 409);
        }
        const id = uuid();
        await env.DB.prepare(
          "INSERT INTO stock_movements (id,workshop_id,part_id,order_id,kind,quantity,reason,actor_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
        ).bind(id, WORKSHOP_ID, partId, body.orderId ? text(body.orderId, "Orden") : null, kind, quantity, text(body.reason, "Motivo"), null, now()).run();
        await audit(env.DB, "stock.movement", "stock_movement", id, { kind, quantity });
        return json({ id }, 201);
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ error: "Ruta no encontrada" }, 404);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error interno";
      const status = /obligatorio|inválid|positivo|entero|JSON/.test(message) ? 400 : 500;
      return json({ error: message }, status);
    }
  }
};
