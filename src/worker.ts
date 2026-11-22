import { canTransition, ORDER_STATUSES, type OrderStatus } from "./domain/status";
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
            "SELECT id FROM google_access_allowlist WHERE workshop_id=?1 AND status='ACTIVE' AND (google_sub=?2 OR email=?3)"
          ).bind(WORKSHOP_ID, payload.sub, payload.email).first("id");
          const isAllowlisted = Boolean(allowlistEntry);
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
            canCreateApproved && isBootstrapAdmin ? "admin" : "viewer",
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
            ).bind(payload.sub, timestamp, allowlistEntry).run();
          }
        } else {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO google_identities (id,user_id,google_sub,email,email_verified,created_at) VALUES (?1,?2,?3,?4,?5,?6)"
          ).bind(uuid(), user.id, payload.sub, payload.email, payload.email_verified ? 1 : 0, now()).run();

          const allowlistEntry = await env.DB.prepare(
            "SELECT id FROM google_access_allowlist WHERE workshop_id=?1 AND status='ACTIVE' AND (google_sub=?2 OR email=?3)"
          ).bind(WORKSHOP_ID, payload.sub, payload.email).first("id");
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
            await env.DB.prepare(
              "UPDATE users SET status='APPROVED',deactivated_at=NULL WHERE id=?1"
            ).bind(user.id).run();
            user.status = "APPROVED";
            user.deactivated_at = null;
          }
          if (allowlistEntry) {
            await env.DB.prepare(
              "UPDATE google_access_allowlist SET google_sub=?1,updated_at=?2 WHERE id=?3"
            ).bind(payload.sub, now(), allowlistEntry).run();
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
          "SELECT id,email,google_sub,status,created_at,updated_at FROM google_access_allowlist WHERE workshop_id=?1 ORDER BY created_at DESC"
        ).bind(WORKSHOP_ID).all();
        return json({ accounts: accounts.results });
      }

      if (url.pathname === "/api/admin/google-accounts" && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Autenticación requerida" }, 401);
        if (authenticatedSession.role !== "admin") return json({ error: "Permisos insuficientes" }, 403);
        const body = await readJson(request);
        const email = text(body.email, "Email").toLowerCase();
        const googleSub = body.googleSub ? text(body.googleSub, "Google sub") : null;
        const id = uuid();
        await env.DB.prepare(`
          INSERT INTO google_access_allowlist (id,workshop_id,google_sub,email,status,created_by,created_at,updated_at)
          VALUES (?1,?2,?3,?4,'ACTIVE',?5,?6,?7)
          ON CONFLICT(workshop_id,email) DO UPDATE SET
            google_sub=COALESCE(excluded.google_sub,google_access_allowlist.google_sub),
            status='ACTIVE',updated_at=excluded.updated_at
        `).bind(id, WORKSHOP_ID, googleSub, email, authenticatedSession.id, now(), now()).run();
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

      if (url.pathname === "/api/integrations" && request.method === "GET") {
        if (!authenticatedSession) return json({ connections: [] });
        const connections = await env.DB.prepare(
          "SELECT service,account_email,status,scopes,expires_at,connected_at,last_sync_at,error,updated_at FROM google_connections WHERE user_id=?1"
        ).bind(authenticatedSession.id).all();
        return json({ connections: connections.results });
      }

      const integrationStart = url.pathname.match(/^\/api\/integrations\/(google_drive|google_sheets|google_photos)\/start$/);
      if (integrationStart && request.method === "POST") {
        if (!authenticatedSession) return json({ error: "Iniciá sesión con Google para autorizar esta integración" }, 401);
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
        const redirectUri = env.GOOGLE_REDIRECT_URI ?? `${url.origin}/api/auth/callback/google`;
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

      if (url.pathname === "/api/auth/callback/google" && request.method === "GET") {
        if (!authenticatedSession) {
          return new Response(null, { status: 302, headers: { location: "/?tab=integraciones&integration_error=auth_required" } });
        }
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
        if (!authenticatedSession) return json({ error: "Iniciá sesión con Google para administrar esta integración" }, 401);
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
        const chatUserId = authenticatedSession?.id ?? "public-visitor";
        const dailyLimit = Math.max(1, Number(env.GEMINI_DAILY_LIMIT ?? "20"));
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const usage = await env.DB.prepare(`
          SELECT COUNT(*) AS count FROM gemini_usage
          WHERE user_id=?1 AND created_at>=?2
        `).bind(chatUserId, today.toISOString()).first<number>("count");
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
          ).bind(uuid(), chatUserId, model, prompt.length, Date.now() - started, String(responseBody.error?.code ?? "gemini_error"), now()).run();
          return json({ error: "Gemini no pudo procesar la consulta" }, 502);
        }
        const answer = responseBody.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
        if (!answer) return json({ error: "Gemini devolvió una respuesta vacía" }, 502);
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO gemini_usage (id,user_id,model,input_chars,output_chars,latency_ms,success,error_code,created_at) VALUES (?1,?2,?3,?4,?5,?6,1,NULL,?7)"
          ).bind(uuid(), chatUserId, model, prompt.length, answer.length, Date.now() - started, now()),
          env.DB.prepare(
            "INSERT INTO gemini_history (id,user_id,role,content_preview,created_at) VALUES (?1,?2,'user',?3,?4)"
          ).bind(uuid(), chatUserId, prompt.slice(0, 240), now()),
          env.DB.prepare(
            "INSERT INTO gemini_history (id,user_id,role,content_preview,created_at) VALUES (?1,?2,'assistant',?3,?4)"
          ).bind(uuid(), chatUserId, answer.slice(0, 240), now())
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
        const receivedAt = body.receivedAt ? text(body.receivedAt, "Fecha de recepción") : timestamp;
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO repair_orders (id,workshop_id,customer_id,device_id,reference,reported_issue,priority,status,estimated_completion_at,received_at,observations,accessories,assigned_user_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)"
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
            timestamp, timestamp
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
        const [events, diagnostics, quotes] = await Promise.all([
          env.DB.prepare("SELECT * FROM order_status_events WHERE order_id=?1 AND workshop_id=?2 ORDER BY created_at DESC").bind(orderId, WORKSHOP_ID).all(),
          env.DB.prepare("SELECT * FROM diagnostics WHERE order_id=?1 AND workshop_id=?2 ORDER BY created_at DESC").bind(orderId, WORKSHOP_ID).all(),
          env.DB.prepare("SELECT id,version,subtotal_minor,tax_minor,total_minor,status,expires_at,created_at FROM quote_versions WHERE order_id=?1 AND workshop_id=?2 ORDER BY version DESC").bind(orderId, WORKSHOP_ID).all()
        ]);
        return json({ order, events: events.results, diagnostics: diagnostics.results, quotes: quotes.results });
      }

      if (orderDetailMatch && request.method === "PATCH") {
        const orderId = orderDetailMatch[1];
        const body = await readJson(request);
        const order = await env.DB.prepare(
          "SELECT id FROM repair_orders WHERE id=?1 AND workshop_id=?2"
        ).bind(orderId, WORKSHOP_ID).first("id");
        if (!order) return json({ error: "Orden no encontrada" }, 404);
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
            body.receivedAt ? text(body.receivedAt, "Fecha de recepción") : now(),
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
        const order = await env.DB.prepare(
          "SELECT id,device_id FROM repair_orders WHERE id=?1 AND workshop_id=?2"
        ).bind(orderId, WORKSHOP_ID).first<{ id: string; device_id: string }>();
        if (!order) return json({ error: "Orden no encontrada" }, 404);
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
        const timestamp = now();
        const initialStock = integer(body.initialStock ?? 0, "Stock inicial");
        if (initialStock < 0) throw new Error("El stock inicial no puede ser negativo");
        const statements = [
          env.DB.prepare(
            "INSERT INTO parts (id,workshop_id,sku,name,location,cost_minor,sale_price_minor,minimum_stock,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
          ).bind(id, WORKSHOP_ID, text(body.sku, "SKU"), text(body.name, "Nombre"), body.location ? text(body.location, "Ubicación") : null, integer(body.costMinor, "Costo"), integer(body.salePriceMinor, "Precio"), integer(body.minimumStock ?? 0, "Stock mínimo"), timestamp)
        ];
        if (initialStock > 0) {
          statements.push(
            env.DB.prepare(
              "INSERT INTO stock_movements (id,workshop_id,part_id,order_id,kind,quantity,reason,actor_id,created_at) VALUES (?1,?2,?3,NULL,'IN',?4,'Stock inicial registrado',NULL,?5)"
            ).bind(uuid(), WORKSHOP_ID, id, initialStock, timestamp)
          );
        }
        await env.DB.batch(statements);
        await audit(env.DB, "part.created", "part", id, { initialStock });
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

      const partDetailMatch = url.pathname.match(/^\/api\/parts\/([^/]+)$/);
      if (partDetailMatch && request.method === "PATCH") {
        const partId = partDetailMatch[1];
        const body = await readJson(request);
        const part = await env.DB.prepare(
          "SELECT id FROM parts WHERE id=?1 AND workshop_id=?2"
        ).bind(partId, WORKSHOP_ID).first("id");
        if (!part) return json({ error: "Repuesto no encontrado" }, 404);
        await env.DB.prepare(`
          UPDATE parts SET
            sku=?1,name=?2,location=?3,cost_minor=?4,sale_price_minor=?5,minimum_stock=?6
          WHERE id=?7 AND workshop_id=?8
        `).bind(
          text(body.sku, "SKU"),
          text(body.name, "Nombre"),
          body.location ? text(body.location, "Ubicación") : null,
          integer(body.costMinor, "Costo"),
          integer(body.salePriceMinor, "Precio"),
          integer(body.minimumStock ?? 0, "Stock mínimo"),
          partId, WORKSHOP_ID
        ).run();
        await audit(env.DB, "part.updated", "part", partId);
        return json({ ok: true });
      }

      if (partDetailMatch && request.method === "DELETE") {
        const partId = partDetailMatch[1];
        const movements = await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM stock_movements WHERE part_id=?1 AND workshop_id=?2"
        ).bind(partId, WORKSHOP_ID).first<number>("count");
        if ((movements ?? 0) > 0) {
          return json({ error: "No se puede eliminar: el repuesto tiene movimientos de stock registrados." }, 409);
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
      const status = /obligatorio|inválid|positivo|entero|JSON/.test(message) ? 400 : 500;
      return json({ error: message }, status);
    }
  }
};
