import { describe, expect, it } from "vitest";
import {
  deserializeOAuthState,
  formatDriveOriginLabel,
  GOOGLE_DRIVE_SCOPES,
  isTokenExpired,
  serializeOAuthState,
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
