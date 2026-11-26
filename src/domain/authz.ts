export const ROLES = [
  "admin",
  "reception",
  "technician",
  "technical_lead",
  "cashier",
  "viewer"
] as const;

export type Role = (typeof ROLES)[number];

export interface AuthorizedSession {
  id: string;
  workshop_id: string;
  role: string;
}

export interface OrderAccessSubject {
  workshop_id?: string | null;
  assigned_user_id?: string | null;
  owner_user_id?: string | null;
  created_by?: string | null;
}

export class AuthorizationError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Authentication is mandatory; callers must never treat an absent session as a public user. */
export function requireAuth(session: AuthorizedSession | null): AuthorizedSession {
  if (!session) throw new AuthorizationError(401, "Autenticación requerida");
  return session;
}

/** Require an explicitly allowed role. Admin always has the administrative role, never a client-supplied one. */
export function requireRole(session: AuthorizedSession | null, ...allowedRoles: readonly string[]): AuthorizedSession {
  const authenticated = requireAuth(session);
  if (!isRole(authenticated.role)) throw new AuthorizationError(403, "Permisos insuficientes");
  if (authenticated.role !== "admin" && !allowedRoles.includes(authenticated.role)) {
    throw new AuthorizationError(403, "Permisos insuficientes");
  }
  return authenticated;
}

/** Bind every operation to the server-derived active workshop and verify resource ownership metadata. */
export function requireTenant(session: AuthorizedSession | null, workshopId: string): AuthorizedSession {
  const authenticated = requireAuth(session);
  if (!workshopId || authenticated.workshop_id !== workshopId) {
    throw new AuthorizationError(403, "No tienes acceso a este taller");
  }
  return authenticated;
}

/** Check role and per-resource scope; workshop membership must also be verified in the database query. */
export function canAccessOrder(session: AuthorizedSession | null, order: OrderAccessSubject | null | undefined): boolean {
  if (!session || !order) return false;
  if (order.workshop_id !== undefined && order.workshop_id !== null && order.workshop_id !== session.workshop_id) return false;
  if (!isRole(session.role)) return false;
  if (session.role === "admin" || session.role === "technical_lead") return true;
  // Reception operates the workshop-wide order desk; cashiers only need order context for money.
  // Technicians see only assigned/owned orders.
  if (session.role === "reception" || session.role === "cashier") return true;
  return order.assigned_user_id === session.id || order.owner_user_id === session.id || order.created_by === session.id;
}

export function requireOrderAccess(session: AuthorizedSession | null, order: OrderAccessSubject | null | undefined): AuthorizedSession {
  const authenticated = requireAuth(session);
  requireTenant(authenticated, order?.workshop_id ?? "");
  if (!order || !canAccessOrder(authenticated, order)) {
    throw new AuthorizationError(403, "No tienes permiso para acceder a esta orden");
  }
  return authenticated;
}

const PUBLIC_EXACT_ROUTES = new Set([
  "GET /api/health",
  "GET /api/auth/config",
  "GET /api/auth/me",
  "POST /api/auth/nonce",
  "POST /api/auth/google",
  "POST /api/auth/logout"
]);

/** Minimal public API surface. Everything else under /api requires an approved, tenant-bound session. */
export function isPublicApiRoute(method: string, pathname: string): boolean {
  const verb = method.toUpperCase();
  if (PUBLIC_EXACT_ROUTES.has(`${verb} ${pathname}`)) return true;

  // Public assistant: no administrative data is exposed; route-level consent/rate limits remain mandatory.
  if (pathname === "/api/assistant/knowledge" && verb === "GET") return true;
  if (pathname === "/api/assistant/conversations" && verb === "POST") return true;
  if (pathname === "/api/assistant/messages" && verb === "POST") return true;
  if (pathname === "/api/assistant/requests" && verb === "POST") return true;
  if (pathname === "/api/assistant/orders/track" && verb === "POST") return true;
  if (/^\/api\/assistant\/conversations\/[^/]+$/.test(pathname) && verb === "PATCH") return true;

  return false;
}
