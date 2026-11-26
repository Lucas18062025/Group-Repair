import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  canAccessOrder,
  isPublicApiRoute,
  requireAuth,
  requireOrderAccess,
  requireRole,
  requireTenant,
  type AuthorizedSession
} from "./authz";

const session = (role: string, overrides: Partial<AuthorizedSession> = {}): AuthorizedSession => ({
  id: "user-1",
  workshop_id: "workshop-main",
  role,
  ...overrides
});

describe("server-side authorization", () => {
  it("requires an authenticated session", () => {
    expect(() => requireAuth(null)).toThrow(AuthorizationError);
    expect(requireAuth(session("viewer"))).toMatchObject({ id: "user-1" });
  });

  it("requires explicitly allowed roles and never trusts an unknown role", () => {
    expect(() => requireRole(null, "admin")).toThrow(AuthorizationError);
    expect(() => requireRole(session("viewer"), "admin")).toThrow(AuthorizationError);
    expect(() => requireRole(session("cashier"), "technician")).toThrow(AuthorizationError);
    expect(() => requireRole(session("technical_lead"), "cashier")).toThrow(AuthorizationError);
    expect(() => requireRole(session("not-a-role"), "viewer")).toThrow(AuthorizationError);
    expect(requireRole(session("technical_lead"), "technical_lead").role).toBe("technical_lead");
    expect(requireRole(session("admin"), "cashier").role).toBe("admin");
  });

  it("binds operations to the server-derived active workshop", () => {
    expect(requireTenant(session("viewer"), "workshop-main").workshop_id).toBe("workshop-main");
    expect(() => requireTenant(session("admin"), "workshop-other")).toThrow(AuthorizationError);
    expect(() => requireTenant(session("admin", { workshop_id: "workshop-other" }), "workshop-main")).toThrow(AuthorizationError);
  });

  it("checks tenant, role and per-resource order access", () => {
    const order = { workshop_id: "workshop-main", assigned_user_id: null, owner_user_id: null };
    expect(canAccessOrder(session("viewer"), order)).toBe(false);
    expect(canAccessOrder(session("technician"), order)).toBe(false);
    expect(canAccessOrder(session("technician"), { ...order, assigned_user_id: "user-1" })).toBe(true);
    expect(canAccessOrder(session("reception"), order)).toBe(true);
    expect(canAccessOrder(session("cashier"), order)).toBe(true);
    expect(canAccessOrder(session("admin"), { ...order, workshop_id: "workshop-other" })).toBe(false);
    expect(requireOrderAccess(session("technician"), { ...order, assigned_user_id: "user-1" }).id).toBe("user-1");
    expect(() => requireOrderAccess(session("technician"), order)).toThrow(AuthorizationError);
    expect(() => requireOrderAccess(session("admin", { workshop_id: "workshop-other" }), order)).toThrow(AuthorizationError);
    expect(() => requireOrderAccess(session("admin"), { ...order, workshop_id: "workshop-other" })).toThrow(AuthorizationError);
  });

  it("has a minimal public API allowlist", () => {
    expect(isPublicApiRoute("GET", "/api/health")).toBe(true);
    expect(isPublicApiRoute("GET", "/api/auth/config")).toBe(true);
    expect(isPublicApiRoute("POST", "/api/auth/nonce")).toBe(true);
    expect(isPublicApiRoute("POST", "/api/auth/google")).toBe(true);
    expect(isPublicApiRoute("POST", "/api/assistant/messages")).toBe(true);
    expect(isPublicApiRoute("PATCH", "/api/assistant/conversations/public-key")).toBe(true);
    expect(isPublicApiRoute("GET", "/api/assistant/knowledge")).toBe(true);

    expect(isPublicApiRoute("POST", "/api/orders/order-1/diagnostics")).toBe(false);
    expect(isPublicApiRoute("POST", "/api/orders/order-1/quotes")).toBe(false);
    expect(isPublicApiRoute("POST", "/api/orders/order-1/payments")).toBe(false);
    expect(isPublicApiRoute("GET", "/api/customers")).toBe(false);
    expect(isPublicApiRoute("POST", "/api/unknown")).toBe(false);
    expect(isPublicApiRoute("DELETE", "/api/orders/order-1")).toBe(false);
  });
});
