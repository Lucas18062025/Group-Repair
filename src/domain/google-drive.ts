import { base64UrlDecode, base64UrlEncode } from "../auth";

export type GoogleConnectionType = "WORKSHOP" | "PERSONAL";

export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
] as const;

export interface GoogleAuthStatePayload {
  csrfToken: string;
  connectionType: GoogleConnectionType;
  userId: string;
  workshopId: string;
  timestamp: number;
}

export function serializeOAuthState(payload: GoogleAuthStatePayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deserializeOAuthState(stateStr: string): GoogleAuthStatePayload | null {
  try {
    let base64 = stateStr.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as GoogleAuthStatePayload;
    if (
      typeof parsed.csrfToken === "string" &&
      (parsed.connectionType === "WORKSHOP" || parsed.connectionType === "PERSONAL") &&
      typeof parsed.userId === "string" &&
      typeof parsed.workshopId === "string" &&
      typeof parsed.timestamp === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * OAuth state is base64url(JSON).signature so the payload cannot be altered by the browser.
 * The signed value is also validated against the one-time row in oauth_states by the Worker.
 */
export async function signOAuthState(payload: GoogleAuthStatePayload, secret: string | undefined): Promise<string> {
  if (!secret) throw new Error("Falta la clave de firma de OAuth");
  const encoded = serializeOAuthState(payload);
  const keyBytes = base64UrlDecode(secret);
  if (keyBytes.length !== 32) throw new Error("La clave de firma de OAuth debe tener 32 bytes");
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(keyBytes).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyOAuthState(value: string, secret: string | undefined): Promise<GoogleAuthStatePayload | null> {
  if (!secret) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const payload = deserializeOAuthState(parts[0]);
  if (!payload) return null;
  const keyBytes = base64UrlDecode(secret);
  if (keyBytes.length !== 32) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(keyBytes).buffer as ArrayBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      new Uint8Array(base64UrlDecode(parts[1])).buffer as ArrayBuffer,
      new TextEncoder().encode(parts[0])
    ) ? payload : null;
  } catch {
    return null;
  }
}

export function isTokenExpired(expiresAt: string | null | undefined, marginMs = 60000): boolean {
  if (!expiresAt) return true;
  const time = new Date(expiresAt).getTime();
  if (isNaN(time)) return true;
  return Date.now() + marginMs >= time;
}

export function formatDriveOriginLabel(type: GoogleConnectionType | string): string {
  return type === "WORKSHOP" ? "Drive del taller" : "Drive personal";
}
