export interface AuthPreparedStatement {
  bind(...values: unknown[]): AuthPreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface AuthDatabase {
  prepare(query: string): AuthPreparedStatement;
  batch(statements: AuthPreparedStatement[]): Promise<unknown[]>;
}

interface JwksCache { keys: GoogleJwk[]; fetchedAt: number; }
let jwksCache: JwksCache | null = null;

export interface GooglePayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  nonce?: string;
  exp: number;
  iss: string;
  aud: string | string[];
}

interface GoogleJwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buffer(value: Uint8Array): ArrayBuffer {
  return new Uint8Array(value).buffer as ArrayBuffer;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function verifyGoogleIdToken(
  credential: string,
  clientId: string,
  nonce: string
): Promise<GooglePayload> {
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Error("ID Token inválido");

  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))) as { kid?: string; alg?: string };
  const payloadBytes = base64UrlDecode(parts[1]);
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as GooglePayload;

  if (header.alg !== "RS256" || !header.kid) throw new Error("Algoritmo o clave de ID Token inválidos");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) {
    throw new Error("Emisor de ID Token no válido");
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(clientId)) throw new Error("Audiencia de ID Token no válida");
  if (!payload.exp || payload.exp * 1000 <= Date.now()) throw new Error("ID Token expirado");
  if (!payload.sub) throw new Error("Identidad de Google sin sub");
  if (!payload.nonce || payload.nonce !== nonce) throw new Error("Nonce de ID Token inválido");

  // Caché de JWKS con TTL de 5 minutos para reducir latencia y dependencia de red.
  const nowMs = Date.now();
  if (!jwksCache || nowMs - jwksCache.fetchedAt > 5 * 60 * 1000) {
    const jwksResponse = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
      headers: { "cache-control": "public, max-age=300" }
    });
    if (!jwksResponse.ok) throw new Error("No se pudieron obtener claves de Google");
    const jwks = await jwksResponse.json() as { keys: GoogleJwk[] };
    jwksCache = { keys: jwks.keys, fetchedAt: nowMs };
  }
  const jwk = jwksCache.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Clave de Google no disponible");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk as never,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signature = base64UrlDecode(parts[2]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    buffer(signature),
    buffer(new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  );
  if (!valid) throw new Error("Firma de ID Token inválida");
  return payload;
}

export function parseCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const match = cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function setSessionCookie(token: string, secure = true): string {
  const maxAge = 60 * 60 * 8;
  return `gr_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(): string {
  return "gr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure";
}

function decodeSecretKey(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function encryptSecret(secret: string, keyBase64: string | undefined): Promise<string> {
  if (!keyBase64) throw new Error("Falta la clave de cifrado de integraciones");
  const keyBytes = decodeSecretKey(keyBase64);
  if (keyBytes.length !== 32) throw new Error("La clave de cifrado debe tener 32 bytes");
  const key = await crypto.subtle.importKey("raw", buffer(keyBytes), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buffer(iv) },
    key,
    buffer(new TextEncoder().encode(secret))
  );
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string, keyBase64: string | undefined): Promise<string> {
  if (!keyBase64) throw new Error("Falta la clave de cifrado de integraciones");
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error("Credencial cifrada inválida");
  const keyBytes = decodeSecretKey(keyBase64);
  if (keyBytes.length !== 32) throw new Error("La clave de cifrado debe tener 32 bytes");
  const key = await crypto.subtle.importKey("raw", buffer(keyBytes), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buffer(base64UrlDecode(parts[0])) },
    key,
    buffer(base64UrlDecode(parts[1]))
  );
  return new TextDecoder().decode(decrypted);
}

export function randomToken(bytes = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}
