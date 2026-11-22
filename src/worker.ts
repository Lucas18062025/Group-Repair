import { canTransition, type OrderStatus } from "./domain/status";
import { calculateLineTotal } from "./domain/money";
import {
  clearSessionCookie,
  decryptSecret,
  encryptSecret,
  parseCookie,
  randomToken,
  setSessionCookie,
  sha256,
  verifyGoogleIdToken
} from "./auth";

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
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_BOOTSTRAP_SUB?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_DAILY_LIMIT?: string;
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
  ).bind(WORKSHOP_ID, "Mi taller", "America/Argentina/Tucuman", "ARS", now()).run();
  await db.prepare(`
    UPDATE workshops
    SET timezone=?1,currency=?2,jurisdiction=?3,warranty_phone=?4,
        opening_schedule=?5,closed_days=?6
    WHERE id=?7
  `).bind(
    "America/Argentina/Tucuman",
    "ARS",
    "San Miguel de Tucumán, Tucumán, Argentina",
    "+54 9 381 524-9553",
    "Lunes a sábado de 9:00 a 21:00 de corrido",
    "domingo",
    WORKSHOP_ID
  ).run();
}

interface SessionUser {
  id: string;
  workshop_id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  deactivated_at: string | null;
}

async function getSession(db: D1Database, request: Request): Promise<SessionUser | null> {
  const token = parseCookie(request, "gr_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  return db.prepare(`
    SELECT u.id,u.workshop_id,u.name,u.email,u.role,u.status,u.deactivated_at
    FROM auth_sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2
  `).bind(tokenHash, now()).first<SessionUser>();
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

      if (url.pathname === "/api/auth/config" && request.method === "GET") {
        return json({
          googleConfigured: Boolean(env.GOOGLE_CLIENT_ID),
          googleClientId: env.GOOGLE_CLIENT_ID ?? null,
          geminiConfigured: Boolean(env.GEMINI_API_KEY)
        });
      }

      if (url.pathname === "/api/auth/nonce" && request.method === "POST") {
        const nonce = randomToken(24);
        await env.DB.prepare(
          "INSERT INTO oauth_states (id,state,nonce,expires_at,created_at) VALUES (?1,?2,?3,?4,?5)"
        ).bind(uuid(), randomToken(24), nonce, new Date(Date.now() + 10 * 60 * 1000).toISOString(), now()).run();
        return json({ nonce });
      }

      if (url.pathname === "/api/auth/google" && request.method === "POST") {
        if (!env.GOOGLE_CLIENT_ID) return json({ error: "Google Sign-In no está configurado" }, 503);
        const body = await readJson(request);
        const credential = text(body.credential, "Credencial");
        const nonce = text(body.nonce, "Nonce");
        const nonceRecord = await env.DB.prepare(
          "SELECT id FROM oauth_states WHERE nonce=?1 AND used_at IS NULL AND expires_at>?2"
        ).bind(nonce, now()).first("id");
        if (!nonceRecord) return json({ error: "Nonce inválido o expirado" }, 401);
        await env.DB.prepare("UPDATE oauth_states SET used_at=?1 WHERE nonce=?2").bind(now(), nonce).run();

        const payload = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID, nonce);
        if (payload.email_verified !== true) return json({ error: "El correo de Google no está verificado" }, 403);
        if (!payload.email) return json({ error: "La cuenta de Google no proporcionó correo" }, 403);

        let user = await env.DB.prepare(`
          SELECT u.id,u.workshop_id,u.name,u.email,u.role,u.status,u.deactivated_at
          FROM google_identities g
          JOIN users u ON u.id=g.user_id
          WHERE g.google_sub=?1
        `).bind(payload.sub).first<SessionUser & { workshop_id: string; deactivated_at: string | null }>();

        if (!user) {
          const userId = uuid();
          const timestamp = now();
          const activeAdmins = await env.DB.prepare(
            "SELECT COUNT(*) AS count FROM users WHERE role='admin' AND status='APPROVED' AND deactivated_at IS NULL"
          ).bind().first<number>("count");
          const isBootstrapAdmin = Boolean(env.GOOGLE_BOOTSTRAP_SUB && env.GOOGLE_BOOTSTRAP_SUB === payload.sub && activeAdmins === 0);
          await env.DB.prepare(
            "INSERT INTO users (id,workshop_id,name,email,role,status,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)"
          ).bind(
            userId,
            WORKSHOP_ID,
            payload.name?.trim() || payload.email,
            payload.email,
            isBootstrapAdmin ? "admin" : "viewer",
            isBootstrapAdmin ? "APPROVED" : "PENDING",
            timestamp
          ).run();
          await env.DB.prepare(
            "INSERT INTO google_identities (id,user_id,google_sub,email,email_verified,created_at) VALUES (?1,?2,?3,?4,?5,?6)"
          ).bind(uuid(), userId, payload.sub, payload.email, payload.email_verified ? 1 : 0, timestamp).run();
          user = await env.DB.prepare(
            "SELECT id,workshop_id,name,email,role,status,deactivated_at FROM users WHERE id=?1"
          ).bind(userId).first<SessionUser & { deactivated_at: string | null }>();
          if (!user) return json({ error: "No se pudo crear la cuenta" }, 500);
        } else {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO google_identities (id,user_id,google_sub,email,email_verified,created_at) VALUES (?1,?2,?3,?4,?5,?6)"
          ).bind(uuid(), user.id, payload.sub, payload.email, payload.email_verified ? 1 : 0, now()).run();
        }

        if (user.deactivated_at || user.status === "DEACTIVATED") {
          return json({ error: "La cuenta está desactivada" }, 403);
        }
        await env.DB.prepare("UPDATE users SET last_login_at=?1 WHERE id=?2").bind(now(), user.id).run();

        const sessionToken = randomToken(32);
        const tokenHash = await sha256(sessionToken);
        await env.DB.prepare(
          "INSERT INTO auth_sessions (id,user_id,token_hash,expires_at,created_at,ip_hash,user_agent) VALUES (?1,?2,?3,?4,?5,?6,?7)"
        ).bind(
          uuid(),
          user.id,
          tokenHash,
          new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
          now(),
          null,
          request.headers.get("user-agent")?.slice(0, 240) ?? null
        ).run();

        return new Response(JSON.stringify({
          user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status }
        }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "set-cookie": setSessionCookie(sessionToken)
          }
        });
      }

      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const session = await getSession(env.DB, request);
        if (!session) return json({ user: null });
        return json({ user: { id: session.id, name: session.name, email: session.email, role: session.role, status: session.status } });
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const token = parseCookie(request, "gr_session");
        if (token) {
          await env.DB.prepare("UPDATE auth_sessions SET revoked_at=?1 WHERE token_hash=?2").bind(now(), await sha256(token)).run();
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "set-cookie": clearSessionCookie() }
        });
      }

      const session = await getSession(env.DB, request);
      if (url.pathname.startsWith("/api/")) {
        if (!session) return json({ error: "Autenticación requerida" }, 401);
        if (session.status !== "APPROVED" || session.deactivated_at) {
          return json({ error: "Cuenta pendiente de aprobación o desactivada" }, 403);
        }
      }
      const authenticatedSession = session as SessionUser;

      if (url.pathname === "/api/auth/logout-all" && request.method === "POST") {
        await env.DB.prepare("UPDATE auth_sessions SET revoked_at=?1 WHERE user_id=?2 AND revoked_at IS NULL").bind(now(), authenticatedSession.id).run();
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "set-cookie": clearSessionCookie() }
        });
      }

      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        if (authenticatedSession.role !== "admin") return json({ error: "Permisos insuficientes" }, 403);
        const users = await env.DB.prepare(
          "SELECT id,workshop_id,name,email,role,status,deactivated_at,created_at,last_login_at FROM users WHERE workshop_id=?1 ORDER BY created_at DESC"
        ).bind(WORKSHOP_ID).all();
        return json({ users: users.results });
      }

      const approvalMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/(approve|deactivate)$/);
      if (approvalMatch && request.method === "POST") {
        if (authenticatedSession.role !== "admin") return json({ error: "Permisos insuficientes" }, 403);
        const userId = approvalMatch[1];
        const action = approvalMatch[2];
        if (userId === authenticatedSession.id) return json({ error: "No puedes cambiar tu propia cuenta desde esta operación" }, 409);
        if (action === "approve") {
          await env.DB.prepare("UPDATE users SET status='APPROVED',deactivated_at=NULL WHERE id=?1 AND workshop_id=?2").bind(userId, WORKSHOP_ID).run();
        } else {
          await env.DB.prepare("UPDATE users SET status='DEACTIVATED',deactivated_at=?1 WHERE id=?2 AND workshop_id=?3").bind(now(), userId, WORKSHOP_ID).run();
        }
        await audit(env.DB, `user.${action}`, "user", userId);
        return json({ ok: true });
      }

      if (url.pathname === "/api/integrations" && request.method === "GET") {
        const connections = await env.DB.prepare(
          "SELECT service,account_email,status,scopes,expires_at,connected_at,last_sync_at,error,updated_at FROM google_connections WHERE user_id=?1"
        ).bind(authenticatedSession.id).all();
        return json({ connections: connections.results });
      }

      const integrationStart = url.pathname.match(/^\/api\/integrations\/(google_drive|google_sheets|google_photos)\/start$/);
      if (integrationStart && request.method === "POST") {
        const service = integrationStart[1];
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
          return json({ error: "Google OAuth no está configurado. Pendiente de credenciales externas." }, 503);
        }
        const scopes: Record<string, string[]> = {
          google_drive: ["https://www.googleapis.com/auth/drive.file"],
          google_sheets: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/spreadsheets"],
          google_photos: ["https://www.googleapis.com/auth/photospicker.mediaitems.readonly"]
        };
        const state = randomToken(24);
        const verifier = randomToken(64);
        const challenge = await sha256(verifier);
        const redirectUri = env.GOOGLE_REDIRECT_URI ?? `${url.origin}/api/integrations/google/callback`;
        await env.DB.prepare(
          "INSERT INTO oauth_states (id,state,pkce_verifier_hash,pkce_verifier,user_id,service,redirect_uri,expires_at,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
        ).bind(uuid(), state, challenge, verifier, authenticatedSession.id, service, redirectUri, new Date(Date.now() + 10 * 60 * 1000).toISOString(), now()).run();

        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", scopes[service].join(" "));
        authUrl.searchParams.set("include_granted_scopes", "true");
        authUrl.searchParams.set("access_type", "offline");
        authUrl.searchParams.set("prompt", "consent");
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", challenge);
        authUrl.searchParams.set("code_challenge_method", "S256");
        return json({ authUrl: authUrl.toString() });
      }

      if (url.pathname === "/api/integrations/google/callback" && request.method === "GET") {
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const oauthError = url.searchParams.get("error");
        if (oauthError) return new Response(null, { status: 302, headers: { location: "/?integration_error=google&tab=integraciones" } });
        if (!state || !code) return json({ error: "Respuesta OAuth incompleta" }, 400);
        const record = await env.DB.prepare(`
          SELECT state,user_id,service,redirect_uri,pkce_verifier,expires_at,used_at
          FROM oauth_states WHERE state=?1
        `).bind(state).first<{ state: string; user_id: string; service: string; redirect_uri: string; pkce_verifier: string; expires_at: string; used_at: string | null }>();
        if (!record || record.used_at || record.expires_at <= now() || record.user_id !== authenticatedSession.id) {
          return json({ error: "Estado OAuth inválido o expirado" }, 401);
        }
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
          return json({ error: "Google OAuth no está configurado" }, 503);
        }
        await env.DB.prepare("UPDATE oauth_states SET used_at=?1 WHERE state=?2").bind(now(), state).run();

        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: record.redirect_uri,
            grant_type: "authorization_code",
            code_verifier: record.pkce_verifier
          })
        });
        const tokenBody = await tokenResponse.json() as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string;
          error?: string;
        };
        if (!tokenResponse.ok || !tokenBody.access_token) {
          return json({ error: tokenBody.error ?? "No se pudieron intercambiar las credenciales" }, 502);
        }
        if (!env.OAUTH_TOKEN_ENCRYPTION_KEY) {
          return json({ error: "Falta la clave de cifrado de tokens OAuth" }, 503);
        }
        const accessEncrypted = await encryptSecret(tokenBody.access_token, env.OAUTH_TOKEN_ENCRYPTION_KEY);
        const refreshEncrypted = tokenBody.refresh_token
          ? await encryptSecret(tokenBody.refresh_token, env.OAUTH_TOKEN_ENCRYPTION_KEY)
          : null;
        const expiresAt = new Date(Date.now() + (tokenBody.expires_in ?? 3600) * 1000).toISOString();
        await env.DB.prepare(`
          INSERT INTO google_connections (id,user_id,service,status,access_token_encrypted,refresh_token_encrypted,scopes,expires_at,connected_at,created_at,updated_at)
          VALUES (?1,?2,?3,'connected',?4,?5,?6,?7,?8,?9,?10)
          ON CONFLICT(user_id,service) DO UPDATE SET
            status='connected',access_token_encrypted=excluded.access_token_encrypted,
            refresh_token_encrypted=COALESCE(excluded.refresh_token_encrypted,google_connections.refresh_token_encrypted),
            scopes=excluded.scopes,expires_at=excluded.expires_at,connected_at=excluded.connected_at,
            error=NULL,updated_at=excluded.updated_at
        `).bind(
          uuid(), authenticatedSession.id, record.service, accessEncrypted, refreshEncrypted,
          tokenBody.scope ?? null, expiresAt, now(), now(), now()
        ).run();
        await audit(env.DB, "integration.connected", "integration", authenticatedSession.id, { service: record.service });
        return new Response(null, { status: 302, headers: { location: `/?tab=integraciones&connected=${encodeURIComponent(record.service)}` } });
      }

      const integrationDisconnect = url.pathname.match(/^\/api\/integrations\/(google_drive|google_sheets|google_photos)\/disconnect$/);
      if (integrationDisconnect && request.method === "POST") {
        const service = integrationDisconnect[1];
        await env.DB.prepare(
          "UPDATE google_connections SET status='disconnected',access_token_encrypted=NULL,refresh_token_encrypted=NULL,error=NULL,updated_at=?1 WHERE user_id=?2 AND service=?3"
        ).bind(now(), authenticatedSession.id, service).run();
        await audit(env.DB, "integration.disconnected", "integration", authenticatedSession.id, { service });
        return json({ ok: true });
      }

      if (url.pathname === "/api/gemini/chat" && request.method === "POST") {
        if (!env.GEMINI_API_KEY) {
          return json({ error: "Gemini no está configurado. La integración está pendiente." }, 503);
        }
        const body = await readJson(request);
        const prompt = text(body.prompt, "Consulta").slice(0, 4000);
        const dailyLimit = Math.max(1, Number(env.GEMINI_DAILY_LIMIT ?? "20"));
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const usage = await env.DB.prepare(`
          SELECT COUNT(*) AS count FROM gemini_usage
          WHERE user_id=?1 AND created_at>=?2
        `).bind(authenticatedSession.id, today.toISOString()).first<number>("count");
        if ((usage ?? 0) >= dailyLimit) {
          return json({ error: "Se alcanzó el límite diario de consultas" }, 429);
        }

        const model = env.GEMINI_MODEL ?? "gemini-2.5-flash";
        const started = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        let geminiResponse: Response;
        try {
          geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-goog-api-key": env.GEMINI_API_KEY
              },
              body: JSON.stringify({
                systemInstruction: {
                  parts: [{
                    text: "Eres Group Repair Intelligence. Actúa como asistente técnico, no como autoridad definitiva. Diferencia hechos, hipótesis y recomendaciones. No inventes diagnósticos ni confirmes reparaciones no verificadas. No sugieras ejecutar cambios automáticos."
                  }]
                },
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 800 }
              }),
              signal: controller.signal
            }
          );
        } finally {
          clearTimeout(timeout);
        }
        const responseBody = await geminiResponse.json() as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          error?: { message?: string; code?: number };
        };
        if (!geminiResponse.ok) {
          await env.DB.prepare(
            "INSERT INTO gemini_usage (id,user_id,model,input_chars,output_chars,latency_ms,success,error_code,created_at) VALUES (?1,?2,?3,?4,0,?5,0,?6,?7)"
          ).bind(uuid(), authenticatedSession.id, model, prompt.length, Date.now() - started, String(responseBody.error?.code ?? "gemini_error"), now()).run();
          return json({ error: "Gemini no pudo procesar la consulta" }, 502);
        }
        const answer = responseBody.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
        if (!answer) return json({ error: "Gemini devolvió una respuesta vacía" }, 502);
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO gemini_usage (id,user_id,model,input_chars,output_chars,latency_ms,success,error_code,created_at) VALUES (?1,?2,?3,?4,?5,?6,1,NULL,?7)"
          ).bind(uuid(), authenticatedSession.id, model, prompt.length, answer.length, Date.now() - started, now()),
          env.DB.prepare(
            "INSERT INTO gemini_history (id,user_id,role,content_preview,created_at) VALUES (?1,?2,'user',?3,?4)"
          ).bind(uuid(), authenticatedSession.id, prompt.slice(0, 240), now()),
          env.DB.prepare(
            "INSERT INTO gemini_history (id,user_id,role,content_preview,created_at) VALUES (?1,?2,'assistant',?3,?4)"
          ).bind(uuid(), authenticatedSession.id, answer.slice(0, 240), now())
        ]);
        return json({ answer, model, disclaimer: "Asistente técnico: confirmar diagnósticos y operaciones con criterio humano." });
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
