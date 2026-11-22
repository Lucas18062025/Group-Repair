import { useEffect, useState, type FormEvent } from "react";

type Tab = "panel" | "clientes" | "equipos" | "ordenes" | "inventario" | "integraciones" | "gemini";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void; nonce?: string }) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

interface AuthMe {
  user: AuthUser | null;
  googleSub?: string | null;
}

interface AuthConfig {
  googleConfigured: boolean;
  googleClientId: string | null;
  geminiConfigured: boolean;
}

interface IntegrationConnection {
  service: string;
  account_email: string | null;
  status: string;
  scopes: string | null;
  expires_at: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  error: string | null;
  updated_at: string;
}

interface GoogleAllowlistAccount {
  id: string;
  email: string;
  google_sub: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  created_at: string;
}

interface Order {
  id: string;
  reference: string;
  reported_issue: string;
  priority: string;
  status: string;
  customer_name: string;
  customer_phone?: string;
  brand: string;
  model: string;
  category?: string;
  serial_number?: string | null;
  received_at?: string | null;
  observations?: string | null;
  accessories?: string | null;
  reported_fault?: string | null;
  technician_name?: string | null;
  total_minor?: number;
  created_at: string;
}

interface Part {
  id: string;
  sku: string;
  name: string;
  location: string | null;
  cost_minor: number;
  sale_price_minor: number;
  minimum_stock: number;
  stock: number;
}

interface Dashboard {
  ordersByStatus: Array<{ status: string; count: number }>;
  customerCount: number;
  deviceCount: number;
  lowStock: Part[];
  collectedMinor: number;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers }
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "No se pudo completar la operación");
  return body;
}

function formatMoney(amountMinor: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amountMinor / 100);
}

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

export default function App() {
  const initialTab = new URLSearchParams(window.location.search).get("tab");
  const [tab, setTab] = useState<Tab>(
    ["panel", "clientes", "equipos", "ordenes", "inventario", "integraciones", "gemini"].includes(initialTab ?? "")
      ? (initialTab as Tab)
      : "panel"
  );
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [googleSub, setGoogleSub] = useState<string | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationConnection[]>([]);
  const [geminiPrompt, setGeminiPrompt] = useState("");
  const [geminiAnswer, setGeminiAnswer] = useState("");
  const [adminUsers, setAdminUsers] = useState<AuthUser[]>([]);
  const [googleAccounts, setGoogleAccounts] = useState<GoogleAllowlistAccount[]>([]);
  const [showLoginOverlay, setShowLoginOverlay] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  function navigateTab(nextTab: Tab) {
    setTab(nextTab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    window.history.pushState({}, "", url);
  }

  async function refresh() {
    setBusy(true);
    try {
      const [dashboardResult, customersResult, ordersResult, partsResult] = await Promise.all([
        api<Dashboard>("/api/dashboard"),
        api<{ customers: Customer[] }>("/api/customers"),
        api<{ orders: Order[] }>("/api/orders"),
        api<{ parts: Part[] }>("/api/parts")
      ]);
      setDashboard(dashboardResult);
      setCustomers(customersResult.customers);
      setOrders(ordersResult.orders);
      setParts(partsResult.parts);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error al cargar datos");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("integration_error") === "google") {
          setMessage("Google denegó la autorización. En modo Testing, agrega la cuenta como Test User o publica/verifica el proyecto.");
          window.history.replaceState({}, "", "/?tab=integraciones");
        } else if (params.get("integration_error") === "auth_required") {
          setMessage("Iniciá sesión para completar la autorización de Google.");
        } else if (params.get("connected")) {
          setMessage(`Integración ${params.get("connected")} conectada`);
          window.history.replaceState({}, "", `/?tab=integraciones`);
        }
        const [config, me] = await Promise.all([
          api<AuthConfig>("/api/auth/config"),
          api<AuthMe>("/api/auth/me")
        ]);
        setAuthConfig(config);
        setAuthUser(me.user);
        setGoogleSub(me.googleSub ?? null);
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Error al verificar la sesión");
      }
    })();
  }, []);

  useEffect(() => {
    if (!authConfig?.googleConfigured || !authConfig.googleClientId) return;
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    let cancelled = false;
    let timeoutId: number | undefined;
    const initialize = async () => {
      try {
        if (!window.google?.accounts?.id) {
          throw new Error("Google Identity Services aún no está disponible");
        }
        const nonceResponse = await api<{ nonce: string }>("/api/auth/nonce", { method: "POST" });
        if (cancelled) return;
        window.google.accounts.id.initialize({
          client_id: authConfig.googleClientId!,
          nonce: nonceResponse.nonce,
          callback: async (response) => {
            setBusy(true);
            try {
              const result = await api<{ user: AuthUser; googleSub: string }>("/api/auth/google", {
                method: "POST",
                body: JSON.stringify({ credential: response.credential, nonce: nonceResponse.nonce })
              });
              setAuthUser(result.user);
              setGoogleSub(result.googleSub);
              setMessage(result.user.status === "APPROVED" ? "Sesión iniciada" : "Cuenta creada. Pendiente de aprobación.");
              if (result.user.status === "APPROVED") await refresh();
            } catch (error) {
              const loginError = error instanceof Error ? error.message : "No se pudo iniciar sesión";
              try {
                const session = await api<AuthMe>("/api/auth/me");
                if (session.user?.status === "APPROVED") {
                  setAuthUser(session.user);
                  setGoogleSub(session.googleSub ?? null);
                  setMessage("Sesión iniciada");
                  await refresh();
                  return;
                }
              } catch {
                // Keep the original login error visible.
              }
              setMessage(loginError);
            } finally {
              setBusy(false);
            }
          }
        });
        const button = document.getElementById("google-signin-button");
        if (button) {
          window.google.accounts.id.renderButton(button, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            width: 280,
            locale: "es"
          });
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "No se pudo preparar Google Sign-In");
      }
    };
    if (window.google?.accounts?.id) {
      timeoutId = window.setTimeout(() => { void initialize(); }, 0);
    } else if (existing) {
      existing.addEventListener("load", () => { void initialize(); }, { once: true });
      existing.addEventListener("error", () => setMessage("No se pudo cargar Google Sign-In"), { once: true });
      timeoutId = window.setTimeout(() => setMessage("Google Sign-In tardó demasiado en cargar"), 10000);
    } else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => { void initialize(); };
      script.onerror = () => setMessage("No se pudo cargar Google Sign-In");
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [authConfig, showLoginOverlay]);

  useEffect(() => {
    const syncTab = () => {
      const route = new URLSearchParams(window.location.search).get("tab");
      if (route && ["panel", "clientes", "equipos", "ordenes", "inventario", "integraciones", "gemini"].includes(route)) {
        setTab(route as Tab);
      }
    };
    window.addEventListener("popstate", syncTab);
    return () => window.removeEventListener("popstate", syncTab);
  }, []);

  async function loadIntegrations() {
    try {
      const result = await api<{ connections: IntegrationConnection[] }>("/api/integrations");
      setIntegrations(result.connections);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar las integraciones");
    }
  }

  useEffect(() => {
    if (authUser?.status === "APPROVED" && tab === "integraciones") void loadIntegrations();
  }, [tab, authUser]);

  useEffect(() => {
    if (authUser?.status === "APPROVED" && authUser.role === "admin" && tab === "integraciones") {
      void Promise.all([
        api<{ users: AuthUser[] }>("/api/admin/users"),
        api<{ accounts: GoogleAllowlistAccount[] }>("/api/admin/google-accounts")
      ])
        .then(([usersResult, accountsResult]) => {
          setAdminUsers(usersResult.users);
          setGoogleAccounts(accountsResult.accounts);
        })
        .catch((error) => setMessage(error instanceof Error ? error.message : "No se pudieron cargar usuarios"));
    }
  }, [tab, authUser]);

  async function startIntegration(service: "google_drive" | "google_sheets" | "google_photos") {
    try {
      const result = await api<{ authUrl: string }>(`/api/integrations/${service}/start`, { method: "POST" });
      window.location.assign(result.authUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar la conexión");
    }
  }

  async function disconnectIntegration(service: "google_drive" | "google_sheets" | "google_photos") {
    try {
      await api(`/api/integrations/${service}/disconnect`, { method: "POST" });
      await loadIntegrations();
      setMessage("Integración desconectada");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo desconectar");
    }
  }

  async function updateUserStatus(userId: string, action: "approve" | "deactivate") {
    try {
      await api(`/api/admin/users/${userId}/${action}`, { method: "POST" });
      setAdminUsers((users) => users.map((user) => user.id === userId
        ? { ...user, status: action === "approve" ? "APPROVED" : "DEACTIVATED" }
        : user));
      setMessage(action === "approve" ? "Usuario aprobado" : "Usuario desactivado");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar el usuario");
    }
  }

  async function updateUserRole(userId: string, role: string) {
    try {
      await api(`/api/admin/users/${userId}/role`, {
        method: "POST",
        body: JSON.stringify({ role })
      });
      setAdminUsers((users) => users.map((user) => user.id === userId ? { ...user, role } : user));
      setMessage("Permisos actualizados");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar el rol");
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setAuthUser(null);
    setMessage("Sesión cerrada");
  }

  async function addGoogleAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api("/api/admin/google-accounts", {
        method: "POST",
        body: JSON.stringify({
          email: data.get("email"),
          googleSub: data.get("googleSub") || null
        })
      });
      form.reset();
      const result = await api<{ accounts: GoogleAllowlistAccount[] }>("/api/admin/google-accounts");
      setGoogleAccounts(result.accounts);
      setMessage("Cuenta Google autorizada");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo autorizar la cuenta");
    }
  }

  async function removeGoogleAccount(accountId: string) {
    try {
      await api(`/api/admin/google-accounts/${accountId}`, { method: "DELETE" });
      setGoogleAccounts((accounts) => accounts.filter((account) => account.id !== accountId));
      setMessage("Cuenta Google retirada");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo retirar la cuenta");
    }
  }

  async function submitGemini(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setGeminiAnswer("");
    try {
      const result = await api<{ answer: string }>("/api/gemini/chat", {
        method: "POST",
        body: JSON.stringify({ prompt: geminiPrompt })
      });
      setGeminiAnswer(result.answer);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gemini no pudo responder");
    } finally {
      setBusy(false);
    }
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await api("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          phone: form.get("phone"),
          email: form.get("email"),
          address: form.get("address")
        })
      });
      formElement.reset();
      setMessage("Cliente registrado");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error al guardar");
      setBusy(false);
    }
  }

  async function submitPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await api("/api/parts", {
        method: "POST",
        body: JSON.stringify({
          sku: form.get("sku"),
          name: form.get("name"),
          location: form.get("location"),
          costMinor: Number(form.get("cost")) * 100,
          salePriceMinor: Number(form.get("price")) * 100,
          minimumStock: Number(form.get("minimum")),
          initialStock: Number(form.get("initialStock") ?? 0)
        })
      });
      formElement.reset();
      setMessage("Repuesto registrado");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error al guardar");
      setBusy(false);
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      const device = await api<{ id: string }>("/api/devices", {
        method: "POST",
        body: JSON.stringify({
          customerId: form.get("customer"),
          category: form.get("category"),
          brand: form.get("brand"),
          model: form.get("model"),
          serialNumber: form.get("serial"),
          physicalCondition: form.get("condition"),
          reportedFault: form.get("reportedFault"),
          accessories: form.get("accessories")
        })
      });
      const created = await api<{ reference: string }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          customerId: form.get("customer"),
          deviceId: device.id,
          reportedIssue: form.get("reportedIssue"),
          priority: form.get("priority"),
          estimatedCompletionAt: form.get("estimated"),
          receivedAt: form.get("receivedAt"),
          observations: form.get("observations"),
          accessories: form.get("accessories")
        })
      });
      formElement.reset();
      setMessage(`Orden ${created.reference} creada`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error al crear la orden");
      setBusy(false);
    }
  }

  async function openOrder(order: Order) {
    try {
      const result = await api<{ order: Order }>(`/api/orders/${order.id}`);
      setSelectedOrder(result.order);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar el detalle");
    }
  }

  async function deleteOrder(orderId: string) {
    if (!window.confirm("¿Eliminar esta orden vacía y sus datos auxiliares?")) return;
    try {
      await api(`/api/orders/${orderId}`, { method: "DELETE" });
      setSelectedOrder(null);
      setMessage("Orden eliminada");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo eliminar la orden");
    }
  }

  async function adjustPart(partId: string, kind: "IN" | "OUT" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT") {
    const quantityText = window.prompt("Cantidad a registrar");
    if (!quantityText) return;
    const quantity = Number(quantityText);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setMessage("La cantidad debe ser un entero positivo");
      return;
    }
    try {
      await api(`/api/parts/${partId}/movements`, {
        method: "POST",
        body: JSON.stringify({
          quantity,
          kind,
          reason: kind === "OUT" ? "Salida manual de inventario" : "Ajuste manual de stock"
        })
      });
      setMessage("Movimiento de stock registrado");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo ajustar el stock");
    }
  }

  return (
    <>
      {showLoginOverlay && (
        <div className="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="login-title">
          <main className="auth-card" aria-labelledby="login-title">
            <button className="overlay-close" type="button" aria-label="Cerrar" onClick={() => setShowLoginOverlay(false)}>×</button>
            <img className="auth-logo" src="/Group-Repair.jpg" alt="Group Repair" />
            <h1 id="login-title">Acceso administrativo</h1>
            {authUser?.status === "APPROVED" ? (
              <p>Sesión iniciada como {authUser.name}. Las integraciones protegidas ya están disponibles.</p>
            ) : authUser?.status === "PENDING" ? (
              <p>Tu cuenta está pendiente de aprobación. {googleSub ? `Identificador Google: ${googleSub}` : ""}</p>
            ) : authConfig?.googleConfigured ? (
              <div id="google-signin-button" className="google-signin"></div>
            ) : (
              <div className="notice">Google Sign-In pendiente de configuración externa.</div>
            )}
            {message && <div className="notice login-error" role="alert">{message}</div>}
            {authUser && <button className="primary" type="button" onClick={logout}>Cerrar sesión</button>}
            <small className="auth-links">
              <a href="/privacy" target="_blank" rel="noreferrer">Privacidad</a>
              <span> · </span>
              <a href="/terms" target="_blank" rel="noreferrer">Términos</a>
            </small>
          </main>
        </div>
      )}
      <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="/Group-Repair.jpg" alt="Logo de Group Repair" />
          <div className="brand-text"><strong>Group Repair</strong><small>Taller técnico</small></div>
        </div>
        <nav aria-label="Navegación principal">
          {([
            ["panel", "Panel"],
            ["clientes", "Clientes"],
            ["equipos", "Equipos"],
            ["ordenes", "Órdenes"],
            ["inventario", "Inventario"],
            ["integraciones", "Integraciones"],
            ["gemini", "Inteligencia"]
          ] as Array<[Tab, string]>).map(([key, label]) => (
            <button key={key} className={tab === key ? "active" : ""} onClick={() => navigateTab(key)}>{label}</button>
          ))}
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">Gestión operativa</p><h1>{tab === "panel" ? "Panel general" : tab === "gemini" ? "Group Repair Intelligence" : tab[0].toUpperCase() + tab.slice(1)}</h1></div>
          <div className="topbar-actions">
            {busy && <span className="loading">Actualizando</span>}
            {authUser?.status === "APPROVED" ? (
              <>
                <span className="session-user">{authUser.name}</span>
                <button className="secondary" type="button" onClick={logout}>Cerrar sesión</button>
              </>
            ) : (
              <>
                <span className="session-user">Acceso público</span>
                <button className="secondary" type="button" onClick={() => setShowLoginOverlay(true)}>Acceso administrativo</button>
              </>
            )}
          </div>
        </header>

        {message && <div className="notice" role="status">{message}<button aria-label="Cerrar" onClick={() => setMessage("")}>×</button></div>}

        {tab === "panel" && (
          <section className="content">
            <div className="metrics">
              <article><span>Clientes</span><strong>{dashboard?.customerCount ?? 0}</strong></article>
              <article><span>Equipos</span><strong>{dashboard?.deviceCount ?? 0}</strong></article>
              <article><span>Cobrado neto</span><strong>{formatMoney(dashboard?.collectedMinor ?? 0)}</strong></article>
              <article><span>Órdenes activas</span><strong>{dashboard?.ordersByStatus.filter(row => row.status !== "DELIVERED" && row.status !== "CANCELLED").reduce((sum, row) => sum + row.count, 0) ?? 0}</strong></article>
            </div>
            <section className="operations-center" aria-labelledby="operations-title">
              <div className="operations-heading">
                <div><p className="eyebrow">Accesos directos</p><h2 id="operations-title">Centro de operaciones</h2></div>
                <span className="public-badge">Acceso público temporal</span>
              </div>
              <div className="operation-grid">
                <article className="operation-card">
                  <span className="operation-icon" aria-hidden="true">01</span>
                  <h3>Órdenes</h3>
                  <p>Estados, diagnósticos, presupuestos y seguimiento de reparaciones.</p>
                  <button className="primary" type="button" onClick={() => navigateTab("ordenes")}>Abrir gestión</button>
                </article>
                <article className="operation-card">
                  <span className="operation-icon" aria-hidden="true">02</span>
                  <h3>Integraciones</h3>
                  <p>Google Drive, Sheets, Photos y estado real de cada conexión.</p>
                  <button className="primary" type="button" onClick={() => navigateTab("integraciones")}>Abrir integraciones</button>
                </article>
                <article className="operation-card">
                  <span className="operation-icon" aria-hidden="true">03</span>
                  <h3>Group Repair Intelligence</h3>
                  <p>{authConfig?.geminiConfigured ? "Gemini configurado y disponible para consultas." : "Gemini pendiente de configuración con GEMINI_API_KEY."}</p>
                  <button className="primary" type="button" onClick={() => navigateTab("gemini")}>Abrir asistente</button>
                </article>
                <article className="operation-card">
                  <span className="operation-icon" aria-hidden="true">04</span>
                  <h3>Clientes</h3>
                  <p>Administrar clientes y vincular equipos y órdenes de reparación.</p>
                  <button className="primary" type="button" onClick={() => navigateTab("clientes")}>Gestionar clientes</button>
                </article>
                <article className="operation-card">
                  <span className="operation-icon" aria-hidden="true">05</span>
                  <h3>Inventario</h3>
                  <p>Componentes, repuestos, existencias y alertas de stock.</p>
                  <button className="primary" type="button" onClick={() => navigateTab("inventario")}>Abrir inventario</button>
                </article>
              </div>
            </section>
            <div className="grid-two">
              <article className="panel-card">
                <h2>Órdenes por estado</h2>
                {dashboard?.ordersByStatus.length ? <div className="status-list">{dashboard.ordersByStatus.map(row => (
                  <div key={row.status}><span>{statusLabel(row.status)}</span><strong>{row.count}</strong></div>
                ))}</div> : <p className="empty">Todavía no hay órdenes.</p>}
              </article>
              <article className="panel-card">
                <h2>Alertas de inventario</h2>
                {dashboard?.lowStock.length ? dashboard.lowStock.map(part => <div className="stock-alert" key={part.id}><span>{part.name}</span><strong>{part.stock} mín. {part.minimum_stock}</strong></div>) : <p className="empty">No hay alertas de stock.</p>}
              </article>
              <article className="panel-card storage-card">
                <h2>Persistencia de datos</h2>
                <p><strong>Cloudflare D1</strong></p>
                <p className="empty">Clientes, equipos, órdenes, diagnósticos, presupuestos, pagos e inventario se guardan en la base remota configurada para este Worker.</p>
              </article>
            </div>
          </section>
        )}

        {tab === "clientes" && (
          <section className="content grid-two">
            <article className="panel-card">
              <h2>Nuevo cliente</h2>
              <form className="form" onSubmit={submitCustomer}>
                <label>Nombre completo<input name="name" required /></label>
                <label>Teléfono<input name="phone" required /></label>
                <label>Email<input name="email" type="email" /></label>
                <label>Dirección<input name="address" /></label>
                <button className="primary" type="submit" disabled={busy}>Guardar cliente</button>
              </form>
            </article>
            <article className="panel-card">
              <h2>Clientes registrados</h2>
              <div className="table-wrap"><table><thead><tr><th>Nombre</th><th>Teléfono</th><th>Email</th></tr></thead><tbody>
                {customers.map(customer => <tr key={customer.id}><td>{customer.name}</td><td>{customer.phone}</td><td>{customer.email ?? "—"}</td></tr>)}
              </tbody></table></div>
            </article>
          </section>
        )}

        {tab === "equipos" && (
          <section className="content">
            <article className="panel-card">
              <h2>Registro de equipo</h2>
              {customers.length === 0 ? <p className="empty">Primero registre un cliente.</p> : (
                <form className="form form-grid" onSubmit={submitOrder}>
                  <label>Cliente<select name="customer" required><option value="">Seleccionar</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
                  <label>Categoría<select name="category" required><option>Móvil</option><option>Electrodoméstico</option><option>Electrónica</option><option>PC/Laptop</option><option>Otro</option></select></label>
                  <label>Marca<input name="brand" required /></label>
                  <label>Modelo<input name="model" required /></label>
                  <label>Serie / IMEI<input name="serial" /></label>
                  <label>Condición física<input name="condition" /></label>
                  <label>Falla reportada<input name="reportedFault" /></label>
                  <label>Accesorios<input name="accessories" /></label>
                  <label>Problema de la orden<input name="reportedIssue" required /></label>
                  <label>Observaciones<textarea name="observations" rows={3} /></label>
                  <label>Prioridad<select name="priority"><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label>
                  <label>Fecha de recepción<input name="receivedAt" type="datetime-local" /></label>
                  <label>Entrega estimada<input name="estimated" type="datetime-local" /></label>
                  <button className="primary" type="submit" disabled={busy}>Crear equipo y orden</button>
                </form>
              )}
            </article>
          </section>
        )}

        {tab === "ordenes" && (
          <section className="content">
            <article className="panel-card">
              <h2>Órdenes de reparación</h2>
              <div className="table-wrap"><table><thead><tr><th>Número</th><th>Cliente</th><th>Equipo</th><th>Ingreso</th><th>Estado</th><th>Técnico</th><th>Presupuesto</th><th>Acciones</th></tr></thead><tbody>
                {orders.map(order => <tr key={order.id}><td><strong>{order.reference}</strong></td><td>{order.customer_name}<br /><small>{order.customer_phone ?? ""}</small></td><td>{order.brand} {order.model}{order.serial_number ? ` · ${order.serial_number}` : ""}</td><td>{order.received_at ? new Date(order.received_at).toLocaleString("es-AR") : new Date(order.created_at).toLocaleString("es-AR")}</td><td><span className="badge">{statusLabel(order.status)}</span></td><td>{order.technician_name ?? "Sin asignar"}</td><td>{formatMoney(order.total_minor ?? 0)}</td><td><button className="secondary" type="button" onClick={() => openOrder(order)}>Ver detalle</button></td></tr>)}
              </tbody></table></div>
              {!orders.length && <p className="empty">Todavía no hay órdenes.</p>}
            </article>
            {selectedOrder && (
              <article className="panel-card order-detail">
                <div className="detail-heading">
                  <h2>Detalle {selectedOrder.reference}</h2>
                  <button className="secondary" type="button" onClick={() => setSelectedOrder(null)}>Cerrar</button>
                </div>
                <dl>
                  <dt>Cliente</dt><dd>{selectedOrder.customer_name}</dd>
                  <dt>Equipo</dt><dd>{selectedOrder.category ?? ""} · {selectedOrder.brand} {selectedOrder.model}</dd>
                  <dt>Serie / IMEI</dt><dd>{selectedOrder.serial_number ?? "No informado"}</dd>
                  <dt>Falla reportada</dt><dd>{selectedOrder.reported_fault ?? selectedOrder.reported_issue}</dd>
                  <dt>Observaciones</dt><dd>{selectedOrder.observations ?? "Sin observaciones"}</dd>
                  <dt>Accesorios</dt><dd>{selectedOrder.accessories ?? "Sin accesorios"}</dd>
                  <dt>Técnico</dt><dd>{selectedOrder.technician_name ?? "Sin asignar"}</dd>
                  <dt>Estado</dt><dd>{statusLabel(selectedOrder.status)}</dd>
                </dl>
                <button className="danger" type="button" onClick={() => deleteOrder(selectedOrder.id)}>Eliminar registro vacío</button>
              </article>
            )}
          </section>
        )}

        {tab === "inventario" && (
          <section className="content grid-two">
            <article className="panel-card">
              <h2>Nuevo repuesto</h2>
              <form className="form" onSubmit={submitPart}>
                <label>SKU<input name="sku" required /></label>
                <label>Nombre<input name="name" required /></label>
                <label>Ubicación<input name="location" /></label>
                <label>Costo ($)<input name="cost" type="number" min="0" step="0.01" required /></label>
                <label>Precio ($)<input name="price" type="number" min="0" step="0.01" required /></label>
                <label>Stock inicial<input name="initialStock" type="number" min="0" step="1" defaultValue="0" required /></label>
                <label>Stock mínimo<input name="minimum" type="number" min="0" defaultValue="0" required /></label>
                <button className="primary" type="submit" disabled={busy}>Guardar repuesto</button>
              </form>
            </article>
            <article className="panel-card">
              <h2>Existencias</h2>
              <div className="table-wrap"><table><thead><tr><th>SKU</th><th>Repuesto</th><th>Stock</th><th>Precio</th><th>Acciones</th></tr></thead><tbody>
                {parts.map(part => <tr key={part.id}><td>{part.sku}</td><td>{part.name}</td><td><strong>{part.stock}</strong></td><td>{formatMoney(part.sale_price_minor)}</td><td><div className="row-actions"><button className="secondary" type="button" onClick={() => adjustPart(part.id, "IN")}>Entrada</button><button className="secondary" type="button" onClick={() => adjustPart(part.id, "OUT")}>Salida</button></div></td></tr>)}
              </tbody></table></div>
            </article>
          </section>
        )}

        {tab === "integraciones" && (
          <section className="content">
            <div className="integration-grid">
              {([
                ["google_drive", "Google Drive", "Adjuntar documentación y archivos de órdenes.", "google_drive"],
                ["google_sheets", "Google Sheets", "Exportar e importar datos estructurados.", "google_sheets"],
                ["google_photos", "Google Photos", "Seleccionar fotografías mediante Photos Picker.", "google_photos"]
              ] as Array<[IntegrationConnection["service"], string, string, "google_drive" | "google_sheets" | "google_photos"]>).map(([service, title, description, serviceKey]) => {
                const connection = integrations.find((item) => item.service === service);
                const connected = connection?.status === "connected";
                return (
                  <article className="panel-card integration-card" key={service}>
                    <div>
                      <h2>{title}</h2>
                      <p>{description}</p>
                    </div>
                    <span className={`integration-status ${connected ? "connected" : ""}`}>{connected ? "Conectado" : "Desconectado"}</span>
                    {connection?.account_email && <small>Cuenta: {connection.account_email}</small>}
                    {connection?.error && <p className="integration-error">{connection.error}</p>}
                    {connected ? (
                      <button className="secondary" type="button" onClick={() => disconnectIntegration(serviceKey)}>Desconectar</button>
                    ) : (
                      <button className="primary" type="button" onClick={() => startIntegration(serviceKey)}>Conectar</button>
                    )}
                  </article>
                );
              })}
              <article className="panel-card integration-card">
                <div>
                  <h2>Gemini</h2>
                  <p>Asistente técnico de Group Repair Intelligence.</p>
                </div>
                <span className={`integration-status ${authConfig?.geminiConfigured ? "connected" : ""}`}>
                  {authConfig?.geminiConfigured ? "Configurado" : "Pendiente"}
                </span>
                {authConfig?.geminiConfigured ? (
                  <small>API key disponible en Cloudflare Workers.</small>
                ) : (
                  <p className="integration-error">Gemini está pendiente de configuración. Es necesario configurar <code>GEMINI_API_KEY</code> en Cloudflare Workers.</p>
                )}
                <button className="primary" type="button" onClick={() => navigateTab("gemini")}>Abrir Intelligence</button>
              </article>
            </div>

            {authUser?.role === "admin" && (
              <>
                <article className="panel-card admin-users">
                  <h2>Cuentas Google autorizadas</h2>
                  <form className="form allowlist-form" onSubmit={addGoogleAccount}>
                    <label>Email autorizado<input name="email" type="email" required /></label>
                    <label>Google <code>sub</code> (opcional)<input name="googleSub" /></label>
                    <button className="primary" type="submit">Autorizar cuenta</button>
                  </form>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Email</th><th>Google sub</th><th>Estado</th><th>Acción</th></tr></thead>
                      <tbody>
                        {googleAccounts.map((account) => (
                          <tr key={account.id}>
                            <td>{account.email}</td>
                            <td>{account.google_sub ?? "Pendiente"}</td>
                            <td>{account.status}</td>
                            <td><button className="secondary" type="button" onClick={() => removeGoogleAccount(account.id)}>Retirar</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
                <article className="panel-card admin-users">
                  <h2>Usuarios pendientes y acceso</h2>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Usuario</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acción</th></tr></thead>
                    <tbody>
                      {adminUsers.map((user) => (
                        <tr key={user.id}>
                          <td>{user.name}</td><td>{user.email}</td>
                          <td>
                            {user.id === authUser.id ? (
                              <span>{user.role}</span>
                            ) : (
                              <select
                                aria-label={`Rol de ${user.name}`}
                                value={user.role}
                                onChange={(event) => updateUserRole(user.id, event.target.value)}
                              >
                                <option value="admin">Administrador</option>
                                <option value="reception">Recepción</option>
                                <option value="technician">Técnico</option>
                                <option value="technical_lead">Responsable técnico</option>
                                <option value="cashier">Caja</option>
                                <option value="viewer">Consulta</option>
                              </select>
                            )}
                          </td>
                          <td>{user.status}</td>
                          <td>
                            {user.status === "PENDING" && <button className="secondary" type="button" onClick={() => updateUserStatus(user.id, "approve")}>Aprobar</button>}
                            {user.status === "APPROVED" && user.id !== authUser.id && <button className="secondary" type="button" onClick={() => updateUserStatus(user.id, "deactivate")}>Desactivar</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </article>
              </>
            )}
          </section>
        )}

        {tab === "gemini" && (
          <section className="content">
            <article className="panel-card gemini-card">
              <h2>Group Repair Intelligence</h2>
              {authConfig?.geminiConfigured ? (
                <form className="form" onSubmit={submitGemini}>
                  <label>Consulta técnica
                    <textarea value={geminiPrompt} onChange={(event) => setGeminiPrompt(event.target.value)} maxLength={4000} required />
                  </label>
                  <button className="primary" type="submit" disabled={busy}>Consultar</button>
                </form>
              ) : (
                <div className="notice">Gemini pendiente de configuración. Falta configurar el secreto <code>GEMINI_API_KEY</code>.</div>
              )}
              {geminiAnswer && <div className="gemini-answer"><strong>Respuesta</strong><p>{geminiAnswer}</p><small>Asistente técnico: confirmar diagnósticos y operaciones con criterio humano.</small></div>}
            </article>
          </section>
        )}
        <footer className="author-footer">
          <span>Diseñado por <a href="https://portafolio.lucaslean1806.workers.dev/" target="_blank" rel="noreferrer">Lucas Villagra | Cybersecurity Analyst</a></span>
          <span>
            <a href="https://github.com/Lucas18062025/Group-Repair" target="_blank" rel="noreferrer">GitHub</a>
            {" · "}
            <a href="https://www.linkedin.com/in/lucas-villagra-cybersecurity" target="_blank" rel="noreferrer">LinkedIn</a>
          </span>
        </footer>
      </main>
      </div>
    </>
  );
}
