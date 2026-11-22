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

export function isTokenExpired(expiresAt: string | null | undefined, marginMs = 60000): boolean {
  if (!expiresAt) return true;
  const time = new Date(expiresAt).getTime();
  if (isNaN(time)) return true;
  return Date.now() + marginMs >= time;
}

export function formatDriveOriginLabel(type: GoogleConnectionType | string): string {
  return type === "WORKSHOP" ? "Drive del taller" : "Drive personal";
}
