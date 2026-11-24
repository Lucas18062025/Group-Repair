import { canTransition, ORDER_STATUSES, type OrderStatus } from "./domain/status";
import { calculateLineTotal } from "./domain/money";
import { createPublicReference, isValidEmail, isValidPhone, phonesMatch } from "./domain/assistant";
import {
  ASSISTANT_SYSTEM_INSTRUCTION,
  buildGeminiHistory,
  buildKnowledgeContext,
  classifyAssistantIntent,
  deterministicAssistantReply,
  isValidConversationPublicKey,
  sanitizeForProvider,
  selectRelevantKnowledge,
  validateOrderStatusToolInput
} from "./domain/customer-assistant";
import { parseDateTimeLocalToUtcIso } from "./domain/dates";
import { determineCustomerDeletionAction } from "./domain/customer";
import {
  generateR2StorageKey,
  isValidCategory,
  MAX_PHOTO_SIZE_BYTES,
  sanitizeFileName,
  validateImageSignature
} from "./domain/attachments";
import {
  deserializeOAuthState,
  GOOGLE_DRIVE_SCOPES,
  type GoogleConnectionType,
  isTokenExpired,
  serializeOAuthState
} from "./domain/google-drive";
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

interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpMetadata?: {
    contentType?: string;
    contentDisposition?: string;
  };
  customMetadata?: Record<string, string>;
  writeHttpMetadata?(headers: Headers): void;
}

interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: {
    httpMetadata?: { contentType?: string; contentDisposition?: string };
    customMetadata?: Record<string, string>;
  }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string | string[]): Promise<void>;
}

interface Env {
  DB: D1Database;
  ASSETS: AssetBinding;
  FILES?: R2Bucket;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_BOOTSTRAP_SUB?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_DAILY_LIMIT?: string;
  GEMINI_ASSISTANT_DAILY_LIMIT?: string;
}

const WORKSHOP_ID = "workshop-main";
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    RECEIVED: "Recibida",
    DIAGNOSIS: "En diagnóstico",
    QUOTED: "Presupuestada",
    APPROVED: "Aprobada",
    REJECTED: "Rechazada",
    WAITING_FOR_PARTS: "Esperando repuesto",
    IN_REPAIR: "En reparación",
    TESTING: "En pruebas",
    READY_FOR_DELIVERY: "Lista para entrega",
    DELIVERED: "Entregada",
    NOT_REPAIRABLE: "No reparable",
    CANCELLED: "Cancelada",
    REOPENED: "Reabierta"
  };
  return labels[status] ?? status;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://generativelanguage.googleapis.com https://www.googleapis.com; frame-ancestors 'none'"
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

function validatedPhone(value: unknown): string {
  const raw = text(value, "Teléfono");
  if (!isValidPhone(raw)) throw new Error("Teléfono inválido");
  return raw.slice(0, 40);
}

function optionalEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = text(value, "Email");
  if (!isValidEmail(raw)) throw new Error("Email inválido");
  return raw.slice(0, 180);
}

const NORMALIZED_PHONE_SQL =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+',''),'(',''),')',''),'.','')";

function clientSubject(request: Request): string {
  // Solo confiar en cf-connecting-ip (Cloudflare edge). No usar x-forwarded-for
  // para evitar spoofing fuera del edge.
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  return `ip:${ip}`;
}

async function consumeRateLimit(
  db: D1Database,
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
  const subjectHash = await sha256(`${scope}:${subject}`);
  if (Math.random() < 0.01) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(
      "DELETE FROM chat_rate_limits WHERE workshop_id=?1 AND window_start<?2"
    ).bind(WORKSHOP_ID, cutoff).run();
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const update = await db.prepare(`
      UPDATE chat_rate_limits
      SET request_count=request_count+1,updated_at=?1
      WHERE workshop_id=?2 AND subject_hash=?3 AND window_start=?4 AND request_count<?5
    `).bind(now(), WORKSHOP_ID, subjectHash, windowStart, limit).run() as { meta?: { changes?: number } };
    if ((update.meta?.changes ?? 0) > 0) return true;
    const existing = await db.prepare(`
      SELECT request_count FROM chat_rate_limits
      WHERE workshop_id=?1 AND subject_hash=?2 AND window_start=?3
    `).bind(WORKSHOP_ID, subjectHash, windowStart).first<{ request_count: number }>();
    if (existing) return false;
    await db.prepare(`
      INSERT INTO chat_rate_limits (id,workshop_id,subject_hash,window_start,request_count,updated_at)
      VALUES (?1,?2,?3,?4,0,?5)
      ON CONFLICT(workshop_id,subject_hash,window_start) DO NOTHING
    `).bind(uuid(), WORKSHOP_ID, subjectHash, windowStart, now()).run();
  }
  return false;
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
  await db.prepare(`
    INSERT OR IGNORE INTO users
      (id,workshop_id,name,email,role,status,created_at)
    VALUES ('public-visitor',?1,'Visitante público','public@group-repair.local','viewer','APPROVED',?2)
  `).bind(WORKSHOP_ID, now()).run();
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
  metadata: unknown = null,
  actorId: string | null = null
): Promise<void> {
  await db.prepare(
    "INSERT INTO audit_events (id,workshop_id,actor_id,action,entity_type,entity_id,metadata,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
  ).bind(uuid(), WORKSHOP_ID, actorId, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null, now()).run();
}

function ownsOrCanAdmin(session: SessionUser | null, ownerUserId: string | null): boolean {
  if (!session) return false;
  if (session.role === "admin") return true;
  return ownerUserId !== null && ownerUserId === session.id;
}

function canAccessOrder(session: SessionUser | null, order: { owner_user_id?: string | null; assigned_user_id?: string | null; created_by?: string | null }): boolean {
  if (!session) return false;
  if (["admin", "technical_lead"].includes(session.role)) return true;
  return (order.assigned_user_id !== null && order.assigned_user_id !== undefined && order.assigned_user_id === session.id) ||
         (order.owner_user_id !== null && order.owner_user_id !== undefined && order.owner_user_id === session.id) ||
         (order.created_by !== null && order.created_by !== undefined && order.created_by === session.id);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      await ensureWorkshop(env.DB);
      const url = new URL(request.url);

      // CSRF: validar Origin/Referer en mutaciones
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        const origin = request.headers.get("origin");
        const referer = request.headers.get("referer");
        const allowedOrigin = url.origin;
        if (origin && origin !== allowedOrigin) {
          return json({ error: "Origen no permitido" }, 403);
        }
        if (!origin && referer) {
          try {
            const refOrigin = new URL(referer).origin;
            if (refOrigin !== allowedOrigin) {
              return json({ error: "Origen no permitido" }, 403);
            }
          } catch {
            return json({ error: "Origen no permitido" }, 403);
          }
        }
      }

      if (url.pathname === "/privacy" || url.pathname === "/privacy-policy") {
        return env.ASSETS.fetch(new Request(new URL("/privacy.html", url.origin).toString()));
      }

      if (url.pathname === "/terms" || url.pathname === "/terms-of-service") {
        return env.ASSETS.fetch(new Request(new URL("/terms.html", url.origin).toString()));
      }

      if (url.pathname === "/api/health") {
        return json({ ok: true });
      }

      if (url.pathname === "/api/auth/config" && request.method === "GET") {
        return json({
          googleConfigured: Boolean(env.GOOGLE_CLIENT_ID),
          googleClientId: env.GOOGLE_CLIENT_ID ?? null,
          r2Configured: Boolean(env.FILES)
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

        const payload = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID, nonce);
        await env.DB.prepare("UPDATE oauth_states SET used_at=?1 WHERE nonce=?2 AND used_at IS NULL").bind(now(), nonce).run();
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
          const allowlistEntry = await env.DB.prepare(
            "SELECT id, role FROM google_access_allowlist WHERE workshop_id=?1 AND status='ACTIVE' AND (google_sub=?2 OR email=?3)"
          ).bind(WORKSHOP_ID, payload.sub, payload.email).first<{ id: string; role: string | null }>();
          const isAllowlisted = Boolean(allowlistEntry);
          const allowlistRole = allowlistEntry?.role ?? "viewer";
          const canCreateApproved = isBootstrapAdmin || (activeAdmins !== 0 && isAllowlisted);
          const isInitialBootstrap = activeAdmins === 0 && !env.GOOGLE_BOOTSTRAP_SUB;

          if (activeAdmins !== 0 && !isBootstrapAdmin && !isAllowlisted) {
            return json({ error: "Cuenta no autorizada" }, 403);
          }
          if (activeAdmins === 0 && env.GOOGLE_BOOTSTRAP_SUB && !isBootstrapAdmin) {
            return json({ error: "Cuenta no autorizada" }, 403);
          }
          if (activeAdmins === 0 && isInitialBootstrap) {
            // The first verified Google account remains pending until GOOGLE_BOOTSTRAP_SUB is configured.
          }

          await env.DB.prepare(
            "INSERT INTO users (id,workshop_id,name,email,role,status,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)"
          ).bind(
            userId,
            WORKSHOP_ID,
            payload.name?.trim() || payload.email,
            payload.email,
            isBootstrapAdmin ? "admin" : (isAllowlisted ? allowlistRole : "viewer"),
            canCreateApproved ? "APPROVED" : "PENDING",
            timestamp
          ).run();
          await env.DB.prepare(
            "INSERT INTO google_identities (id,user_id,google_sub,email,email_verified,created_at) VALUES (?1,?2,?3,?4,?5,?6)"
          ).bind(uuid(), userId, payload.sub, payload.email, payload.email_verified ? 1 : 0, timestamp).run();
          user = await env.DB.prepare(
            "SELECT id,workshop_id,name,email,role,status,deactivated_at FROM users WHERE id=?1"
          ).bind(userId).first<SessionUser & { deactivated_at: string | null }>();
          if (!user) return json({ error: "No se pudo crear la cuenta" }, 500);
          if (allowlistEntry) {
            await env.DB.prepare(
              "UPDATE google_access_allowlist SET google_sub=?1,updated_at=?2 WHERE id=?3"
            ).bind(payload.sub, timestamp, allowlistEntry.id).run();
          }
        } else {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO google_identities (id,user_id,google_sub,email,email_verified,created_at) VALUES (?1,?2,?3,?4,?5,?6)"
          ).bind(uuid(), user.id, payload.sub, payload.email, payload.email_verified ? 1 : 0, now()).run();

          const allowlistEntry = await env.DB.prepare(
            "SELECT id, role FROM google_access_allowlist WHERE workshop_id=?1 AND status='ACTIVE' AND (google_sub=?2 OR email=?3)"
          ).bind(WORKSHOP_ID, payload.sub, payload.email).first<{ id: string; role: string | null }>();
          const activeAdmins = await env.DB.prepare(
            "SELECT COUNT(*) AS count FROM users WHERE role='admin' AND status='APPROVED' AND deactivated_at IS NULL"
          ).bind().first<number>("count");
          const isExistingAdmin =
            user.role === "admin" &&
            user.status === "APPROVED" &&
            !user.deactivated_at;
          const isBootstrapAdmin = Boolean(
            activeAdmins === 0 &&
            env.GOOGLE_BOOTSTRAP_SUB &&
            env.GOOGLE_BOOTSTRAP_SUB === payload.sub
          );
          if (!allowlistEntry && !isBootstrapAdmin && !isExistingAdmin) {
            return json({ error: "Cuenta no autorizada" }, 403);
          }
          if (allowlistEntry && user.status === "PENDING") {
            const newRole = allowlistEntry.role ?? user.role;
            await env.DB.prepare(
              "UPDATE users SET status='APPROVED',role=?1,deactivated_at=NULL WHERE id=?2"
            ).bind(newRole, user.id).run();
            user.status = "APPROVED";
            user.role = newRole;
            user.deactivated_at = null;
          }
          if (allowlistEntry) {
            await env.DB.prepare(
              "UPDATE google_access_allowlist SET google_sub=?1,updated_at=?2 WHERE id=?3"
            ).bind(payload.sub, now(), allowlistEntry.id).run();
          }
        }

        const activeAdmins = await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM users WHERE role='admin' AND status='APPROVED' AND deactivated_at IS NULL"
        ).bind().first<number>("count");
        if (
          activeAdmins === 0 &&
          env.GOOGLE_BOOTSTRAP_SUB &&
          env.GOOGLE_BOOTSTRAP_SUB === payload.sub
        ) {
          await env.DB.prepare(
            "UPDATE users SET role='admin',status='APPROVED',deactivated_at=NULL WHERE id=?1"
          ).bind(user.id).run();
          user.role = "admin";
          user.status = "APPROVED";
          user.deactivated_at = null;
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
          user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status },
          googleSub: payload.sub
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
        const identity = await env.DB.prepare(
          "SELECT google_sub FROM google_identities WHERE user_id=?1 LIMIT 1"
        ).bind(session.id).first<{ google_sub: string }>();
        return json({
          user: { id: session.id, name: session.name, email: session.email, role: session.role, status: session.status },
          googleSub: identity?.google_sub ?? null
        });
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
        // Public business operations are intentionally available while authentication
        // is disabled. Administrative and credential-bearing operations remain guarded below.
      }
      const authenticatedSession =
        session && session.status === "APPROVED" && !session.deactivated_at
          ? session
          : null;

      if (url.pathname === "/api/auth/logout-all" && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        await env.DB.prepare("UPDATE auth_sessions SET revoked_at=?1 WHERE user_id=?2 AND revoked_at IS NULL").bind(now(), authenticatedSession.id).run();
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "set-cookie": clearSessionCookie() }
        });
      }

      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (authenticatedSession.role !== "admin") return json({ error: "Permisos insuficientes" }, 403);
        const users = await env.DB.prepare(
          "SELECT id,workshop_id,name,email,role,status,deactivated_at,created_at,last_login_at FROM users WHERE workshop_id=?1 ORDER BY created_at DESC"
        ).bind(WORKSHOP_ID).all();
        return json({ users: users.results });
      }

      const approvalMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/(approve|deactivate)$/);
      if (approvalMatch && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
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

      const roleMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
      if (roleMatch && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (authenticatedSession.role !== "admin") return json({ error: "Permisos insuficientes" }, 403);
        const userId = roleMatch[1];
        if (userId === authenticatedSession.id) return json({ error: "No puedes cambiar tu propio rol" }, 409);
        const body = await readJson(request);
        const role = text(body.role, "Rol");
        const allowedRoles = ["admin", "reception", "technician", "technical_lead", "cashier", "viewer"];
        if (!allowedRoles.includes(role)) return json({ error: "Rol no válido" }, 400);
        await env.DB.prepare(
          "UPDATE users SET role=?1 WHERE id=?2 AND workshop_id=?3"
        ).bind(role, userId, WORKSHOP_ID).run();
        await audit(env.DB, "user.role_changed", "user", userId, { role });
        return json({ ok: true });
      }

      if (url.pathname === "/api/admin/google-accounts" && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (authenticatedSession.role !== "admin") return json({ error: "Permisos insuficientes" }, 403);
        const accounts = await env.DB.prepare(
          "SELECT id,email,google_sub,status,role,created_at,updated_at FROM google_access_allowlist WHERE workshop_id=?1 ORDER BY created_at DESC"
        ).bind(WORKSHOP_ID).all();
        return json({ accounts: accounts.results });
      }

      if (url.pathname === "/api/admin/google-accounts" && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (authenticatedSession.role !== "admin") return json({ error: "Permisos insuficientes" }, 403);
        const body = await readJson(request);
        const email = text(body.email, "Email").toLowerCase();
        const googleSub = body.googleSub ? text(body.googleSub, "Google sub") : null;
        const allowedRoles = ["admin", "reception", "technician", "technical_lead", "cashier", "viewer"];
        const role = allowedRoles.includes(String(body.role ?? "viewer")) ? String(body.role) : "viewer";
        const id = uuid();
        await env.DB.prepare(`
          INSERT INTO google_access_allowlist (id,workshop_id,google_sub,email,status,role,created_by,created_at,updated_at)
          VALUES (?1,?2,?3,?4,'ACTIVE',?5,?6,?7,?8)
          ON CONFLICT(workshop_id,email) DO UPDATE SET
            google_sub=COALESCE(excluded.google_sub,google_access_allowlist.google_sub),
            role=excluded.role,
            status='ACTIVE',updated_at=excluded.updated_at
        `).bind(id, WORKSHOP_ID, googleSub, email, role, authenticatedSession.id, now(), now()).run();
        await audit(env.DB, "google_account.allowlisted", "google_account", id, { email, googleSub: Boolean(googleSub) });
        return json({ ok: true }, 201);
      }

      const allowlistDelete = url.pathname.match(/^\/api\/admin\/google-accounts\/([^/]+)$/);
      if (allowlistDelete && request.method === "DELETE") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (authenticatedSession.role !== "admin") return json({ error: "Permisos insuficientes" }, 403);
        const accountId = allowlistDelete[1];
        const account = await env.DB.prepare(
          "SELECT email,google_sub FROM google_access_allowlist WHERE id=?1 AND workshop_id=?2"
        ).bind(accountId, WORKSHOP_ID).first<{ email: string; google_sub: string | null }>();
        if (account) {
          const accountUser = await env.DB.prepare(`
            SELECT u.id FROM users u
            LEFT JOIN google_identities g ON g.user_id=u.id
            WHERE u.workshop_id=?1 AND (u.email=?2 OR g.google_sub=?3)
            LIMIT 1
          `).bind(WORKSHOP_ID, account.email, account.google_sub).first<{ id: string }>();
          if (accountUser) {
            await env.DB.prepare(
              "UPDATE users SET status='DEACTIVATED',deactivated_at=?1 WHERE id=?2"
            ).bind(now(), accountUser.id).run();
            await env.DB.prepare(
              "UPDATE auth_sessions SET revoked_at=?1 WHERE user_id=?2 AND revoked_at IS NULL"
            ).bind(now(), accountUser.id).run();
          }
        }
        await env.DB.prepare(
          "DELETE FROM google_access_allowlist WHERE id=?1 AND workshop_id=?2"
        ).bind(accountId, WORKSHOP_ID).run();
        await audit(env.DB, "google_account.removed", "google_account", accountId);
        return json({ ok: true });
      }

      // --- Google Drive Integration Endpoints ---
      if (url.pathname === "/api/integrations/google/status" && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "No autenticado" }, 401);

        const workshopConn = await env.DB.prepare(`
          SELECT id, service, account_email, status, connection_type, connected_at, expires_at, updated_at
          FROM google_connections
          WHERE workshop_id=?1 AND connection_type='WORKSHOP' AND status='connected'
          LIMIT 1
        `).bind(WORKSHOP_ID).first<{
          id: string;
          service: string;
          account_email: string | null;
          status: string;
          connection_type: string;
          connected_at: string | null;
          expires_at: string | null;
          updated_at: string;
        }>();

        const personalConn = await env.DB.prepare(`
          SELECT id, service, account_email, status, connection_type, connected_at, expires_at, updated_at
          FROM google_connections
          WHERE user_id=?1 AND connection_type='PERSONAL' AND status='connected'
          LIMIT 1
        `).bind(authenticatedSession.id).first<{
          id: string;
          service: string;
          account_email: string | null;
          status: string;
          connection_type: string;
          connected_at: string | null;
          expires_at: string | null;
          updated_at: string;
        }>();

        return json({
          googleConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
          r2Configured: Boolean(env.FILES),
          workshop: workshopConn ? {
            connected: true,
            email: workshopConn.account_email,
            connectedAt: workshopConn.connected_at
          } : { connected: false },
          personal: personalConn ? {
            connected: true,
            email: personalConn.account_email,
            connectedAt: personalConn.connected_at
          } : { connected: false }
        });
      }

      if (url.pathname === "/api/integrations/google/connect" && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Iniciá sesión para autorizar Google Drive" }, 401);
        const body = await readJson(request) as { connectionType?: string };
        const connectionType = (body.connectionType === "WORKSHOP" ? "WORKSHOP" : "PERSONAL") as GoogleConnectionType;

        if (connectionType === "WORKSHOP" && authenticatedSession.role !== "admin") {
          return json({ error: "Solo los administradores pueden conectar el Google Drive del taller" }, 403);
        }

        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
          return json({ error: "Google OAuth no está configurado. Pendiente de credenciales externas." }, 503);
        }

        const verifier = randomToken(64);
        const challenge = await sha256(verifier);
        const redirectUri = env.GOOGLE_REDIRECT_URI ?? `${url.origin}/api/auth/callback/google`;
        const csrf = randomToken(24);
        const state = serializeOAuthState({
          csrfToken: csrf,
          userId: authenticatedSession.id,
          connectionType,
          workshopId: WORKSHOP_ID,
          timestamp: Date.now()
        });

        await env.DB.prepare(
          "INSERT INTO oauth_states (id,state,pkce_verifier_hash,pkce_verifier,user_id,service,redirect_uri,expires_at,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
        ).bind(
          uuid(),
          state,
          challenge,
          verifier,
          authenticatedSession.id,
          connectionType === "WORKSHOP" ? "google_drive_workshop" : "google_drive_personal",
          redirectUri,
          new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          now()
        ).run();

        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", GOOGLE_DRIVE_SCOPES.join(" "));
        authUrl.searchParams.set("include_granted_scopes", "true");
        authUrl.searchParams.set("access_type", "offline");
        authUrl.searchParams.set("prompt", "consent");
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", challenge);
        authUrl.searchParams.set("code_challenge_method", "S256");

        return json({ authUrl: authUrl.toString() });
      }

      if (url.pathname === "/api/auth/callback/google" && request.method === "GET") {
        if (!authenticatedSession) {
          return new Response(null, { status: 302, headers: { location: "/?google_error=auth_required" } });
        }
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const oauthError = url.searchParams.get("error");
        if (oauthError) return new Response(null, { status: 302, headers: { location: "/?google_error=consent_declined" } });
        if (!state || !code) return json({ error: "Respuesta OAuth incompleta" }, 400);

        const parsedState = deserializeOAuthState(state);
        if (!parsedState) return json({ error: "Estado OAuth manipulado o inválido" }, 400);

        const record = await env.DB.prepare(`
          SELECT state,user_id,service,redirect_uri,pkce_verifier,expires_at,used_at
          FROM oauth_states WHERE state=?1
        `).bind(state).first<{
          state: string;
          user_id: string;
          service: string;
          redirect_uri: string;
          pkce_verifier: string;
          expires_at: string;
          used_at: string | null;
        }>();

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
          return json({ error: tokenBody.error ?? "No se pudieron intercambiar las credenciales con Google" }, 502);
        }

        if (!env.OAUTH_TOKEN_ENCRYPTION_KEY) {
          return json({ error: "Falta la clave de cifrado de tokens OAuth" }, 503);
        }

        let accountEmail: string | null = null;
        try {
          const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${tokenBody.access_token}` }
          });
          if (userInfoRes.ok) {
            const uInfo = await userInfoRes.json() as { email?: string };
            accountEmail = uInfo.email ?? null;
          }
        } catch {
          // Continuar si falla la lectura de perfil
        }

        const accessEncrypted = await encryptSecret(tokenBody.access_token, env.OAUTH_TOKEN_ENCRYPTION_KEY);
        const refreshEncrypted = tokenBody.refresh_token
          ? await encryptSecret(tokenBody.refresh_token, env.OAUTH_TOKEN_ENCRYPTION_KEY)
          : null;
        const expiresAt = new Date(Date.now() + (tokenBody.expires_in ?? 3600) * 1000).toISOString();
        const connType = parsedState.connectionType;
        const service = connType === "WORKSHOP" ? "google_drive_workshop" : "google_drive_personal";

        await env.DB.prepare(`
          INSERT INTO google_connections (
            id, user_id, service, account_email, status, access_token_encrypted,
            refresh_token_encrypted, scopes, expires_at, connected_at, workshop_id,
            connection_type, created_at, updated_at
          )
          VALUES (?1, ?2, ?3, ?4, 'connected', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
          ON CONFLICT(user_id, service) DO UPDATE SET
            status='connected',
            account_email=COALESCE(excluded.account_email, google_connections.account_email),
            access_token_encrypted=excluded.access_token_encrypted,
            refresh_token_encrypted=COALESCE(excluded.refresh_token_encrypted, google_connections.refresh_token_encrypted),
            scopes=excluded.scopes,
            expires_at=excluded.expires_at,
            connected_at=excluded.connected_at,
            workshop_id=excluded.workshop_id,
            connection_type=excluded.connection_type,
            revoked_at=NULL,
            error=NULL,
            updated_at=excluded.updated_at
        `).bind(
          uuid(),
          authenticatedSession.id,
          service,
          accountEmail,
          accessEncrypted,
          refreshEncrypted,
          tokenBody.scope ?? GOOGLE_DRIVE_SCOPES.join(" "),
          expiresAt,
          now(),
          WORKSHOP_ID,
          connType,
          now(),
          now()
        ).run();

        await audit(env.DB, "google_drive.connected", "integration", authenticatedSession.id, {
          connectionType: connType,
          email: accountEmail
        });

        return new Response(null, {
          status: 302,
          headers: { location: `/?google_connected=${connType.toLowerCase()}` }
        });
      }

      if (url.pathname === "/api/integrations/google/disconnect" && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const body = await readJson(request) as { connectionType?: string };
        const connectionType = body.connectionType === "WORKSHOP" ? "WORKSHOP" : "PERSONAL";

        if (connectionType === "WORKSHOP" && authenticatedSession.role !== "admin") {
          return json({ error: "Solo los administradores pueden desconectar el Google Drive del taller" }, 403);
        }

        if (connectionType === "WORKSHOP") {
          await env.DB.prepare(`
            UPDATE google_connections
            SET status='disconnected', access_token_encrypted=NULL, refresh_token_encrypted=NULL,
                revoked_at=?1, updated_at=?1
            WHERE workshop_id=?2 AND connection_type='WORKSHOP'
          `).bind(now(), WORKSHOP_ID).run();
        } else {
          await env.DB.prepare(`
            UPDATE google_connections
            SET status='disconnected', access_token_encrypted=NULL, refresh_token_encrypted=NULL,
                revoked_at=?1, updated_at=?1
            WHERE user_id=?2 AND connection_type='PERSONAL'
          `).bind(now(), authenticatedSession.id).run();
        }

        await audit(env.DB, "google_drive.disconnected", "integration", authenticatedSession.id, { connectionType });
        return json({ ok: true });
      }

      if (url.pathname === "/api/integrations/google/picker-token" && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const connType = (url.searchParams.get("connectionType") === "PERSONAL" ? "PERSONAL" : "WORKSHOP") as GoogleConnectionType;

        let conn = null;
        if (connType === "WORKSHOP") {
          conn = await env.DB.prepare(`
            SELECT id, account_email, access_token_encrypted, refresh_token_encrypted, expires_at
            FROM google_connections
            WHERE workshop_id=?1 AND connection_type='WORKSHOP' AND status='connected'
            LIMIT 1
          `).bind(WORKSHOP_ID).first<{
            id: string;
            account_email: string | null;
            access_token_encrypted: string | null;
            refresh_token_encrypted: string | null;
            expires_at: string | null;
          }>();
        } else {
          conn = await env.DB.prepare(`
            SELECT id, account_email, access_token_encrypted, refresh_token_encrypted, expires_at
            FROM google_connections
            WHERE user_id=?1 AND connection_type='PERSONAL' AND status='connected'
            LIMIT 1
          `).bind(authenticatedSession.id).first<{
            id: string;
            account_email: string | null;
            access_token_encrypted: string | null;
            refresh_token_encrypted: string | null;
            expires_at: string | null;
          }>();
        }

        if (!conn || !conn.access_token_encrypted) {
          return json({ error: `No hay cuenta de Google Drive (${connType}) conectada` }, 404);
        }

        if (!env.OAUTH_TOKEN_ENCRYPTION_KEY) {
          return json({ error: "Falta configuración de cifrado" }, 503);
        }

        let accessToken: string;
        if (conn.expires_at && isTokenExpired(conn.expires_at)) {
          if (!conn.refresh_token_encrypted || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
            return json({ error: "Token de acceso expirado y no se puede renovar automáticamente" }, 401);
          }
          const refreshToken = await decryptSecret(conn.refresh_token_encrypted, env.OAUTH_TOKEN_ENCRYPTION_KEY);
          const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: env.GOOGLE_CLIENT_ID,
              client_secret: env.GOOGLE_CLIENT_SECRET,
              refresh_token: refreshToken,
              grant_type: "refresh_token"
            })
          });
          const refreshBody = await refreshRes.json() as { access_token?: string; expires_in?: number; error?: string };
          if (!refreshRes.ok || !refreshBody.access_token) {
            return json({ error: refreshBody.error ?? "No se pudo renovar el token de Google" }, 502);
          }
          accessToken = refreshBody.access_token;
          const accessEncrypted = await encryptSecret(accessToken, env.OAUTH_TOKEN_ENCRYPTION_KEY);
          const newExpiresAt = new Date(Date.now() + (refreshBody.expires_in ?? 3600) * 1000).toISOString();
          await env.DB.prepare(`
            UPDATE google_connections
            SET access_token_encrypted=?1, expires_at=?2, updated_at=?3
            WHERE id=?4
          `).bind(accessEncrypted, newExpiresAt, now(), conn.id).run();
        } else {
          accessToken = await decryptSecret(conn.access_token_encrypted, env.OAUTH_TOKEN_ENCRYPTION_KEY);
        }

        return json({
          accessToken,
          email: conn.account_email,
          connectionType: connType,
          appId: env.GOOGLE_CLIENT_ID ? env.GOOGLE_CLIENT_ID.split("-")[0] : null
        });
      }

      // --- Order Attachments & Photos Endpoints ---
      const orderAttachmentsMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/attachments$/);
      if (orderAttachmentsMatch && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const orderId = orderAttachmentsMatch[1];
        const order = await env.DB.prepare(
          "SELECT id, workshop_id, assigned_user_id, created_by FROM repair_orders WHERE id=?1 AND workshop_id=?2"
        ).bind(orderId, WORKSHOP_ID).first<{ id: string; workshop_id: string; assigned_user_id: string | null; created_by: string | null }>();
        if (!order) return json({ error: "Orden no encontrada" }, 404);
        if (!canAccessOrder(authenticatedSession, order)) {
          return json({ error: "No tenés permiso para acceder a los archivos de esta orden" }, 403);
        }
        const attachments = await env.DB.prepare(`
          SELECT a.id, a.order_id, a.storage_provider, a.external_file_id, a.file_name,
                 a.mime_type, a.file_size, a.category, a.uploaded_by, a.web_view_link,
                 a.created_at, u.name AS uploader_name, gc.connection_type AS drive_origin
          FROM order_attachments a
          LEFT JOIN users u ON u.id = a.uploaded_by
          LEFT JOIN google_connections gc ON gc.id = a.source_connection_id
          WHERE a.workshop_id=?1 AND a.order_id=?2 AND a.deleted_at IS NULL
          ORDER BY a.created_at DESC
        `).bind(WORKSHOP_ID, orderId).all();
        return json({ attachments: attachments.results });
      }

      const orderPhotoUploadMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/attachments\/photo$/);
      if (orderPhotoUploadMatch && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const orderId = orderPhotoUploadMatch[1];
        const order = await env.DB.prepare(
          "SELECT id, workshop_id, device_id, assigned_user_id, created_by FROM repair_orders WHERE id=?1 AND workshop_id=?2"
        ).bind(orderId, WORKSHOP_ID).first<{ id: string; workshop_id: string; device_id: string | null; assigned_user_id: string | null; created_by: string | null }>();
        if (!order) return json({ error: "Orden no encontrada" }, 404);
        if (!canAccessOrder(authenticatedSession, order)) {
          return json({ error: "No tenés permiso para subir fotografías a esta orden" }, 403);
        }
        if (!env.FILES) {
          return json({ error: "El almacenamiento R2 no está configurado en este entorno" }, 503);
        }

        const formData = await request.formData();
        const file = formData.get("photo");
        if (!file || typeof file === "string") {
          return json({ error: "Se requiere un archivo de imagen ('photo')" }, 400);
        }
        const categoryInput = formData.get("category")?.toString() ?? "RECEPCION";
        const category = isValidCategory(categoryInput) ? categoryInput : "RECEPCION";

        if (file.size > MAX_PHOTO_SIZE_BYTES) {
          return json({ error: "El archivo supera el tamaño máximo permitido de 15MB" }, 400);
        }

        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const sigValidation = validateImageSignature(bytes);
        if (!sigValidation.valid || !sigValidation.detectedMime) {
          return json({ error: "Formato de archivo no válido. Solo se admiten JPEG, PNG o WebP." }, 400);
        }

        const attachmentId = uuid();
        const sanitizedName = sanitizeFileName(file.name || `photo_${Date.now()}.${sigValidation.detectedMime.split("/")[1]}`);
        const storageKey = generateR2StorageKey(WORKSHOP_ID, orderId, attachmentId, sanitizedName);

        await env.FILES.put(storageKey, arrayBuffer, {
          httpMetadata: {
            contentType: sigValidation.detectedMime
          },
          customMetadata: {
            workshopId: WORKSHOP_ID,
            orderId,
            uploadedBy: authenticatedSession.id,
            category
          }
        });

        await env.DB.prepare(`
          INSERT INTO order_attachments (
            id, workshop_id, order_id, device_id, storage_provider,
            object_key, file_name, mime_type, file_size, category,
            uploaded_by, visibility, created_at
          )
          VALUES (?1, ?2, ?3, ?4, 'R2', ?5, ?6, ?7, ?8, ?9, ?10, 'INTERNAL', ?11)
        `).bind(
          attachmentId,
          WORKSHOP_ID,
          orderId,
          order.device_id,
          storageKey,
          sanitizedName,
          sigValidation.detectedMime,
          file.size,
          category,
          authenticatedSession.id,
          now()
        ).run();

        await audit(env.DB, "order.attachment_uploaded", "order_attachment", attachmentId, {
          orderId,
          category,
          fileName: sanitizedName,
          fileSize: file.size
        });

        return json({
          id: attachmentId,
          orderId,
          storageProvider: "R2",
          fileName: sanitizedName,
          mimeType: sigValidation.detectedMime,
          fileSize: file.size,
          category,
          createdAt: now()
        }, 201);
      }

      const attachmentContentMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)\/content$/);
      if (attachmentContentMatch && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const attachmentId = attachmentContentMatch[1];
        const attachment = await env.DB.prepare(`
          SELECT a.id, a.workshop_id, a.order_id, a.storage_provider, a.object_key,
                 a.file_name, a.mime_type, ro.assigned_user_id, ro.created_by
          FROM order_attachments a
          JOIN repair_orders ro ON ro.id = a.order_id
          WHERE a.id=?1 AND a.workshop_id=?2 AND a.deleted_at IS NULL
        `).bind(attachmentId, WORKSHOP_ID).first<{
          id: string;
          workshop_id: string;
          order_id: string;
          storage_provider: string;
          object_key: string | null;
          file_name: string;
          mime_type: string;
          assigned_user_id: string | null;
          created_by: string | null;
        }>();

        if (!attachment) return json({ error: "Archivo no encontrado" }, 404);
        if (!canAccessOrder(authenticatedSession, attachment)) {
          return json({ error: "No tenés permiso para ver este archivo" }, 403);
        }
        if (attachment.storage_provider !== "R2" || !attachment.object_key) {
          return json({ error: "Este archivo no se almacena en R2" }, 400);
        }
        if (!env.FILES) {
          return json({ error: "Almacenamiento R2 no disponible" }, 503);
        }

        const object = await env.FILES.get(attachment.object_key);
        if (!object) return json({ error: "El archivo no existe en el almacenamiento" }, 404);

        const headers = new Headers();
        headers.set("Content-Type", attachment.mime_type || "application/octet-stream");
        const safeFileName = encodeURIComponent(attachment.file_name).replace(/'/g, "%27");
        headers.set("Content-Disposition", `inline; filename*=UTF-8''${safeFileName}`);
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Cache-Control", "private, max-age=3600");
        headers.set("Content-Security-Policy", "default-src 'none'; sandbox");

        return new Response(object.body as ReadableStream, {
          status: 200,
          headers
        });
      }

      const orderDriveLinkMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/attachments\/drive$/);
      if (orderDriveLinkMatch && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const orderId = orderDriveLinkMatch[1];
        const order = await env.DB.prepare(
          "SELECT id, workshop_id, device_id, assigned_user_id, created_by FROM repair_orders WHERE id=?1 AND workshop_id=?2"
        ).bind(orderId, WORKSHOP_ID).first<{ id: string; workshop_id: string; device_id: string | null; assigned_user_id: string | null; created_by: string | null }>();
        if (!order) return json({ error: "Orden no encontrada" }, 404);
        if (!canAccessOrder(authenticatedSession, order)) {
          return json({ error: "No tenés permiso para adjuntar documentos a esta orden" }, 403);
        }

        const body = await readJson(request) as {
          driveFileId?: string;
          fileName?: string;
          mimeType?: string;
          webViewLink?: string;
          fileSize?: number;
          origin?: string;
          category?: string;
        };

        const driveFileId = text(body.driveFileId, "ID de archivo en Drive");
        const fileName = text(body.fileName, "Nombre de archivo");
        const mimeType = body.mimeType || "application/octet-stream";
        const webViewLink = body.webViewLink || null;
        const origin = (body.origin === "WORKSHOP" ? "WORKSHOP" : "PERSONAL") as GoogleConnectionType;
        const category = isValidCategory(body.category ?? "") ? body.category! : "OTROS";

        let sourceConn = null;
        if (origin === "WORKSHOP") {
          sourceConn = await env.DB.prepare(
            "SELECT id FROM google_connections WHERE workshop_id=?1 AND connection_type='WORKSHOP' AND status='connected' LIMIT 1"
          ).bind(WORKSHOP_ID).first<{ id: string }>();
        } else {
          sourceConn = await env.DB.prepare(
            "SELECT id FROM google_connections WHERE user_id=?1 AND connection_type='PERSONAL' AND status='connected' LIMIT 1"
          ).bind(authenticatedSession.id).first<{ id: string }>();
        }

        const attachmentId = uuid();
        await env.DB.prepare(`
          INSERT INTO order_attachments (
            id, workshop_id, order_id, device_id, storage_provider,
            source_connection_id, external_file_id, file_name, mime_type,
            file_size, category, uploaded_by, visibility, web_view_link, created_at
          )
          VALUES (?1, ?2, ?3, ?4, 'GOOGLE_DRIVE', ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'INTERNAL', ?12, ?13)
        `).bind(
          attachmentId,
          WORKSHOP_ID,
          orderId,
          order.device_id,
          sourceConn?.id ?? null,
          driveFileId,
          fileName,
          mimeType,
          body.fileSize || 0,
          category,
          authenticatedSession.id,
          webViewLink,
          now()
        ).run();

        await audit(env.DB, "order.drive_document_linked", "order_attachment", attachmentId, {
          orderId,
          driveFileId,
          fileName,
          origin
        });

        return json({
          id: attachmentId,
          orderId,
          storageProvider: "GOOGLE_DRIVE",
          fileName,
          mimeType,
          webViewLink,
          category,
          createdAt: now()
        }, 201);
      }

      const orderAttachmentDeleteMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/attachments\/([^/]+)$/);
      if (orderAttachmentDeleteMatch && request.method === "DELETE") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const orderId = orderAttachmentDeleteMatch[1];
        const attachmentId = orderAttachmentDeleteMatch[2];

        const attachment = await env.DB.prepare(`
          SELECT a.id, a.workshop_id, a.order_id, a.uploaded_by, ro.assigned_user_id, ro.created_by
          FROM order_attachments a
          JOIN repair_orders ro ON ro.id = a.order_id
          WHERE a.id=?1 AND a.order_id=?2 AND a.workshop_id=?3 AND a.deleted_at IS NULL
        `).bind(attachmentId, orderId, WORKSHOP_ID).first<{
          id: string;
          workshop_id: string;
          order_id: string;
          uploaded_by: string;
          assigned_user_id: string | null;
          created_by: string | null;
        }>();

        if (!attachment) return json({ error: "Archivo adjunto no encontrado" }, 404);

        const canDelete = authenticatedSession.role === "admin" || attachment.uploaded_by === authenticatedSession.id;
        if (!canDelete) {
          return json({ error: "Solo los administradores o el usuario que subió el archivo pueden eliminarlo" }, 403);
        }

        await env.DB.prepare(
          "UPDATE order_attachments SET deleted_at=?1 WHERE id=?2 AND workshop_id=?3"
        ).bind(now(), attachmentId, WORKSHOP_ID).run();

        await audit(env.DB, "order.attachment_deleted", "order_attachment", attachmentId, { orderId });
        return json({ ok: true });
      }

      if (url.pathname === "/api/dashboard" && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const [orders, customers, devices, lowStock, payments] = await Promise.all([
          env.DB.prepare("SELECT status, COUNT(*) AS count FROM repair_orders WHERE workshop_id=?1 GROUP BY status").bind(WORKSHOP_ID).all<{ status: string; count: number }>(),
          env.DB.prepare("SELECT COUNT(*) AS count FROM customers WHERE workshop_id=?1 AND status='ACTIVO'").bind(WORKSHOP_ID).first<number>("count"),
          env.DB.prepare("SELECT COUNT(*) AS count FROM devices WHERE workshop_id=?1").bind(WORKSHOP_ID).first<number>("count"),
          env.DB.prepare(`
            SELECT p.id,p.sku,p.name,p.minimum_stock,
              COALESCE(SUM(CASE WHEN sm.kind IN ('IN','RETURN','ADJUSTMENT_IN') THEN sm.quantity ELSE -sm.quantity END),0) AS stock
            FROM parts p LEFT JOIN stock_movements sm ON sm.part_id=p.id
            WHERE p.workshop_id=?1 AND p.status='ACTIVO' GROUP BY p.id HAVING stock <= p.minimum_stock
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
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const result = await env.DB.prepare(
          `SELECT c.id,c.name,c.surname,c.phone,c.email,c.address,c.observations,c.status,c.owner_user_id,c.created_at,c.updated_at,
                  COUNT(DISTINCT d.id) AS device_count,
                  COUNT(DISTINCT ro.id) AS order_count
           FROM customers c
           LEFT JOIN devices d ON d.customer_id=c.id AND d.workshop_id=c.workshop_id
           LEFT JOIN repair_orders ro ON ro.customer_id=c.id AND ro.workshop_id=c.workshop_id
           WHERE c.workshop_id=?1 AND c.status='ACTIVO'
           GROUP BY c.id
           ORDER BY c.created_at DESC LIMIT 100`
        ).bind(WORKSHOP_ID).all();
        return json({ customers: result.results });
      }

      if (url.pathname === "/api/customers" && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para crear clientes" }, 401);
        const body = await readJson(request);
        const id = uuid();
        const timestamp = now();
        await env.DB.prepare(
          "INSERT INTO customers (id,workshop_id,name,surname,phone,email,address,observations,status,owner_user_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'ACTIVO',?9,?10,?11)"
        ).bind(
          id, WORKSHOP_ID,
          text(body.name, "Nombre"),
          body.surname ? text(body.surname, "Apellido") : null,
          text(body.phone, "Teléfono"),
          body.email ? text(body.email, "Email") : null,
          body.address ? text(body.address, "Dirección") : null,
          body.observations ? text(body.observations, "Observaciones") : null,
          authenticatedSession.id, timestamp, timestamp
        ).run();
        await audit(env.DB, "customer.created", "customer", id, { name: body.name });
        return json({ id }, 201);
      }

      const customerMatch = url.pathname.match(/^\/api\/customers\/([^/]+)$/);
      if (customerMatch && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const customerId = customerMatch[1];
        const customer = await env.DB.prepare(`
          SELECT c.*,COUNT(DISTINCT d.id) AS device_count,COUNT(DISTINCT ro.id) AS order_count
          FROM customers c
          LEFT JOIN devices d ON d.customer_id=c.id AND d.workshop_id=c.workshop_id
          LEFT JOIN repair_orders ro ON ro.customer_id=c.id AND ro.workshop_id=c.workshop_id
          WHERE c.id=?1 AND c.workshop_id=?2 GROUP BY c.id
        `).bind(customerId, WORKSHOP_ID).first();
        if (!customer) return json({ error: "Cliente no encontrado" }, 404);
        const [devices, orders] = await Promise.all([
          env.DB.prepare(
            "SELECT id,category,brand,model,serial_number,physical_condition,reported_fault,accessories,created_at FROM devices WHERE customer_id=?1 AND workshop_id=?2 ORDER BY created_at DESC"
          ).bind(customerId, WORKSHOP_ID).all(),
          env.DB.prepare(`
            SELECT ro.id,ro.reference,ro.reported_issue,ro.priority,ro.status,ro.received_at,ro.created_at,ro.updated_at,
                   d.brand,d.model
            FROM repair_orders ro JOIN devices d ON d.id=ro.device_id
            WHERE ro.customer_id=?1 AND ro.workshop_id=?2 ORDER BY ro.created_at DESC
          `).bind(customerId, WORKSHOP_ID).all()
        ]);
        return json({ customer, devices: devices.results, orders: orders.results });
      }

      if (customerMatch && request.method === "PATCH") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para editar clientes" }, 401);
        const customerId = customerMatch[1];
        const existing = await env.DB.prepare(
          "SELECT owner_user_id FROM customers WHERE id=?1 AND workshop_id=?2"
        ).bind(customerId, WORKSHOP_ID).first<{ owner_user_id: string | null }>();
        if (!existing) return json({ error: "Cliente no encontrado" }, 404);
        if (!ownsOrCanAdmin(authenticatedSession, existing.owner_user_id)) {
          return json({ error: "No tienes permiso para modificar este cliente" }, 403);
        }
        const body = await readJson(request);
        await env.DB.prepare(`
          UPDATE customers SET
            name=?1,surname=?2,phone=?3,email=?4,address=?5,observations=?6,status=?7,updated_at=?8
          WHERE id=?9 AND workshop_id=?10
        `).bind(
          text(body.name, "Nombre"),
          body.surname ? text(body.surname, "Apellido") : null,
          text(body.phone, "Teléfono"),
          body.email ? text(body.email, "Email") : null,
          body.address ? text(body.address, "Dirección") : null,
          body.observations ? text(body.observations, "Observaciones") : null,
          body.status ? text(body.status, "Estado").toUpperCase() : "ACTIVO",
          now(), customerId, WORKSHOP_ID
        ).run();
        await audit(env.DB, "customer.updated", "customer", customerId);
        return json({ ok: true });
      }

      if (customerMatch && request.method === "DELETE") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para eliminar clientes" }, 401);
        const customerId = customerMatch[1];
        const existing = await env.DB.prepare(
          "SELECT owner_user_id,name,status FROM customers WHERE id=?1 AND workshop_id=?2"
        ).bind(customerId, WORKSHOP_ID).first<{ owner_user_id: string | null; name: string; status: string }>();
        if (!existing) return json({ error: "Cliente no encontrado" }, 404);
        if (!ownsOrCanAdmin(authenticatedSession, existing.owner_user_id)) {
          return json({ error: "No tienes permiso para eliminar este cliente" }, 403);
        }
        const body = await readJson(request);
        if (body.confirmName !== existing.name) {
          return json({
            error: "Confirmación por nombre requerida"
          }, 409);
        }

        const counts = await env.DB.prepare(`
          SELECT
            (SELECT COUNT(*) FROM devices WHERE customer_id=?1 AND workshop_id=?2) AS devices,
            (SELECT COUNT(*) FROM repair_orders WHERE customer_id=?1 AND workshop_id=?2) AS orders,
            (SELECT COUNT(*) FROM chat_conversations WHERE customer_id=?1 AND workshop_id=?2) AS chats,
            (SELECT COUNT(*) FROM service_requests WHERE customer_id=?1 AND workshop_id=?2) AS requests
        `).bind(customerId, WORKSHOP_ID).first<{ devices: number; orders: number; chats: number; requests: number }>();

        const dependencies = {
          devices: counts?.devices ?? 0,
          orders: counts?.orders ?? 0,
          chats: counts?.chats ?? 0,
          requests: counts?.requests ?? 0
        };

        const action = determineCustomerDeletionAction(dependencies);

        if (action === "archive") {
          // Caso B: Cliente con registros relacionados -> Archivar de forma segura sin eliminar órdenes ni equipos
          await env.DB.prepare(
            "UPDATE customers SET status='ARCHIVADO',updated_at=?1 WHERE id=?2 AND workshop_id=?3"
          ).bind(now(), customerId, WORKSHOP_ID).run();
          await audit(env.DB, "customer.archived", "customer", customerId, { dependencies }, authenticatedSession.id);
          return json({
            ok: true,
            action: "archived",
            message: "Cliente archivado. Se conserva su historial y registros asociados.",
            dependencies
          });
        }

        // Caso A: Cliente sin registros relacionados -> Eliminación definitiva física en D1
        await env.DB.prepare(
          "DELETE FROM customers WHERE workshop_id=?1 AND id=?2"
        ).bind(WORKSHOP_ID, customerId).run();
        await audit(env.DB, "customer.deleted", "customer", customerId, null, authenticatedSession.id);
        return json({
          ok: true,
          action: "deleted",
          message: "Cliente eliminado definitivamente"
        });
      }

      if (url.pathname === "/api/devices" && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para registrar equipos" }, 401);
        const body = await readJson(request);
        const id = uuid();
        await env.DB.prepare(
          "INSERT INTO devices (id,workshop_id,customer_id,category,brand,model,serial_number,physical_condition,reported_fault,accessories,owner_user_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)"
        ).bind(id, WORKSHOP_ID, text(body.customerId, "Cliente"), text(body.category, "Categoría"), text(body.brand, "Marca"), text(body.model, "Modelo"), body.serialNumber ? text(body.serialNumber, "Serie/IMEI") : null, body.physicalCondition ? text(body.physicalCondition, "Condición") : null, body.reportedFault ? text(body.reportedFault, "Falla") : null, body.accessories ? text(body.accessories, "Accesorios") : null, authenticatedSession.id, now()).run();
        await audit(env.DB, "device.created", "device", id);
        return json({ id }, 201);
      }

      if (url.pathname === "/api/devices" && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const customerId = url.searchParams.get("customer");
        let statement: D1PreparedStatement;
        if (customerId) {
          statement = env.DB.prepare(
            "SELECT id,customer_id,category,brand,model,serial_number,physical_condition,reported_fault,accessories,created_at FROM devices WHERE workshop_id=?1 AND customer_id=?2 ORDER BY created_at DESC"
          ).bind(WORKSHOP_ID, customerId);
        } else {
          statement = env.DB.prepare(
            "SELECT id,customer_id,category,brand,model,serial_number,physical_condition,reported_fault,accessories,created_at FROM devices WHERE workshop_id=?1 ORDER BY created_at DESC"
          ).bind(WORKSHOP_ID);
        }
        const result = await statement.all();
        return json({ devices: result.results });
      }

      if (url.pathname === "/api/orders" && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const result = await env.DB.prepare(`
          SELECT ro.id,ro.reference,ro.reported_issue,ro.priority,ro.status,ro.created_at,
                 ro.received_at,ro.observations,ro.accessories,ro.assigned_user_id,
                 c.id AS customer_id,c.name AS customer_name,c.phone AS customer_phone,
                 d.id AS device_id,d.category,d.brand,d.model,d.serial_number,d.physical_condition,d.reported_fault,
                 u.name AS technician_name,
                 COALESCE((SELECT q.total_minor FROM quote_versions q WHERE q.order_id=ro.id AND q.workshop_id=?1 ORDER BY q.version DESC LIMIT 1),0) AS total_minor
          FROM repair_orders ro
          JOIN customers c ON c.id=ro.customer_id
          JOIN devices d ON d.id=ro.device_id
          LEFT JOIN users u ON u.id=ro.assigned_user_id
          WHERE ro.workshop_id=?1 ORDER BY ro.created_at DESC LIMIT 100
        `).bind(WORKSHOP_ID).all();
        return json({ orders: result.results });
      }

      if (url.pathname === "/api/orders" && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para crear órdenes" }, 401);
        const body = await readJson(request);
        const id = uuid();
        const timestamp = now();
        const customerId = text(body.customerId, "Cliente");
        const deviceId = text(body.deviceId, "Equipo");
        const customer = await env.DB.prepare(
          "SELECT id FROM customers WHERE id=?1 AND workshop_id=?2"
        ).bind(customerId, WORKSHOP_ID).first("id");
        const device = await env.DB.prepare(
          "SELECT id FROM devices WHERE id=?1 AND customer_id=?2 AND workshop_id=?3"
        ).bind(deviceId, customerId, WORKSHOP_ID).first("id");
        if (!customer || !device) return json({ error: "Cliente o equipo no válido" }, 400);
        const lastReference = await env.DB.prepare(`
          SELECT CAST(SUBSTR(reference,4) AS INTEGER) AS number
          FROM repair_orders WHERE workshop_id=?1
          ORDER BY CAST(SUBSTR(reference,4) AS INTEGER) DESC LIMIT 1
        `).bind(WORKSHOP_ID).first<{ number: number }>();
        const reference = `GR-${String((lastReference?.number ?? 0) + 1).padStart(5, "0")}`;
        const status = body.status ? text(body.status, "Estado").toUpperCase() : "RECEIVED";
        if (!(ORDER_STATUSES as readonly string[]).includes(status)) return json({ error: "Estado inicial no válido" }, 400);
        if (status !== "RECEIVED") return json({ error: "La orden debe iniciar en estado Recibida" }, 400);
        const receivedAt = body.receivedAt ? parseDateTimeLocalToUtcIso(text(body.receivedAt, "Fecha de recepción")) : timestamp;
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO repair_orders (id,workshop_id,customer_id,device_id,reference,reported_issue,priority,status,estimated_completion_at,received_at,observations,accessories,assigned_user_id,owner_user_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)"
          ).bind(
            id, WORKSHOP_ID, customerId, deviceId, reference,
            text(body.reportedIssue, "Problema"),
            body.priority ? text(body.priority, "Prioridad") : "normal",
            "RECEIVED",
            body.estimatedCompletionAt ? text(body.estimatedCompletionAt, "Fecha estimada") : null,
            receivedAt,
            body.observations ? text(body.observations, "Observaciones") : null,
            body.accessories ? text(body.accessories, "Accesorios") : null,
            body.assignedUserId ? text(body.assignedUserId, "Técnico") : null,
            authenticatedSession.id, timestamp, timestamp
          ),
          env.DB.prepare(
            "INSERT INTO order_status_events (id,workshop_id,order_id,from_status,to_status,actor_id,reason,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
          ).bind(uuid(), WORKSHOP_ID, id, null, "RECEIVED", null, "Orden creada", timestamp)
        ]);
        await audit(env.DB, "order.created", "repair_order", id, { reference });
        return json({ id, reference }, 201);
      }

      const orderDetailMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
      if (orderDetailMatch && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const orderId = orderDetailMatch[1];
        const order = await env.DB.prepare(`
          SELECT ro.*,c.name AS customer_name,c.phone AS customer_phone,c.email AS customer_email,
                 d.category,d.brand,d.model,d.serial_number,d.physical_condition,d.reported_fault,d.accessories AS device_accessories,
                 u.name AS technician_name
          FROM repair_orders ro
          JOIN customers c ON c.id=ro.customer_id
          JOIN devices d ON d.id=ro.device_id
          LEFT JOIN users u ON u.id=ro.assigned_user_id
          WHERE ro.id=?1 AND ro.workshop_id=?2
        `).bind(orderId, WORKSHOP_ID).first();
        if (!order) return json({ error: "Orden no encontrada" }, 404);
        const [events, diagnostics, quotes, payments] = await Promise.all([
          env.DB.prepare("SELECT * FROM order_status_events WHERE order_id=?1 AND workshop_id=?2 ORDER BY created_at DESC").bind(orderId, WORKSHOP_ID).all(),
          env.DB.prepare("SELECT * FROM diagnostics WHERE order_id=?1 AND workshop_id=?2 ORDER BY created_at DESC").bind(orderId, WORKSHOP_ID).all(),
          env.DB.prepare("SELECT id,version,subtotal_minor,tax_minor,total_minor,status,expires_at,created_at FROM quote_versions WHERE order_id=?1 AND workshop_id=?2 ORDER BY version DESC").bind(orderId, WORKSHOP_ID).all(),
          env.DB.prepare("SELECT id,kind,amount_minor,method,reference,created_at FROM payment_transactions WHERE order_id=?1 AND workshop_id=?2 ORDER BY created_at DESC").bind(orderId, WORKSHOP_ID).all()
        ]);
        return json({ order, events: events.results, diagnostics: diagnostics.results, quotes: quotes.results, payments: payments.results });
      }

      if (orderDetailMatch && request.method === "PATCH") {
        const orderId = orderDetailMatch[1];
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para editar órdenes" }, 401);
        const body = await readJson(request);
        const order = await env.DB.prepare(
          "SELECT id,owner_user_id FROM repair_orders WHERE id=?1 AND workshop_id=?2"
        ).bind(orderId, WORKSHOP_ID).first<{ id: string; owner_user_id: string | null }>();
        if (!order) return json({ error: "Orden no encontrada" }, 404);
        if (!ownsOrCanAdmin(authenticatedSession, order.owner_user_id)) {
          return json({ error: "No tienes permiso para editar esta orden" }, 403);
        }
        await env.DB.batch([
          env.DB.prepare(`
            UPDATE repair_orders SET
              reported_issue=?1,priority=?2,estimated_completion_at=?3,received_at=?4,
              observations=?5,accessories=?6,assigned_user_id=?7,updated_at=?8
            WHERE id=?9 AND workshop_id=?10
          `).bind(
            text(body.reportedIssue, "Problema"),
            body.priority ? text(body.priority, "Prioridad") : "normal",
            body.estimatedCompletionAt ? text(body.estimatedCompletionAt, "Fecha estimada") : null,
            body.receivedAt ? parseDateTimeLocalToUtcIso(text(body.receivedAt, "Fecha de recepción")) : now(),
            body.observations ? text(body.observations, "Observaciones") : null,
            body.accessories ? text(body.accessories, "Accesorios") : null,
            body.assignedUserId ? text(body.assignedUserId, "Técnico") : null,
            now(), orderId, WORKSHOP_ID
          ),
          env.DB.prepare(
            "UPDATE devices SET category=?1,brand=?2,model=?3,serial_number=?4,physical_condition=?5,reported_fault=?6,accessories=?7 WHERE id=(SELECT device_id FROM repair_orders WHERE id=?8 AND workshop_id=?9)"
          ).bind(
            text(body.category, "Categoría"),
            text(body.brand, "Marca"),
            text(body.model, "Modelo"),
            body.serialNumber ? text(body.serialNumber, "Serie/IMEI") : null,
            body.physicalCondition ? text(body.physicalCondition, "Condición física") : null,
            body.reportedFault ? text(body.reportedFault, "Falla reportada") : null,
            body.accessories ? text(body.accessories, "Accesorios") : null,
            orderId, WORKSHOP_ID
          )
        ]);
        await audit(env.DB, "order.updated", "repair_order", orderId, { corrected: true });
        return json({ ok: true });
      }

      if (orderDetailMatch && request.method === "DELETE") {
        const orderId = orderDetailMatch[1];
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para eliminar órdenes" }, 401);
        const order = await env.DB.prepare(
          "SELECT id,device_id,owner_user_id FROM repair_orders WHERE id=?1 AND workshop_id=?2"
        ).bind(orderId, WORKSHOP_ID).first<{ id: string; device_id: string; owner_user_id: string | null }>();
        if (!order) return json({ error: "Orden no encontrada" }, 404);
        if (!ownsOrCanAdmin(authenticatedSession, order.owner_user_id)) {
          return json({ error: "No tienes permiso para eliminar esta orden" }, 403);
        }
        const dependencies = await env.DB.prepare(`
          SELECT
            (SELECT COUNT(*) FROM diagnostics WHERE order_id=?1) +
            (SELECT COUNT(*) FROM quote_versions WHERE order_id=?1) +
            (SELECT COUNT(*) FROM payment_transactions WHERE order_id=?1) +
            (SELECT COUNT(*) FROM stock_movements WHERE order_id=?1) AS count
        `).bind(orderId).first<{ count: number }>();
        if ((dependencies?.count ?? 0) > 0) {
          return json({ error: "No se puede eliminar: la orden tiene historial o registros asociados. Cancelala para conservar trazabilidad." }, 409);
        }
        await env.DB.batch([
          env.DB.prepare("DELETE FROM order_status_events WHERE order_id=?1 AND workshop_id=?2").bind(orderId, WORKSHOP_ID),
          env.DB.prepare("DELETE FROM repair_orders WHERE id=?1 AND workshop_id=?2").bind(orderId, WORKSHOP_ID),
          env.DB.prepare("DELETE FROM devices WHERE id=?1 AND workshop_id=?2 AND NOT EXISTS (SELECT 1 FROM repair_orders WHERE device_id=?1)").bind(order.device_id, WORKSHOP_ID)
        ]);
        await audit(env.DB, "order.deleted", "repair_order", orderId, { duplicateCorrection: true });
        return json({ ok: true });
      }

      const statusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
      if (statusMatch && request.method === "PATCH") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para cambiar estados" }, 401);
        const body = await readJson(request);
        const orderId = statusMatch[1];
        const toStatus = text(body.status, "Estado").toUpperCase() as OrderStatus;
        const order = await env.DB.prepare(
          "SELECT status,owner_user_id FROM repair_orders WHERE id=?1 AND workshop_id=?2"
        ).bind(orderId, WORKSHOP_ID).first<{ status: OrderStatus; owner_user_id: string | null }>();
        if (!order) return json({ error: "Orden no encontrada" }, 404);
        if (!ownsOrCanAdmin(authenticatedSession, order.owner_user_id)) {
          return json({ error: "No tienes permiso para cambiar esta orden" }, 403);
        }
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

      if (url.pathname === "/api/assistant/conversations" && request.method === "POST") {
        const body = await readJson(request);
        if (body.consent !== true) {
          return json({ error: "Se requiere consentimiento explícito para iniciar la conversación" }, 400);
        }
        const allowed = await consumeRateLimit(env.DB, "conversation:create", clientSubject(request), 6, 3600);
        if (!allowed) {
          return json({ error: "Se alcanzó el límite de conversaciones. Intentá nuevamente más tarde." }, 429);
        }
        const publicKey = randomToken(32);
        const id = uuid();
        const greeting = "¡Hola! Bienvenido a Group Repair.\n\nSoy el asistente virtual del taller. Puedo ayudarte a consultar reparaciones, conocer nuestros servicios o solicitar asistencia técnica.\n\n¿Qué necesitás hoy?";
        await env.DB.prepare(`
          INSERT INTO chat_conversations
            (id,workshop_id,public_key,name,phone,email,consent_chat_storage,status,created_at,updated_at)
          VALUES (?1,?2,?3,?4,?5,?6,1,'ABIERTA',?7,?8)
        `).bind(
          id, WORKSHOP_ID,
          publicKey,
          body.name ? text(body.name, "Nombre").slice(0, 120) : null,
          body.phone ? validatedPhone(body.phone) : null,
          optionalEmail(body.email),
          now(), now()
        ).run();
        await env.DB.prepare(`
          INSERT INTO chat_messages (id,workshop_id,conversation_id,role,content,created_at)
          VALUES (?1,?2,?3,'assistant',?4,?5)
        `).bind(uuid(), WORKSHOP_ID, id, greeting, now()).run();
        return json({ conversationId: id, publicKey, greeting }, 201);
      }

      const assistantConversationClose = url.pathname.match(/^\/api\/assistant\/conversations\/([^/]+)$/);
      if (assistantConversationClose && request.method === "PATCH") {
        const publicKey = assistantConversationClose[1];
        if (!isValidConversationPublicKey(publicKey)) return json({ error: "Clave de conversación inválida" }, 400);
        await env.DB.prepare(
          "UPDATE chat_conversations SET status='CERRADA',updated_at=?1 WHERE public_key=?2 AND workshop_id=?3"
        ).bind(now(), publicKey, WORKSHOP_ID).run();
        return json({ status: "CERRADA" });
      }

      if (url.pathname === "/api/assistant/messages" && request.method === "POST") {
        const body = await readJson(request);
        const publicKey = text(body.publicKey, "Clave de conversación");
        if (!isValidConversationPublicKey(publicKey)) return json({ error: "Clave de conversación inválida" }, 400);
        const message = text(body.message, "Mensaje");
        if (message.length > 2000) return json({ error: "El mensaje supera el límite de 2000 caracteres" }, 400);
        if (message.length < 2) return json({ error: "El mensaje es demasiado corto" }, 400);
        const conversation = await env.DB.prepare(`
          SELECT id,status,consent_chat_storage FROM chat_conversations
          WHERE public_key=?1 AND workshop_id=?2
        `).bind(publicKey, WORKSHOP_ID).first<{ id: string; status: string; consent_chat_storage: number }>();
        if (!conversation) return json({ error: "Conversación no encontrada" }, 404);
        if (conversation.status === "CERRADA") return json({ error: "La conversación fue cerrada" }, 409);
        if (!conversation.consent_chat_storage) {
          return json({
            error: "La conversación requiere consentimiento para almacenar mensajes",
            code: "CONSENT_REQUIRED"
          }, 409);
        }

        const subject = clientSubject(request);
        const conversationAllowed = await consumeRateLimit(env.DB, "messages:conversation", publicKey, 12, 60);
        const ipAllowed = conversationAllowed && await consumeRateLimit(env.DB, "messages:ip", subject, 30, 60);
        const dayAllowed = ipAllowed && await consumeRateLimit(env.DB, "messages:day", subject, 200, 86400);
        if (!dayAllowed) {
          return json({ error: "Demasiados mensajes. Intentá nuevamente en unos minutos." }, 429);
        }

        await env.DB.prepare(`
          INSERT INTO chat_messages (id,workshop_id,conversation_id,role,content,created_at)
          VALUES (?1,?2,?3,'customer',?4,?5)
        `).bind(uuid(), WORKSHOP_ID, conversation.id, message, now()).run();

        const intent = classifyAssistantIntent(message);
        let reply = deterministicAssistantReply(intent);
        let usedAi = false;
        if (env.GEMINI_API_KEY && intent !== "ORDER_STATUS") {
          const dailyLimit = Math.max(1, Number(env.GEMINI_ASSISTANT_DAILY_LIMIT ?? "200") || 200);
          const startOfDay = new Date();
          startOfDay.setUTCHours(0, 0, 0, 0);
          const usage = await env.DB.prepare(`
            SELECT COUNT(*) AS count FROM gemini_usage
            WHERE user_id='public-visitor' AND success=1 AND created_at>=?1
          `).bind(startOfDay.toISOString()).first<number>("count");
          if ((usage ?? 0) < dailyLimit) {
            const [knowledge, history] = await Promise.all([
              env.DB.prepare(`
                SELECT category,question,answer FROM knowledge_base
                WHERE workshop_id=?1 AND active=1 ORDER BY category LIMIT 100
              `).bind(WORKSHOP_ID).all<{ category: string; question: string; answer: string }>(),
              env.DB.prepare(`
                SELECT role,content FROM chat_messages
                WHERE conversation_id=?1 AND workshop_id=?2
                ORDER BY created_at DESC LIMIT 8
              `).bind(conversation.id, WORKSHOP_ID).all<{ role: string; content: string }>()
            ]);
            const selectedKnowledge = selectRelevantKnowledge(knowledge.results, message);
            const knowledgeContext = buildKnowledgeContext(selectedKnowledge);
            const contents = buildGeminiHistory(history.results.slice().reverse());
            const currentMessage = sanitizeForProvider(message);
            if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
              contents.push({ role: "user", parts: [{ text: currentMessage }] });
            }
            const model = env.GEMINI_MODEL ?? "gemini-2.5-flash";
            const started = Date.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);
            try {
              const aiResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
                  body: JSON.stringify({
                    systemInstruction: { parts: [{ text: `${ASSISTANT_SYSTEM_INSTRUCTION}\n\n${knowledgeContext}` }] },
                    contents,
                    generationConfig: { temperature: 0.2, maxOutputTokens: 500 }
                  }),
                  signal: controller.signal
                }
              );
              const aiBody = aiResponse.ok
                ? await aiResponse.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
                : null;
              const aiReply = aiBody?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
              const safeAiReply = aiReply ? sanitizeForProvider(aiReply) : "";
              if (safeAiReply) {
                reply = safeAiReply;
                usedAi = true;
              }
              await env.DB.prepare(`
                INSERT INTO gemini_usage
                  (id,user_id,model,input_chars,output_chars,latency_ms,success,error_code,created_at)
                VALUES (?1,'public-visitor',?2,?3,?4,?5,?6,?7,?8)
              `).bind(
                uuid(), model, JSON.stringify(selectedKnowledge).length + currentMessage.length, safeAiReply.length, Date.now() - started,
                usedAi ? 1 : 0, usedAi ? null : `http_${aiResponse?.status ?? "exception"}`, now()
              ).run();
            } catch {
              // Mantener fallback basado en reglas.
            } finally {
              clearTimeout(timeout);
            }
          }
        }

        await env.DB.prepare(`
          INSERT INTO chat_messages (id,workshop_id,conversation_id,role,content,created_at)
          VALUES (?1,?2,?3,'assistant',?4,?5)
        `).bind(uuid(), WORKSHOP_ID, conversation.id, reply, now()).run();
        await env.DB.prepare(
          "UPDATE chat_conversations SET updated_at=?1 WHERE id=?2"
        ).bind(now(), conversation.id).run();
        return json({ reply, limitedAi: !usedAi });
      }

      if (url.pathname === "/api/assistant/requests" && request.method === "POST") {
        const body = await readJson(request);
        if (body.consent !== true) {
          return json({ error: "Se requiere consentimiento explícito para conservar la solicitud" }, 400);
        }
        const subject = clientSubject(request);
        const hourlyAllowed = await consumeRateLimit(env.DB, "requests:hour", subject, 5, 3600);
        const dailyAllowed = hourlyAllowed && await consumeRateLimit(env.DB, "requests:day", subject, 20, 86400);
        if (!dailyAllowed) {
          return json({ error: "Se alcanzó el límite de solicitudes. Intentá nuevamente más tarde." }, 429);
        }
        const publicKey = body.publicKey ? text(body.publicKey, "Clave de conversación") : null;
        if (publicKey && !isValidConversationPublicKey(publicKey)) {
          return json({ error: "Clave de conversación inválida" }, 400);
        }
        const requestType = body.requestType === "CONTACT" ? "CONTACT" : "REPAIR";
        const name = text(body.name, "Nombre").slice(0, 120);
        const phone = validatedPhone(body.phone);
        const email = optionalEmail(body.email);
        const problem = text(body.problem, "Problema").slice(0, 2000);

        let conversationId: string | null = null;
        if (publicKey) {
          const conversation = await env.DB.prepare(
            "SELECT id FROM chat_conversations WHERE public_key=?1 AND workshop_id=?2"
          ).bind(publicKey, WORKSHOP_ID).first<{ id: string }>();
          conversationId = conversation?.id ?? null;
        }
        let customerId: string | null = null;
        const customer = await env.DB.prepare(`
          SELECT id FROM customers
          WHERE workshop_id=?1
            AND (
              ${NORMALIZED_PHONE_SQL}=?2
              OR (length(?2)>=10 AND length(${NORMALIZED_PHONE_SQL})>=10 AND substr(${NORMALIZED_PHONE_SQL},-10)=substr(?2,-10))
              OR (?3 IS NOT NULL AND lower(email)=lower(?3))
            )
          ORDER BY created_at LIMIT 1
        `).bind(WORKSHOP_ID, phone.replace(/\D/g, ""), email).first<{ id: string }>();
        customerId = customer?.id ?? null;

        const id = uuid();
        const timestamp = now();
        let reference = createPublicReference("SA");
        let inserted = false;
        for (let attempt = 0; attempt < 3 && !inserted; attempt += 1) {
          try {
            await env.DB.prepare(`
              INSERT INTO service_requests
                (id,workshop_id,reference,conversation_id,customer_id,name,phone,email,equipment_type,brand,model,
                 problem,accessories,request_type,status,consent_personal_data,created_at,updated_at)
              VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'NUEVA',1,?15,?16)
            `).bind(
              id, WORKSHOP_ID, reference, conversationId, customerId, name, phone, email,
              body.equipmentType ? text(body.equipmentType, "Tipo de equipo").slice(0, 120) : null,
              body.brand ? text(body.brand, "Marca").slice(0, 120) : null,
              body.model ? text(body.model, "Modelo").slice(0, 120) : null,
              problem,
              body.accessories ? text(body.accessories, "Accesorios").slice(0, 500) : null,
              requestType, timestamp, timestamp
            ).run();
            inserted = true;
          } catch (error) {
            if (!/UNIQUE/i.test(String(error))) throw error;
            reference = createPublicReference("SA");
          }
        }
        if (!inserted) return json({ error: "No se pudo generar la referencia de la solicitud" }, 503);
        if (conversationId) {
          await env.DB.prepare(
            "UPDATE chat_conversations SET customer_id=COALESCE(customer_id,?1),name=COALESCE(name,?2),phone=COALESCE(phone,?3),email=COALESCE(email,?4),updated_at=?5 WHERE id=?6"
          ).bind(customerId, name, phone, email, now(), conversationId).run();
        }
        return json({ reference, status: "NUEVA", message: "Solicitud registrada. Está pendiente de revisión del taller." }, 201);
      }

      if (url.pathname === "/api/assistant/orders/track" && request.method === "POST") {
        const body = await readJson(request);
        const toolInput = validateOrderStatusToolInput({
          name: "lookup_order_status",
          reference: body.reference,
          phone: body.phone
        });
        const reference = toolInput.reference;
        const phone = toolInput.phone;
        const subject = clientSubject(request);
        const minuteAllowed = await consumeRateLimit(env.DB, "track:minute", subject, 10, 60);
        const dayAllowed = minuteAllowed && await consumeRateLimit(env.DB, "track:day", subject, 100, 86400);
        if (!dayAllowed) {
          return json({ error: "Demasiadas consultas. Intentá nuevamente en unos minutos." }, 429);
        }
        const order = await env.DB.prepare(`
          SELECT ro.reference,ro.status,ro.received_at,ro.created_at,ro.updated_at,
                 c.phone AS customer_phone,
                 d.brand,d.model,
                 qv.total_minor
          FROM repair_orders ro
          JOIN customers c ON c.id=ro.customer_id
          JOIN devices d ON d.id=ro.device_id
          LEFT JOIN quote_versions qv ON qv.id=(
            SELECT id FROM quote_versions
            WHERE order_id=ro.id AND workshop_id=ro.workshop_id
            ORDER BY version DESC LIMIT 1
          )
          WHERE ro.workshop_id=?1 AND ro.reference=?2
        `).bind(WORKSHOP_ID, reference).first<{
          reference: string; status: string; received_at: string | null; created_at: string;
          updated_at: string; customer_phone: string; brand: string; model: string; total_minor: number | null;
        }>();
        if (!order || !phonesMatch(order.customer_phone, phone)) {
          return json({ error: "No encontramos una orden con esos datos" }, 404);
        }
        const nextSteps: Record<string, string> = {
          RECEIVED: "La solicitud fue recibida y está pendiente de revisión.",
          DIAGNOSIS: "El equipo está en diagnóstico.",
          QUOTED: "Hay un presupuesto disponible para revisión.",
          APPROVED: "La reparación fue aprobada.",
          WAITING_FOR_PARTS: "Estamos esperando repuestos.",
          IN_REPAIR: "El equipo está en reparación.",
          TESTING: "El equipo está en pruebas.",
          READY_FOR_DELIVERY: "El equipo está listo para entrega.",
          DELIVERED: "La reparación fue entregada.",
          CANCELLED: "La reparación fue cancelada.",
          NOT_REPAIRABLE: "El equipo fue marcado como no reparable."
        };
        return json({
          order: {
            reference: order.reference,
            equipment: `${order.brand} ${order.model}`,
            status: statusLabel(order.status),
            receivedAt: order.received_at ?? order.created_at,
            nextSteps: nextSteps[order.status] ?? "El taller actualizará el estado próximamente.",
            budgetMinor: order.total_minor
          }
        });
      }

      if (url.pathname === "/api/assistant/knowledge" && request.method === "GET") {
        const allowed = await consumeRateLimit(env.DB, "knowledge:read", clientSubject(request), 60, 60);
        if (!allowed) return json({ error: "Demasiadas consultas. Intentá nuevamente en unos minutos." }, 429);
        const result = await env.DB.prepare(`
          SELECT category,question,answer
          FROM knowledge_base
          WHERE workshop_id=?1 AND active=1
          ORDER BY category,question
        `).bind(WORKSHOP_ID).all();
        return json({ knowledge: result.results });
      }

      if (url.pathname === "/api/admin/assistant/knowledge" && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (!["admin", "reception"].includes(authenticatedSession.role)) {
          return json({ error: "Permisos insuficientes" }, 403);
        }
        const body = await readJson(request);
        const id = uuid();
        await env.DB.prepare(`
          INSERT INTO knowledge_base
            (id,workshop_id,category,question,answer,active,created_at,updated_at)
          VALUES (?1,?2,?3,?4,?5,1,?6,?7)
        `).bind(
          id, WORKSHOP_ID,
          text(body.category, "Categoría").slice(0, 120),
          text(body.question, "Pregunta").slice(0, 500),
          text(body.answer, "Respuesta").slice(0, 2000),
          now(), now()
        ).run();
        await audit(env.DB, "knowledge.created", "knowledge_base", id, { category: body.category }, authenticatedSession.id);
        return json({ id }, 201);
      }

      const knowledgeMatch = url.pathname.match(/^\/api\/admin\/assistant\/knowledge\/([^/]+)$/);
      if (knowledgeMatch && request.method === "PATCH") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (!["admin", "reception"].includes(authenticatedSession.role)) {
          return json({ error: "Permisos insuficientes" }, 403);
        }
        const knowledgeId = knowledgeMatch[1];
        const body = await readJson(request);
        const category = body.category ? text(body.category, "Categoría").slice(0, 120) : null;
        const question = body.question ? text(body.question, "Pregunta").slice(0, 500) : null;
        const answer = body.answer ? text(body.answer, "Respuesta").slice(0, 2000) : null;
        const active = body.active === undefined ? null : (body.active ? 1 : 0);
        await env.DB.prepare(`
          UPDATE knowledge_base SET
            category=COALESCE(?1,category),
            question=COALESCE(?2,question),
            answer=COALESCE(?3,answer),
            active=COALESCE(?4,active),
            updated_at=?5
          WHERE id=?6 AND workshop_id=?7
        `).bind(category, question, answer, active, now(), knowledgeId, WORKSHOP_ID).run();
        await audit(env.DB, "knowledge.updated", "knowledge_base", knowledgeId, { category: body.category }, authenticatedSession.id);
        return json({ ok: true });
      }

      if (knowledgeMatch && request.method === "DELETE") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (!["admin", "reception"].includes(authenticatedSession.role)) {
          return json({ error: "Permisos insuficientes" }, 403);
        }
        const knowledgeId = knowledgeMatch[1];
        await env.DB.prepare(
          "DELETE FROM knowledge_base WHERE id=?1 AND workshop_id=?2"
        ).bind(knowledgeId, WORKSHOP_ID).run();
        await audit(env.DB, "knowledge.deleted", "knowledge_base", knowledgeId, null, authenticatedSession.id);
        return json({ ok: true });
      }

      if (url.pathname === "/api/admin/assistant/requests" && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (!["admin", "reception", "technical_lead"].includes(authenticatedSession.role)) {
          return json({ error: "Permisos insuficientes" }, 403);
        }
        const result = await env.DB.prepare(`
          SELECT sr.*,c.name AS customer_name,ro.reference AS order_reference
          FROM service_requests sr
          LEFT JOIN customers c ON c.id=sr.customer_id
          LEFT JOIN repair_orders ro ON ro.id=sr.order_id AND ro.workshop_id=sr.workshop_id
          WHERE sr.workshop_id=?1
          ORDER BY sr.created_at DESC LIMIT 500
        `).bind(WORKSHOP_ID).all();
        return json({ requests: result.results });
      }

      const assistantRequestStatus = url.pathname.match(/^\/api\/admin\/assistant\/requests\/([^/]+)\/status$/);
      if (assistantRequestStatus && request.method === "PATCH") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (!["admin", "reception", "technical_lead"].includes(authenticatedSession.role)) {
          return json({ error: "Permisos insuficientes" }, 403);
        }
        const requestId = assistantRequestStatus[1];
        const body = await readJson(request);
        const status = text(body.status, "Estado").toUpperCase();
        if (!["NUEVA", "EN REVISION", "ESPERANDO CLIENTE", "DERIVADA", "RESUELTA", "CERRADA"].includes(status)) {
          return json({ error: "Estado no válido" }, 400);
        }
        await env.DB.prepare(
          "UPDATE service_requests SET status=?1,updated_at=?2 WHERE id=?3 AND workshop_id=?4"
        ).bind(status, now(), requestId, WORKSHOP_ID).run();
        await audit(env.DB, "service_request.status_changed", "service_request", requestId, { status }, authenticatedSession.id);
        return json({ status });
      }

      const assistantDelete = url.pathname.match(/^\/api\/admin\/assistant\/requests\/([^/]+)$/);
      if (assistantDelete && request.method === "DELETE") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (!["admin", "reception", "technical_lead"].includes(authenticatedSession.role)) {
          return json({ error: "Permisos insuficientes" }, 403);
        }
        const requestId = assistantDelete[1];
        await env.DB.prepare(
          "DELETE FROM service_requests WHERE id=?1 AND workshop_id=?2"
        ).bind(requestId, WORKSHOP_ID).run();
        await audit(env.DB, "service_request.deleted", "service_request", requestId, null, authenticatedSession.id);
        return json({ ok: true });
      }

      const assistantConvert = url.pathname.match(/^\/api\/admin\/assistant\/requests\/([^/]+)\/convert$/);
      if (assistantConvert && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (!["admin", "reception", "technical_lead"].includes(authenticatedSession.role)) {
          return json({ error: "Permisos insuficientes" }, 403);
        }
        const requestId = assistantConvert[1];
        const request = await env.DB.prepare(`
          SELECT * FROM service_requests
          WHERE id=?1 AND workshop_id=?2
        `).bind(requestId, WORKSHOP_ID).first<{
          id: string; customer_id: string | null; name: string; phone: string;
          email: string | null; equipment_type: string | null; brand: string | null;
          model: string | null; problem: string; accessories: string | null;
          status: string; order_id: string | null;
        }>();
        if (!request) return json({ error: "Solicitud no encontrada" }, 404);
        if (request.order_id) return json({ error: "La solicitud ya fue convertida", orderId: request.order_id }, 409);
        const claim = await env.DB.prepare(`
          UPDATE service_requests
          SET status='EN CONVERSION',updated_at=?1
          WHERE id=?2 AND workshop_id=?3 AND order_id IS NULL AND status<>'EN CONVERSION'
        `).bind(now(), requestId, WORKSHOP_ID).run() as { meta?: { changes?: number } };
        if ((claim.meta?.changes ?? 0) === 0) {
          const current = await env.DB.prepare(
            "SELECT order_id FROM service_requests WHERE id=?1 AND workshop_id=?2"
          ).bind(requestId, WORKSHOP_ID).first<{ order_id: string | null }>();
          return json({ error: "La solicitud ya fue convertida", orderId: current?.order_id ?? null }, 409);
        }
        const orderId = uuid();
        const deviceId = uuid();
        const timestamp = now();
        let reference = "";
        let created = false;
        try {
          let customerId = request.customer_id;
          if (!customerId) {
            const existing = await env.DB.prepare(`
              SELECT id FROM customers
              WHERE workshop_id=?1
                AND (
                  ${NORMALIZED_PHONE_SQL}=?2
                  OR (length(?2)>=10 AND length(${NORMALIZED_PHONE_SQL})>=10 AND substr(${NORMALIZED_PHONE_SQL},-10)=substr(?2,-10))
                  OR (?3 IS NOT NULL AND lower(email)=lower(?3))
                )
              ORDER BY created_at LIMIT 1
            `).bind(WORKSHOP_ID, request.phone.replace(/\D/g, ""), request.email).first<{ id: string }>();
            if (existing) {
              customerId = existing.id;
            } else {
              customerId = uuid();
              await env.DB.prepare(`
                INSERT INTO customers
                  (id,workshop_id,name,surname,phone,email,address,observations,status,owner_user_id,created_at,updated_at)
                VALUES (?1,?2,?3,NULL,?4,?5,NULL,?6,'ACTIVO',?7,?8,?9)
              `).bind(customerId, WORKSHOP_ID, request.name, request.phone, request.email, "Creado al convertir solicitud de asistencia", authenticatedSession.id, now(), now()).run();
            }
          }
          for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
            const lastReference = await env.DB.prepare(`
              SELECT COALESCE(MAX(CAST(SUBSTR(reference,4) AS INTEGER)),0) AS number
              FROM repair_orders WHERE workshop_id=?1 AND reference LIKE 'GR-%'
            `).bind(WORKSHOP_ID).first<{ number: number }>();
            reference = `GR-${String((lastReference?.number ?? 0) + 1).padStart(5, "0")}`;
            try {
              await env.DB.batch([
                env.DB.prepare(`
                  INSERT INTO devices
                    (id,workshop_id,customer_id,category,brand,model,serial_number,physical_condition,reported_fault,accessories,owner_user_id,created_at)
                  VALUES (?1,?2,?3,?4,?5,?6,NULL,NULL,?7,?8,?9,?10)
                `).bind(
                  deviceId, WORKSHOP_ID, customerId,
                  request.equipment_type ?? "Otro",
                  request.brand ?? "Sin informar",
                  request.model ?? "Sin informar",
                  request.problem,
                  request.accessories,
                  authenticatedSession.id, timestamp
                ),
                env.DB.prepare(`
                  INSERT INTO repair_orders
                    (id,workshop_id,customer_id,device_id,reference,reported_issue,priority,status,
                     estimated_completion_at,received_at,observations,accessories,assigned_user_id,owner_user_id,created_at,updated_at)
                  VALUES (?1,?2,?3,?4,?5,?6,'normal','RECEIVED',NULL,?7,?8,?9,NULL,?10,?11,?12)
                `).bind(orderId, WORKSHOP_ID, customerId, deviceId, reference, request.problem, timestamp, "Creada desde solicitud de asistencia", request.accessories, authenticatedSession.id, timestamp, timestamp),
                env.DB.prepare(`
                  INSERT INTO order_status_events
                    (id,workshop_id,order_id,from_status,to_status,actor_id,reason,created_at)
                  VALUES (?1,?2,?3,NULL,'RECEIVED',?4,'Orden creada desde solicitud aprobada',?5)
                `).bind(uuid(), WORKSHOP_ID, orderId, authenticatedSession.id, timestamp),
                env.DB.prepare(`
                  UPDATE service_requests
                  SET status='RESUELTA',order_id=?1,updated_at=?2
                  WHERE id=?3 AND workshop_id=?4 AND order_id IS NULL
                `).bind(orderId, timestamp, requestId, WORKSHOP_ID)
              ]);
              created = true;
            } catch (error) {
              if (!/UNIQUE/i.test(String(error))) throw error;
            }
          }
          if (!created) throw new Error("No se pudo generar la referencia de la orden");
        } catch (error) {
          await env.DB.prepare(`
            UPDATE service_requests SET status=?1,updated_at=?2
            WHERE id=?3 AND workshop_id=?4 AND order_id IS NULL
          `).bind(request.status === "EN CONVERSION" ? "NUEVA" : request.status, now(), requestId, WORKSHOP_ID).run();
          throw error;
        }
        await audit(env.DB, "service_request.converted", "service_request", requestId, { orderId, reference }, authenticatedSession.id);
        return json({ orderId, reference }, 201);
      }

      if (url.pathname === "/api/parts" && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const result = await env.DB.prepare(`
          SELECT p.id,p.sku,p.name,p.category,p.location,p.cost_minor,p.sale_price_minor,p.minimum_stock,
                 p.status,p.archived_at,p.created_at,p.updated_at,
            COALESCE(SUM(CASE WHEN sm.kind IN ('IN','RETURN','ADJUSTMENT_IN') THEN sm.quantity ELSE -sm.quantity END),0) AS stock
          FROM parts p LEFT JOIN stock_movements sm ON sm.part_id=p.id
          WHERE p.workshop_id=?1 GROUP BY p.id ORDER BY
            CASE WHEN p.status='ACTIVO' THEN 0 ELSE 1 END,
            p.name
        `).bind(WORKSHOP_ID).all();
        return json({ parts: result.results });
      }

      if (url.pathname === "/api/parts" && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para administrar inventario" }, 401);
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para administrar inventario" }, 401);
        const body = await readJson(request);
        const id = uuid();
        const timestamp = now();
        const initialStock = integer(body.initialStock ?? 0, "Stock inicial");
        if (initialStock < 0) throw new Error("El stock inicial no puede ser negativo");
        const sku = text(body.sku, "SKU").toUpperCase();
        const existingSku = await env.DB.prepare(
          "SELECT id FROM parts WHERE workshop_id=?1 AND sku=?2"
        ).bind(WORKSHOP_ID, sku).first("id");
        if (existingSku) return json({ error: "Ya existe un producto con ese SKU" }, 409);
        const statements = [
          env.DB.prepare(
            "INSERT INTO parts (id,workshop_id,sku,name,category,location,cost_minor,sale_price_minor,minimum_stock,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'ACTIVO',?10,?11)"
          ).bind(id, WORKSHOP_ID, sku, text(body.name, "Nombre"), body.category ? text(body.category, "Categoría") : null, body.location ? text(body.location, "Ubicación") : null, integer(body.costMinor, "Costo"), integer(body.salePriceMinor, "Precio"), integer(body.minimumStock ?? 0, "Stock mínimo"), timestamp, timestamp)
        ];
        if (initialStock > 0) {
          statements.push(
            env.DB.prepare(
              "INSERT INTO stock_movements (id,workshop_id,part_id,order_id,kind,quantity,reason,actor_id,created_at,stock_before,stock_after,reference) VALUES (?1,?2,?3,NULL,'IN',?4,'Stock inicial registrado',?5,?6,0,?7,?8)"
            ).bind(uuid(), WORKSHOP_ID, id, initialStock, authenticatedSession.id, timestamp, initialStock, `initial:${id}`)
          );
        }
        await env.DB.batch(statements);
        await audit(env.DB, "part.created", "part", id, { initialStock });
        return json({ id }, 201);
      }

      const movementMatch = url.pathname.match(/^\/api\/parts\/([^/]+)\/movements$/);
      if (movementMatch && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para registrar movimientos" }, 401);
        const body = await readJson(request);
        const partId = movementMatch[1];
        const reference = body.reference ? text(body.reference, "Referencia") : null;
        if (reference) {
          const existing = await env.DB.prepare(
            "SELECT id,stock_after FROM stock_movements WHERE reference=?1"
          ).bind(reference).first<{ id: string; stock_after: number }>();
          if (existing) return json({ id: existing.id, stock: existing.stock_after, duplicated: true });
        }
        const part = await env.DB.prepare(
          "SELECT id,status FROM parts WHERE id=?1 AND workshop_id=?2"
        ).bind(partId, WORKSHOP_ID).first<{ id: string; status: string }>();
        if (!part) return json({ error: "Repuesto no encontrado" }, 404);
        if (part.status === "ARCHIVADO") return json({ error: "Reactiva el producto antes de registrar movimientos" }, 409);
        const stockRow = await env.DB.prepare(`
          SELECT COALESCE(SUM(CASE WHEN kind IN ('IN','RETURN','ADJUSTMENT_IN') THEN quantity ELSE -quantity END),0) AS stock
          FROM stock_movements WHERE part_id=?1 AND workshop_id=?2
        `).bind(partId, WORKSHOP_ID).first<{ stock: number }>();
        const stock = stockRow?.stock ?? 0;
        const requestedKind = body.kind ? text(body.kind, "Tipo").toUpperCase() : null;
        let kind: string;
        let quantity: number;
        if (body.targetStock !== undefined) {
          const targetStock = integer(body.targetStock, "Cantidad final");
          if (targetStock < 0) throw new Error("La cantidad final no puede ser negativa");
          if (targetStock === stock) return json({ error: "La cantidad final coincide con el stock actual" }, 409);
          quantity = Math.abs(targetStock - stock);
          kind = targetStock > stock ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
        } else {
          quantity = integer(body.quantity, "Cantidad");
          if (quantity <= 0) throw new Error("La cantidad debe ser positiva");
          kind = requestedKind ?? "OUT";
        }
        const allowed = ["IN", "OUT", "RETURN", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"];
        if (!allowed.includes(kind)) throw new Error("Tipo de movimiento inválido");
        const stockAfter = stock + (["IN", "RETURN", "ADJUSTMENT_IN"].includes(kind) ? quantity : -quantity);
        if (stockAfter < 0) return json({ error: "Stock insuficiente" }, 409);
        const id = uuid();
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO stock_movements (id,workshop_id,part_id,order_id,kind,quantity,reason,actor_id,created_at,stock_before,stock_after,reference) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)"
          ).bind(id, WORKSHOP_ID, partId, body.orderId ? text(body.orderId, "Orden") : null, kind, quantity, text(body.reason, "Motivo"), authenticatedSession.id, now(), stock, stockAfter, reference),
          env.DB.prepare(
            "UPDATE parts SET updated_at=?1 WHERE id=?2 AND workshop_id=?3"
          ).bind(now(), partId, WORKSHOP_ID)
        ]);
        await audit(env.DB, "stock.movement", "stock_movement", id, { kind, quantity });
        return json({ id, stockBefore: stock, stockAfter, duplicated: false }, 201);
      }

      if (url.pathname === "/api/inventory/movements" && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const partId = url.searchParams.get("part");
        const kind = url.searchParams.get("kind");
        const orderId = url.searchParams.get("order");
        const conditions = ["sm.workshop_id=?1"];
        const values: unknown[] = [WORKSHOP_ID];
        let index = 2;
        if (partId) {
          conditions.push(`sm.part_id=?${index++}`);
          values.push(partId);
        }
        if (kind) {
          conditions.push(`sm.kind=?${index++}`);
          values.push(kind);
        }
        if (orderId) {
          conditions.push(`sm.order_id=?${index++}`);
          values.push(orderId);
        }
        let statement = env.DB.prepare(`
          SELECT sm.id,sm.part_id,sm.order_id,sm.kind,sm.quantity,sm.reason,sm.actor_id,
                 sm.created_at,sm.stock_before,sm.stock_after,sm.reference,
                 p.sku,p.name AS part_name
          FROM stock_movements sm
          JOIN parts p ON p.id=sm.part_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY sm.created_at DESC
          LIMIT 500
        `);
        statement = statement.bind(...values);
        const movements = await statement.all();
        return json({ movements: movements.results });
      }

      const movementReverseMatch = url.pathname.match(/^\/api\/inventory\/movements\/([^/]+)\/reverse$/);
      if (movementReverseMatch && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para revertir movimientos" }, 401);
        const movementId = movementReverseMatch[1];
        const original = await env.DB.prepare(`
          SELECT id,part_id,kind,quantity,reference
          FROM stock_movements WHERE id=?1 AND workshop_id=?2
        `).bind(movementId, WORKSHOP_ID).first<{ id: string; part_id: string; kind: string; quantity: number; reference: string | null }>();
        if (!original) return json({ error: "Movimiento no encontrado" }, 404);
        const reverseReference = `reverse:${original.id}`;
        const existing = await env.DB.prepare(
          "SELECT id,stock_after FROM stock_movements WHERE reference=?1"
        ).bind(reverseReference).first<{ id: string; stock_after: number }>();
        if (existing) return json({ id: existing.id, stock: existing.stock_after, duplicated: true });
        const stockRow = await env.DB.prepare(`
          SELECT COALESCE(SUM(CASE WHEN kind IN ('IN','RETURN','ADJUSTMENT_IN') THEN quantity ELSE -quantity END),0) AS stock
          FROM stock_movements WHERE part_id=?1 AND workshop_id=?2
        `).bind(original.part_id, WORKSHOP_ID).first<{ stock: number }>();
        const stockBefore = stockRow?.stock ?? 0;
        const reverseKind = ["OUT", "ADJUSTMENT_OUT"].includes(original.kind) ? "IN" : "OUT";
        const stockAfter = stockBefore + (reverseKind === "IN" ? original.quantity : -original.quantity);
        if (stockAfter < 0) return json({ error: "No hay stock suficiente para revertir el movimiento" }, 409);
        const id = uuid();
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO stock_movements
              (id,workshop_id,part_id,order_id,kind,quantity,reason,actor_id,created_at,stock_before,stock_after,reference)
            VALUES (?1,?2,?3,NULL,?4,?5,?6,?7,?8,?9,?10,?11)
          `).bind(
            id, WORKSHOP_ID, original.part_id, reverseKind, original.quantity,
            `Reversión compensatoria del movimiento ${original.id}`,
            authenticatedSession.id, now(), stockBefore, stockAfter, reverseReference
          ),
          env.DB.prepare("UPDATE parts SET updated_at=?1 WHERE id=?2 AND workshop_id=?3")
            .bind(now(), original.part_id, WORKSHOP_ID)
        ]);
        await audit(env.DB, "stock.movement.reversed", "stock_movement", original.id, { reverseId: id });
        return json({ id, stockBefore, stockAfter, reversed: original.id }, 201);
      }

      const partStatusMatch = url.pathname.match(/^\/api\/parts\/([^/]+)\/status$/);
      if (partStatusMatch && request.method === "PATCH") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para cambiar el estado" }, 401);
        const partId = partStatusMatch[1];
        const body = await readJson(request);
        const status = text(body.status, "Estado").toUpperCase();
        if (!["ACTIVO", "INACTIVO", "ARCHIVADO"].includes(status)) {
          return json({ error: "Estado de producto no válido" }, 400);
        }
        const timestamp = now();
        await env.DB.prepare(`
          UPDATE parts SET status=?1,archived_at=?2,updated_at=?3
          WHERE id=?4 AND workshop_id=?5
        `).bind(status, status === "ARCHIVADO" ? timestamp : null, timestamp, partId, WORKSHOP_ID).run();
        await audit(env.DB, `part.status_${status.toLowerCase()}`, "part", partId, { status });
        return json({ status });
      }

      const partDetailMatch = url.pathname.match(/^\/api\/parts\/([^/]+)$/);
      if (partDetailMatch && request.method === "GET") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        const partId = partDetailMatch[1];
        const part = await env.DB.prepare(`
          SELECT p.id,p.sku,p.name,p.category,p.location,p.cost_minor,p.sale_price_minor,p.minimum_stock,
                 p.status,p.archived_at,p.created_at,p.updated_at,
                 COALESCE(SUM(CASE WHEN sm.kind IN ('IN','RETURN','ADJUSTMENT_IN') THEN sm.quantity ELSE -sm.quantity END),0) AS stock
          FROM parts p LEFT JOIN stock_movements sm ON sm.part_id=p.id
          WHERE p.id=?1 AND p.workshop_id=?2 GROUP BY p.id
        `).bind(partId, WORKSHOP_ID).first();
        if (!part) return json({ error: "Repuesto no encontrado" }, 404);
        const movements = await env.DB.prepare(`
          SELECT id,order_id,kind,quantity,reason,actor_id,created_at,stock_before,stock_after,reference
          FROM stock_movements WHERE part_id=?1 AND workshop_id=?2
          ORDER BY created_at DESC LIMIT 100
        `).bind(partId, WORKSHOP_ID).all();
        return json({ part, movements: movements.results });
      }

      if (partDetailMatch && request.method === "PATCH") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para editar inventario" }, 401);
        const partId = partDetailMatch[1];
        const body = await readJson(request);
        const part = await env.DB.prepare(
          "SELECT id FROM parts WHERE id=?1 AND workshop_id=?2"
        ).bind(partId, WORKSHOP_ID).first("id");
        if (!part) return json({ error: "Repuesto no encontrado" }, 404);
        const sku = text(body.sku, "SKU").toUpperCase();
        const duplicateSku = await env.DB.prepare(
          "SELECT id FROM parts WHERE workshop_id=?1 AND sku=?2 AND id<>?3"
        ).bind(WORKSHOP_ID, sku, partId).first("id");
        if (duplicateSku) return json({ error: "Ya existe un producto con ese SKU" }, 409);
        await env.DB.prepare(`
          UPDATE parts SET
            sku=?1,name=?2,category=?3,location=?4,cost_minor=?5,sale_price_minor=?6,minimum_stock=?7,updated_at=?8
          WHERE id=?9 AND workshop_id=?10
        `).bind(
          sku,
          text(body.name, "Nombre"),
          body.category ? text(body.category, "Categoría") : null,
          body.location ? text(body.location, "Ubicación") : null,
          integer(body.costMinor, "Costo"),
          integer(body.salePriceMinor, "Precio"),
          integer(body.minimumStock ?? 0, "Stock mínimo"),
          now(), partId, WORKSHOP_ID
        ).run();
        await audit(env.DB, "part.updated", "part", partId);
        return json({ ok: true });
      }

      if (partDetailMatch && request.method === "DELETE") {
        if (!authenticatedSession) return json({ error: "Se requiere una sesión aprobada para eliminar inventario" }, 401);
        const partId = partDetailMatch[1];
        const part = await env.DB.prepare(
          "SELECT id, status FROM parts WHERE id=?1 AND workshop_id=?2"
        ).bind(partId, WORKSHOP_ID).first<{ id: string; status: string }>();
        if (!part) return json({ error: "Repuesto no encontrado" }, 404);
        // Solo se permite eliminar productos archivados; si tiene movimientos, se eliminan en cascada.
        if (part.status !== "ARCHIVADO") {
          const movements = await env.DB.prepare(
            "SELECT COUNT(*) AS count FROM stock_movements WHERE part_id=?1 AND workshop_id=?2"
          ).bind(partId, WORKSHOP_ID).first<number>("count");
          if ((movements ?? 0) > 0) {
            return json({ error: "No se puede eliminar: el repuesto tiene movimientos de stock registrados. Archívalo primero." }, 409);
          }
        } else {
          // Producto archivado: eliminar movimientos y luego el producto.
          await env.DB.prepare(
            "DELETE FROM stock_movements WHERE part_id=?1 AND workshop_id=?2"
          ).bind(partId, WORKSHOP_ID).run();
        }
        const deleted = await env.DB.prepare(
          "DELETE FROM parts WHERE id=?1 AND workshop_id=?2"
        ).bind(partId, WORKSHOP_ID).run();
        await audit(env.DB, "part.deleted", "part", partId);
        return json({ ok: true, deleted: Boolean(deleted) });
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ error: "Ruta no encontrada" }, 404);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error interno";
      const status = error instanceof SyntaxError || /obligatorio|inválid|positivo|entero|JSON/.test(message) ? 400 : 500;
      return json({ error: message }, status);
    }
  }
};
