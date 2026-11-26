import { describe, expect, it } from "vitest";
import {
  deserializeOAuthState,
  formatDriveOriginLabel,
  GOOGLE_DRIVE_SCOPES,
  isTokenExpired,
  serializeOAuthState,
  signOAuthState,
  verifyOAuthState,
  type GoogleAuthStatePayload
} from "./google-drive";

describe("google-drive domain", () => {
  it("requests minimal least-privilege scopes (drive.file and userinfo)", () => {
    expect(GOOGLE_DRIVE_SCOPES).toContain("https://www.googleapis.com/auth/drive.file");
    expect(GOOGLE_DRIVE_SCOPES).not.toContain("https://www.googleapis.com/auth/drive");
    expect(GOOGLE_DRIVE_SCOPES).not.toContain("https://www.googleapis.com/auth/drive.readonly");
  });

  it("serializes and deserializes OAuth state with CSRF protection and connection types", () => {
    const payload: GoogleAuthStatePayload = {
      csrfToken: "abc123xyz",
      connectionType: "WORKSHOP",
      userId: "usr-456",
      workshopId: "workshop-main",
      timestamp: Date.now()
    };
    const serialized = serializeOAuthState(payload);
    expect(serialized).toMatch(/^[a-zA-Z0-9_-]+$/);

    const deserialized = deserializeOAuthState(serialized);
    expect(deserialized).toEqual(payload);
  });

  it("rejects corrupted or forged OAuth state", () => {
    expect(deserializeOAuthState("invalid-base64")).toBeNull();
    expect(deserializeOAuthState("")).toBeNull();
  });

  it("signs OAuth state and rejects modified payloads", async () => {
    const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
    const secret = base64(new Uint8Array(32).fill(7));
    const payload: GoogleAuthStatePayload = {
      csrfToken: "csrf-token",
      connectionType: "PERSONAL",
      userId: "usr-1",
      workshopId: "workshop-main",
      timestamp: Date.now()
    };
    const signed = await signOAuthState(payload, secret);
    expect(await verifyOAuthState(signed, secret)).toEqual(payload);
    const forgedPayload = btoa(JSON.stringify({ ...payload, connectionType: "WORKSHOP" }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const tampered = `${forgedPayload}.${signed.split(".")[1]}`;
    expect(await verifyOAuthState(tampered, secret)).toBeNull();
    expect(await verifyOAuthState(signed, base64(new Uint8Array(32).fill(8)))).toBeNull();
  });

  it("evaluates token expiration with safety margin", () => {
    const now = Date.now();
    expect(isTokenExpired(null)).toBe(true);
    expect(isTokenExpired(new Date(now - 10000).toISOString())).toBe(true); // already expired
    expect(isTokenExpired(new Date(now + 30000).toISOString())).toBe(true); // within 1 minute safety margin
    expect(isTokenExpired(new Date(now + 3600000).toISOString())).toBe(false); // expires in 1 hour
  });

  it("formats origin labels accurately", () => {
    expect(formatDriveOriginLabel("WORKSHOP")).toBe("Drive del taller");
    expect(formatDriveOriginLabel("PERSONAL")).toBe("Drive personal");
  });
});
