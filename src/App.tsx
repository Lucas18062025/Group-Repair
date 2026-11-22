import { useEffect, useState, type FormEvent } from "react";

type Tab = "panel" | "clientes" | "equipos" | "ordenes" | "inventario" | "integraciones" | "gemini" | "asistencia";

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
  surname: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  observations: string | null;
  status: string;
  owner_user_id: string | null;
  device_count: number;
  order_count: number;
  created_at: string;
}

interface Device {
  id: string;
  customer_id: string;
  category: string;
  brand: string;
  model: string;
  serial_number: string | null;
  physical_condition: string | null;
  reported_fault: string | null;
  accessories: string | null;
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
  category: string | null;
  location: string | null;
  cost_minor: number;
  sale_price_minor: number;
  minimum_stock: number;
  stock: number;
  status: "ACTIVO" | "INACTIVO" | "ARCHIVADO";
  archived_at: string | null;
  created_at: string;
  updated_at: string | null;
}

interface StockMovement {
  id: string;
  part_id: string;
  order_id: string | null;
  kind: string;
  quantity: number;
  reason: string;
  created_at: string;
  stock_before: number | null;
  stock_after: number | null;
  reference: string | null;
  sku?: string;
  part_name?: string;
}

interface AssistantRequest {
  id: string;
  reference: string;
  name: string;
  phone: string;
  email: string | null;
  equipment_type: string | null;
  brand: string | null;
  model: string | null;
  problem: string;
  accessories: string | null;
  request_type: string;
  status: string;
  order_id: string | null;
  created_at: string;
  updated_at: string;
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
    ["panel", "clientes", "equipos", "ordenes", "inventario", "integraciones", "gemini", "asistencia"].includes(initialTab ?? "")
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
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryCategory, setInventoryCategory] = useState("TODAS");
  const [inventoryLocation, setInventoryLocation] = useState("TODAS");
  const [inventoryAvailability, setInventoryAvailability] = useState("TODAS");
  const [inventorySort, setInventorySort] = useState("name");
  const [showArchived, setShowArchived] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [busyPartId, setBusyPartId] = useState<string | null>(null);
  const [historyKind, setHistoryKind] = useState("TODOS");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerDevices, setCustomerDevices] = useState<Device[]>([]);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [customerOrderPrefill, setCustomerOrderPrefill] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderFilter, setOrderFilter] = useState("TODAS");
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPublicKey, setChatPublicKey] = useState<string | null>(null);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "assistant" | "customer"; content: string }>>([
    { role: "assistant", content: "¡Hola! Bienvenido a Group Repair.\n\nSoy el asistente virtual del taller. Puedo ayudarte a consultar reparaciones, conocer nuestros servicios o solicitar asistencia técnica.\n\n¿Qué necesitás hoy?" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatFlow, setChatFlow] = useState<"IDLE" | "REPAIR" | "REPAIR_CONFIRM" | "CONTACT">("IDLE");
  const [repairDraft, setRepairDraft] = useState<Record<string, string>>({});
  const [assistantRequests, setAssistantRequests] = useState<AssistantRequest[]>([]);
  const [knowledgeCategory, setKnowledgeCategory] = useState("Horarios");
  const [knowledgeQuestion, setKnowledgeQuestion] = useState("");
  const [knowledgeAnswer, setKnowledgeAnswer] = useState("");

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
      if (route && ["panel", "clientes", "equipos", "ordenes", "inventario", "integraciones", "gemini", "asistencia"].includes(route)) {
        setTab(route as Tab);
      }
    };
    window.addEventListener("popstate", syncTab);
    return () => window.removeEventListener("popstate", syncTab);
  }, []);

  useEffect(() => {
    if (tab !== "ordenes") return;
    void api<{ devices: Device[] }>("/api/devices")
      .then((result) => setAvailableDevices(result.devices))
      .catch((error) => setMessage(error instanceof Error ? error.message : "No se pudieron cargar los equipos"));
  }, [tab]);

  useEffect(() => {
    if (!showOrderForm || !customerOrderPrefill) return;
    void api<{ devices: Device[] }>(`/api/devices?customer=${encodeURIComponent(customerOrderPrefill)}`)
      .then((result) => setAvailableDevices(result.devices))
      .catch(() => setAvailableDevices([]));
  }, [showOrderForm, customerOrderPrefill]);

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

  useEffect(() => {
    if (authUser?.status === "APPROVED" && ["admin", "reception", "technical_lead"].includes(authUser.role) && tab === "asistencia") {
      void api<{ requests: AssistantRequest[] }>("/api/admin/assistant/requests")
        .then((result) => setAssistantRequests(result.requests))
        .catch((error) => setMessage(error instanceof Error ? error.message : "No se pudieron cargar las solicitudes"));
    }
  }, [tab, authUser]);

  async function updateAssistantRequestStatus(requestId: string, status: string) {
    try {
      await api(`/api/admin/assistant/requests/${requestId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setAssistantRequests((requests) => requests.map((request) => request.id === requestId ? { ...request, status } : request));
      setMessage("Estado de asistencia actualizado");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar la solicitud");
    }
  }

  async function convertAssistantRequest(requestId: string) {
    if (!window.confirm("¿Crear una orden real a partir de esta solicitud aprobada?")) return;
    try {
      const result = await api<{ reference: string }>(`/api/admin/assistant/requests/${requestId}/convert`, { method: "POST" });
      setAssistantRequests((requests) => requests.map((request) => request.id === requestId ? { ...request, status: "RESUELTA", order_id: result.reference } : request));
      setMessage(`Solicitud convertida en orden ${result.reference}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo convertir la solicitud");
    }
  }

  async function addKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api("/api/admin/assistant/knowledge", {
        method: "POST",
        body: JSON.stringify({
          category: knowledgeCategory,
          question: knowledgeQuestion,
          answer: knowledgeAnswer
        })
      });
      setKnowledgeQuestion("");
      setKnowledgeAnswer("");
      setMessage("Conocimiento agregado");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el conocimiento");
    }
  }

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

  async function startChat() {
    if (chatPublicKey) {
      setChatOpen(true);
      return;
    }
    setChatBusy(true);
    try {
      const result = await api<{ publicKey: string; conversationId: string }>("/api/assistant/conversations", {
        method: "POST",
        body: JSON.stringify({ consent: false })
      });
      setChatPublicKey(result.publicKey);
      setChatConversationId(result.conversationId);
      setChatOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar la asistencia");
    } finally {
      setChatBusy(false);
    }
  }

  async function sendChatMessage(message?: string) {
    const textMessage = (message ?? chatInput).trim();
    if (!textMessage || chatBusy || !chatPublicKey) return;
    setChatInput("");
    setChatMessages((messages) => [...messages, { role: "customer", content: textMessage }]);
    setChatBusy(true);
    try {
      const result = await api<{ reply: string; limitedAi: boolean }>("/api/assistant/messages", {
        method: "POST",
        body: JSON.stringify({ publicKey: chatPublicKey, message: textMessage })
      });
      setChatMessages((messages) => [...messages, { role: "assistant", content: result.reply }]);
    } catch (error) {
      setChatMessages((messages) => [...messages, {
        role: "assistant",
        content: error instanceof Error ? error.message : "No se pudo procesar el mensaje."
      }]);
    } finally {
      setChatBusy(false);
    }
  }

  async function beginRepairRequest() {
    setChatFlow("REPAIR");
    setRepairDraft({});
    setChatMessages((messages) => [...messages,
      { role: "assistant", content: "Vamos a registrar tu solicitud. ¿Cuál es tu nombre completo?" }
    ]);
  }

  async function beginContactRequest() {
    setChatFlow("CONTACT");
    setRepairDraft({});
    setChatMessages((messages) => [...messages,
      { role: "assistant", content: "Indicame tu nombre completo." }
    ]);
  }

  async function handleChatRepair(message: string) {
    const fields = ["name", "phone", "equipmentType", "brand", "model", "problem", "accessories"];
    const nextIndex = fields.findIndex((field) => !(repairDraft[field]?.trim()));
    if (nextIndex < 0) return;
    const field = fields[nextIndex];
    const labels: Record<string, string> = {
      name: "nombre",
      phone: "teléfono",
      equipmentType: "tipo de equipo",
      brand: "marca",
      model: "modelo",
      problem: "descripción del problema",
      accessories: "accesorios entregados"
    };
    const nextDraft = { ...repairDraft, [field]: message };
    setRepairDraft(nextDraft);
    const remaining = fields.find((item) => !(nextDraft[item]?.trim()));
    if (remaining) {
      const prompts: Record<string, string> = {
        phone: "¿Cuál es tu teléfono de contacto?",
        equipmentType: "¿Qué tipo de equipo es?",
        brand: "¿Qué marca tiene?",
        model: "¿Qué modelo es?",
        problem: "Contame brevemente cuál es el problema.",
        accessories: "¿Qué accesorios entregás? Si no entregás accesorios, escribí «ninguno»."
      };
      setChatMessages((messages) => [...messages, { role: "assistant", content: prompts[remaining] ?? `¿Cuál es el ${labels[remaining]}?` }]);
      return;
    }
    setChatFlow("REPAIR_CONFIRM");
    setChatMessages((messages) => [...messages, {
      role: "assistant",
      content: `Resumen:\nNombre: ${nextDraft.name}\nTeléfono: ${nextDraft.phone}\nEquipo: ${nextDraft.equipmentType} ${nextDraft.brand} ${nextDraft.model}\nProblema: ${nextDraft.problem}\nAccesorios: ${nextDraft.accessories}\n\n¿Confirmás que querés enviar la solicitud?`
    }]);
  }

  async function confirmRepairRequest() {
    if (!chatPublicKey) return;
    setChatBusy(true);
    try {
      const result = await api<{ reference: string; message: string }>("/api/assistant/requests", {
        method: "POST",
        body: JSON.stringify({
          publicKey: chatPublicKey,
          requestType: "REPAIR",
          consent: true,
          name: repairDraft.name,
          phone: repairDraft.phone,
          equipmentType: repairDraft.equipmentType,
          brand: repairDraft.brand,
          model: repairDraft.model,
          problem: repairDraft.problem,
          accessories: repairDraft.accessories
        })
      });
      setChatMessages((messages) => [...messages, {
        role: "assistant",
        content: `${result.message}\nReferencia: ${result.reference}`
      }]);
      setChatFlow("IDLE");
      setRepairDraft({});
    } catch (error) {
      setChatMessages((messages) => [...messages, {
        role: "assistant",
        content: error instanceof Error ? error.message : "No se pudo registrar la solicitud"
      }]);
    } finally {
      setChatBusy(false);
    }
  }

  async function submitChatText() {
    if (chatFlow === "REPAIR_CONFIRM") {
      const message = chatInput.trim();
      setChatInput("");
      setChatMessages((messages) => [...messages, { role: "customer", content: message }]);
      if (/^(sí|si|confirmo|correcto|envialo|acepto)$/i.test(message)) {
        await confirmRepairRequest();
      } else if (/^(no|cancelar|editar|corregir)$/i.test(message)) {
        setChatFlow("REPAIR");
        setRepairDraft({});
        setChatMessages((messages) => [...messages, { role: "assistant", content: "Entendido. Empecemos de nuevo. ¿Cuál es tu nombre completo?" }]);
      } else {
        setChatMessages((messages) => [...messages, { role: "assistant", content: "Respondé «sí» para confirmar o «no» para corregir los datos." }]);
      }
      return;
    }
    if (chatFlow === "REPAIR") {
      const message = chatInput.trim();
      if (!message) return;
      setChatInput("");
      setChatMessages((messages) => [...messages, { role: "customer", content: message }]);
      await handleChatRepair(message);
      return;
    }
    if (chatFlow === "CONTACT") {
      const message = chatInput.trim();
      if (!message) return;
      setChatInput("");
      setChatMessages((messages) => [...messages, { role: "customer", content: message }]);
      if (!repairDraft.name) {
        setRepairDraft({ name: message });
        setChatMessages((messages) => [...messages, { role: "assistant", content: "¿Cuál es tu teléfono de contacto?" }]);
      } else if (!repairDraft.phone) {
        setRepairDraft((draft) => ({ ...draft, phone: message }));
        setChatMessages((messages) => [...messages, { role: "assistant", content: "¿Cuál es el motivo de contacto?" }]);
      } else if (!repairDraft.problem) {
        const draft: Record<string, string> = { ...repairDraft, problem: message };
        setRepairDraft(draft);
        setChatBusy(true);
        try {
          const result = await api<{ reference: string; message: string }>("/api/assistant/requests", {
            method: "POST",
            body: JSON.stringify({
              publicKey: chatPublicKey,
              requestType: "CONTACT",
              consent: true,
              name: draft.name,
              phone: draft.phone,
              problem: draft.problem
            })
          });
          setChatMessages((messages) => [...messages, { role: "assistant", content: `${result.message}\nReferencia: ${result.reference}` }]);
          setChatFlow("IDLE");
          setRepairDraft({});
        } catch (error) {
          setChatMessages((messages) => [...messages, { role: "assistant", content: error instanceof Error ? error.message : "No se pudo registrar el contacto" }]);
        } finally {
          setChatBusy(false);
        }
      }
      return;
    }
    await sendChatMessage();
  }

  async function closeChatConversation() {
    if (chatPublicKey) {
      try {
        await api(`/api/assistant/conversations/${encodeURIComponent(chatPublicKey)}`, { method: "PATCH" });
      } catch {
        // El cierre visual también protege la interacción aunque falle la red.
      }
    }
    setChatOpen(false);
    setChatFlow("IDLE");
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authUser?.status || authUser.status !== "APPROVED") {
      setShowLoginOverlay(true);
      setMessage("Se requiere una sesión aprobada para crear clientes");
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await api("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          surname: form.get("surname"),
          phone: form.get("phone"),
          email: form.get("email"),
          address: form.get("address"),
          observations: form.get("observations")
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

  async function openCustomer(customer: Customer) {
    try {
      const result = await api<{ customer: Customer; devices: Device[]; orders: Order[] }>(`/api/customers/${customer.id}`);
      setSelectedCustomer(result.customer);
      setCustomerDevices(result.devices);
      setCustomerOrders(result.orders);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo abrir el detalle");
    }
  }

  async function editCustomer(customer: Customer) {
    if (!authUser?.status || authUser.status !== "APPROVED") {
      setShowLoginOverlay(true);
      setMessage("Se requiere una sesión aprobada para editar clientes");
      return;
    }
    const name = window.prompt("Nombre", customer.name);
    if (!name?.trim()) return;
    const surname = window.prompt("Apellido", customer.surname ?? "") ?? "";
    const phone = window.prompt("Teléfono", customer.phone);
    if (!phone?.trim()) return;
    const email = window.prompt("Email", customer.email ?? "") ?? "";
    const address = window.prompt("Dirección", customer.address ?? "") ?? "";
    const observations = window.prompt("Observaciones", customer.observations ?? "") ?? "";
    try {
      await api(`/api/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), surname: surname.trim(), phone: phone.trim(), email: email.trim(), address: address.trim(), observations: observations.trim(), status: customer.status ?? "ACTIVO" })
      });
      setMessage("Cliente actualizado");
      await refresh();
      setSelectedCustomer(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo editar el cliente");
    }
  }

  async function deleteCustomer(customer: Customer) {
    if (!authUser?.status || authUser.status !== "APPROVED") {
      setShowLoginOverlay(true);
      setMessage("Se requiere una sesión aprobada para eliminar clientes");
      return;
    }
    const detail = await api<{ devices: Device[]; orders: Order[] }>(`/api/customers/${customer.id}`).catch(() => null);
    const deviceCount = detail?.devices.length ?? 0;
    const orderCount = detail?.orders.length ?? 0;
    const confirmation = window.prompt(
      `Eliminar a "${customer.name}" también eliminará ${deviceCount} equipo(s) y ${orderCount} orden(es), con sus dependencias asociadas.\n\nEscribe el nombre exacto para confirmar.`,
      ""
    );
    if (confirmation !== customer.name) return;
    try {
      await api(`/api/customers/${customer.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmName: confirmation })
      });
      setSelectedCustomer(null);
      setMessage("Cliente y sus datos asociados eliminados");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo eliminar el cliente");
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
          category: form.get("category"),
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

  async function submitDirectOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authUser?.status || authUser.status !== "APPROVED") {
      setShowLoginOverlay(true);
      setMessage("Se requiere una sesión aprobada para crear órdenes");
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    let deviceId = String(form.get("device"));
    setBusy(true);
    try {
      if (!deviceId) {
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
        deviceId = device.id;
      }
      const created = await api<{ reference: string }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          customerId: form.get("customer"),
          deviceId,
          reportedIssue: form.get("reportedIssue"),
          observations: form.get("observations"),
          accessories: form.get("accessories"),
          priority: form.get("priority"),
          receivedAt: form.get("receivedAt"),
          estimatedCompletionAt: form.get("estimated")
        })
      });
      formElement.reset();
      setCustomerOrderPrefill("");
      setShowOrderForm(false);
      setMessage(`Orden ${created.reference} creada`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear la orden");
    } finally {
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

  async function editOrder(order: Order) {
    if (!authUser?.status || authUser.status !== "APPROVED") {
      setShowLoginOverlay(true);
      setMessage("Se requiere una sesión aprobada para editar órdenes");
      return;
    }
    const reportedIssue = window.prompt("Problema informado", order.reported_issue);
    if (!reportedIssue?.trim()) return;
    const observations = window.prompt("Observaciones", order.observations ?? "") ?? "";
    const accessories = window.prompt("Accesorios", order.accessories ?? "") ?? "";
    try {
      await api(`/api/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          reportedIssue: reportedIssue.trim(),
          observations: observations.trim(),
          accessories: accessories.trim(),
          priority: order.priority,
          estimatedCompletionAt: null,
          receivedAt: order.received_at ?? order.created_at,
          assignedUserId: null,
          category: order.category ?? "Otro",
          brand: order.brand,
          model: order.model,
          serialNumber: order.serial_number,
          physicalCondition: null,
          reportedFault: reportedIssue.trim()
        })
      });
      setMessage("Orden actualizada");
      await refresh();
      setSelectedOrder(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo editar la orden");
    }
  }

  async function changeOrderStatus(order: Order, status: string) {
    if (!authUser?.status || authUser.status !== "APPROVED") {
      setShowLoginOverlay(true);
      setMessage("Se requiere una sesión aprobada para cambiar estados");
      return;
    }
    const reason = window.prompt("Motivo del cambio", "Actualización operativa");
    if (reason === null) return;
    try {
      await api(`/api/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, reason })
      });
      setMessage("Estado actualizado");
      await refresh();
      setSelectedOrder(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cambiar el estado");
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

  async function adjustPart(partId: string, kind: "IN" | "OUT" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT", quantityOverride?: number) {
    if (!authUser?.status || authUser.status !== "APPROVED") {
      setShowLoginOverlay(true);
      setMessage("Se requiere una sesión aprobada para modificar inventario");
      return null;
    }
    if (busyPartId) return null;
    setBusyPartId(partId);
    try {
      const quantityText = quantityOverride !== undefined
        ? String(quantityOverride)
        : kind === "OUT" || kind === "IN"
          ? "1"
          : window.prompt("Cantidad a registrar");
      if (!quantityText) return null;
      const quantity = Number(quantityText);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        setMessage("La cantidad debe ser un entero positivo");
        return null;
      }
      const reference = crypto.randomUUID();
      const result = await api<{ stockAfter: number }>(`/api/parts/${partId}/movements`, {
        method: "POST",
        body: JSON.stringify({
          quantity,
          kind,
          reason: kind === "OUT" ? "Salida rápida de una unidad" : kind === "IN" ? "Entrada rápida de una unidad" : "Ajuste manual de stock",
          reference
        })
      });
      setMessage("Movimiento de stock registrado");
      await refresh();
      return result.stockAfter;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo ajustar el stock");
      return null;
    } finally {
      setBusyPartId(null);
    }
  }

  async function quickStock(part: Part, kind: "IN" | "OUT") {
    if (kind === "OUT" && part.stock <= 0) {
      setMessage("El producto no tiene stock disponible");
      return;
    }
    const stockAfter = await adjustPart(part.id, kind);
    if (stockAfter !== null) {
      setSelectedPart((current) => current?.id === part.id ? { ...current, stock: stockAfter } : current);
    }
  }

  async function adjustToFinal(part: Part) {
    if (!authUser?.status || authUser.status !== "APPROVED") {
      setShowLoginOverlay(true);
      setMessage("Se requiere una sesión aprobada para ajustar inventario");
      return;
    }
    const targetText = window.prompt(`Stock actual: ${part.stock}. Cantidad final deseada`, String(part.stock));
    if (!targetText) return;
    const targetStock = Number(targetText);
    if (!Number.isSafeInteger(targetStock) || targetStock < 0) {
      setMessage("La cantidad final debe ser un entero mayor o igual a cero");
      return;
    }
    const reason = window.prompt("Motivo del ajuste", "Corrección de inventario físico");
    if (!reason?.trim()) return;
    if (busyPartId) return;
    setBusyPartId(part.id);
    try {
      const result = await api<{ stockAfter: number }>(`/api/parts/${part.id}/movements`, {
        method: "POST",
        body: JSON.stringify({
          targetStock,
          reason: reason.trim(),
          reference: crypto.randomUUID()
        })
      });
      setMessage(`Stock ajustado a ${result.stockAfter}`);
      await refresh();
      setSelectedPart((current) => current?.id === part.id ? { ...current, stock: result.stockAfter } : current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo ajustar el stock");
    } finally {
      setBusyPartId(null);
    }
  }

  async function changePartStatus(part: Part, status: "ACTIVO" | "INACTIVO" | "ARCHIVADO") {
    if (!authUser?.status || authUser.status !== "APPROVED") {
      setShowLoginOverlay(true);
      setMessage("Se requiere una sesión aprobada para administrar productos");
      return;
    }
    try {
      await api(`/api/parts/${part.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setSelectedPart(null);
      setMessage(status === "ARCHIVADO" ? "Producto archivado" : status === "ACTIVO" ? "Producto reactivado" : "Producto marcado como inactivo");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cambiar el estado");
    }
  }

  async function openPartDetail(part: Part) {
    try {
      const result = await api<{ part: Part; movements: StockMovement[] }>(`/api/parts/${part.id}`);
      setSelectedPart(result.part);
      setMovements(result.movements);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo abrir el detalle");
    }
  }

  async function editPart(part: Part) {
    if (!authUser?.status || authUser.status !== "APPROVED") {
      setShowLoginOverlay(true);
      setMessage("Se requiere una sesión aprobada para editar productos");
      return;
    }
    const name = window.prompt("Nombre", part.name);
    if (!name?.trim()) return;
    const sku = window.prompt("SKU", part.sku);
    if (!sku?.trim()) return;
    const category = window.prompt("Categoría", part.category ?? "");
    const location = window.prompt("Ubicación", part.location ?? "");
    const costText = window.prompt("Costo en pesos", String(part.cost_minor / 100));
    const priceText = window.prompt("Precio de venta en pesos", String(part.sale_price_minor / 100));
    const minimumText = window.prompt("Stock mínimo", String(part.minimum_stock));
    if (costText === null || priceText === null || minimumText === null) return;
    const costMinor = Math.round(Number(costText) * 100);
    const salePriceMinor = Math.round(Number(priceText) * 100);
    const minimumStock = Number(minimumText);
    if (![costMinor, salePriceMinor, minimumStock].every(Number.isSafeInteger) || costMinor < 0 || salePriceMinor < 0 || minimumStock < 0) {
      setMessage("Los valores monetarios y el stock mínimo deben ser válidos");
      return;
    }
    try {
      await api(`/api/parts/${part.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          sku: sku.trim(),
          name: name.trim(),
          category: category?.trim() || null,
          location: location?.trim() || null,
          costMinor,
          salePriceMinor,
          minimumStock
        })
      });
      setMessage("Producto actualizado");
      await refresh();
      setSelectedPart(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo editar el producto");
    }
  }

  async function loadInventoryHistory() {
    try {
      const kindQuery = historyKind === "TODOS" ? "" : `?kind=${encodeURIComponent(historyKind)}`;
      const result = await api<{ movements: StockMovement[] }>(`/api/inventory/movements${kindQuery}`);
      setMovements(result.movements);
      setShowHistory(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar el historial");
    }
  }

  async function reverseMovement(movement: StockMovement) {
    if (!authUser?.status || authUser.status !== "APPROVED") {
      setShowLoginOverlay(true);
      setMessage("Se requiere una sesión aprobada para revertir movimientos");
      return;
    }
    if (!window.confirm("¿Generar una reversión compensatoria sin modificar el movimiento original?")) return;
    try {
      await api(`/api/inventory/movements/${movement.id}/reverse`, { method: "POST" });
      setMessage("Movimiento revertido mediante una operación compensatoria");
      await refresh();
      await loadInventoryHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo revertir el movimiento");
    }
  }

  const inventoryActiveParts = parts.filter((part) => part.status !== "ARCHIVADO");
  const inventoryArchivedParts = parts.filter((part) => part.status === "ARCHIVADO");
  const inventoryUnits = inventoryActiveParts.reduce((sum, part) => sum + part.stock, 0);
  const inventoryLowStock = inventoryActiveParts.filter((part) => part.stock > 0 && part.stock <= part.minimum_stock).length;
  const inventoryOutOfStock = inventoryActiveParts.filter((part) => part.stock === 0).length;
  const inventoryValue = inventoryActiveParts.reduce((sum, part) => sum + part.stock * part.cost_minor, 0);
  const inventoryCategories = Array.from(new Set(inventoryActiveParts.map((part) => part.category).filter((value): value is string => Boolean(value))));
  const inventoryLocations = Array.from(new Set(inventoryActiveParts.map((part) => part.location).filter((value): value is string => Boolean(value))));
  const inventoryVisibleParts = (showArchived ? inventoryArchivedParts : inventoryActiveParts)
    .filter((part) => !inventorySearch || `${part.name} ${part.sku}`.toLowerCase().includes(inventorySearch.toLowerCase()))
    .filter((part) => inventoryCategory === "TODAS" || part.category === inventoryCategory)
    .filter((part) => inventoryLocation === "TODAS" || part.location === inventoryLocation)
    .filter((part) => {
      if (inventoryAvailability === "BAJO") return part.stock > 0 && part.stock <= part.minimum_stock;
      if (inventoryAvailability === "SIN") return part.stock === 0;
      if (inventoryAvailability === "DISPONIBLE") return part.stock > part.minimum_stock;
      return true;
    })
    .sort((a, b) => {
      if (inventorySort === "stock") return b.stock - a.stock;
      if (inventorySort === "price") return b.sale_price_minor - a.sale_price_minor;
      return a.name.localeCompare(b.name);
    });

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
      {!chatOpen && (
        <button className="assistant-fab" type="button" aria-label="Abrir asistencia de Group Repair" onClick={() => void startChat()}>
          <span aria-hidden="true">AI</span>
          <small>Asistencia</small>
        </button>
      )}
      {chatOpen && (
        <aside className="assistant-widget" aria-label="Asistente virtual de Group Repair">
          <header className="assistant-widget-header">
            <div className="assistant-agent"><span aria-hidden="true">GR</span><div><strong>Asistente Group Repair</strong><small><i /> Disponible · modo informado</small></div></div>
            <button type="button" aria-label="Finalizar conversación" onClick={() => void closeChatConversation()}>×</button>
          </header>
          <div className="assistant-messages" aria-live="polite">
            {chatMessages.map((message, index) => (
              <div className={`assistant-message ${message.role}`} key={`${index}-${message.role}`}>
                <span>{message.role === "assistant" ? "Asistente" : "Vos"}</span>
                <p>{message.content}</p>
              </div>
            ))}
            {chatBusy && <div className="assistant-thinking"><span /><span /><span /> Procesando</div>}
          </div>
          {chatFlow === "IDLE" && (
            <div className="assistant-quick-actions">
              <button type="button" onClick={() => void beginRepairRequest()}>Solicitar reparación</button>
              <button type="button" onClick={() => void sendChatMessage("Consultar estado de reparación")}>Consultar estado</button>
              <button type="button" onClick={() => void sendChatMessage("Consultar servicios")}>Consultar servicios</button>
              <button type="button" onClick={() => void sendChatMessage("Consultar presupuesto")}>Consultar presupuesto</button>
              <button type="button" onClick={() => void beginContactRequest()}>Hablar con el taller</button>
            </div>
          )}
          <form className="assistant-compose" onSubmit={(event) => { event.preventDefault(); void submitChatText(); }}>
            <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} maxLength={2000} placeholder="Escribí tu consulta..." disabled={chatBusy} />
            <button type="submit" disabled={chatBusy || !chatInput.trim()} aria-label="Enviar mensaje">Enviar</button>
          </form>
          <footer className="assistant-consent">Al enviar, aceptás el tratamiento de la información necesaria para gestionar tu consulta.</footer>
        </aside>
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
            ["gemini", "Inteligencia"],
            ["asistencia", "Asistencia"]
          ] as Array<[Tab, string]>).map(([key, label]) => (
            <button key={key} className={tab === key ? "active" : ""} onClick={() => navigateTab(key)}>{label}</button>
          ))}
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">Gestión operativa</p><h1>{tab === "panel" ? "Panel general" : tab === "gemini" ? "Group Repair Intelligence" : tab === "asistencia" ? "Asistencia / Conversaciones" : tab[0].toUpperCase() + tab.slice(1)}</h1></div>
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
          <section className="content customers-page">
            <header className="inventory-header">
              <div>
                <p className="eyebrow">Cartera de clientes</p>
                <h2>Clientes</h2>
                <p>Consulta, edición y relaciones con equipos y órdenes.</p>
              </div>
              <button className="primary" type="button" onClick={() => setShowCustomerForm(true)}>Nuevo cliente</button>
            </header>
            <div className="customer-toolbar">
              <label>Buscar
                <input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Nombre, teléfono o email" />
              </label>
            </div>
            <article className="panel-card customer-table-card">
              <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Teléfono</th><th>Email</th><th>Equipos</th><th>Órdenes</th><th>Acciones</th></tr></thead><tbody>
                {customers
                  .filter((customer) => !customerSearch || `${customer.name} ${customer.surname ?? ""} ${customer.phone} ${customer.email ?? ""}`.toLowerCase().includes(customerSearch.toLowerCase()))
                  .map(customer => (
                    <tr key={customer.id}>
                      <td><button className="product-link" type="button" onClick={() => openCustomer(customer)}><strong>{customer.name}{customer.surname ? ` ${customer.surname}` : ""}</strong><small>{customer.address ?? "Sin dirección"}</small></button></td>
                      <td>{customer.phone}</td>
                      <td>{customer.email ?? "—"}</td>
                      <td>{customer.device_count ?? 0}</td>
                      <td>{customer.order_count ?? 0}</td>
                      <td><div className="row-actions"><button className="secondary" type="button" onClick={() => openCustomer(customer)}>Detalle</button><button className="secondary" type="button" onClick={() => editCustomer(customer)}>Editar</button><button className="danger" type="button" onClick={() => deleteCustomer(customer)}>Eliminar</button></div></td>
                    </tr>
                  ))}
              </tbody></table></div>
              {!customers.filter((customer) => !customerSearch || `${customer.name} ${customer.surname ?? ""} ${customer.phone} ${customer.email ?? ""}`.toLowerCase().includes(customerSearch.toLowerCase())).length && <p className="empty">No hay clientes que coincidan.</p>}
            </article>

            {showCustomerForm && (
              <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-customer-title">
                <article className="modal-card">
                  <div className="detail-heading"><h2 id="new-customer-title">Nuevo cliente</h2><button className="overlay-close-inline" type="button" onClick={() => setShowCustomerForm(false)}>×</button></div>
                  <form className="form form-grid" onSubmit={async (event) => { await submitCustomer(event); setShowCustomerForm(false); }}>
                    <label>Nombre<input name="name" required /></label>
                    <label>Apellido<input name="surname" /></label>
                    <label>Teléfono<input name="phone" required /></label>
                    <label>Email<input name="email" type="email" /></label>
                    <label>Dirección<input name="address" /></label>
                    <label>Observaciones<textarea name="observations" rows={3} /></label>
                    <button className="primary" type="submit" disabled={busy}>Guardar cliente</button>
                  </form>
                </article>
              </div>
            )}

            {selectedCustomer && (
              <aside className="inventory-drawer" aria-label={`Detalle de ${selectedCustomer.name}`}>
                <div className="detail-heading"><div><p className="eyebrow">Detalle del cliente</p><h2>{selectedCustomer.name}{selectedCustomer.surname ? ` ${selectedCustomer.surname}` : ""}</h2></div><button className="overlay-close-inline" type="button" onClick={() => setSelectedCustomer(null)}>×</button></div>
                <dl className="drawer-details"><dt>Teléfono</dt><dd>{selectedCustomer.phone}</dd><dt>Email</dt><dd>{selectedCustomer.email ?? "—"}</dd><dt>Dirección</dt><dd>{selectedCustomer.address ?? "—"}</dd><dt>Observaciones</dt><dd>{selectedCustomer.observations ?? "—"}</dd></dl>
                <div className="drawer-actions"><button className="secondary" type="button" onClick={() => editCustomer(selectedCustomer)}>Editar</button><button className="primary" type="button" onClick={() => { navigateTab("ordenes"); setCustomerOrderPrefill(selectedCustomer.id); }}>Crear orden</button><button className="danger" type="button" onClick={() => deleteCustomer(selectedCustomer)}>Eliminar</button></div>
                <div className="drawer-history"><h3>Equipos</h3>{customerDevices.map(device => <div className="movement-row" key={device.id}><span>{device.category}</span><strong>{device.brand} {device.model}</strong><small>{device.serial_number ?? "Sin serie"} · {device.reported_fault ?? "Sin falla"}</small></div>)}{!customerDevices.length && <p className="empty">Sin equipos asociados.</p>}</div>
                <div className="drawer-history"><h3>Órdenes</h3>{customerOrders.map(order => <button className="customer-order-link" type="button" key={order.id} onClick={() => openOrder(order)}><strong>{order.reference}</strong><span>{statusLabel(order.status)}</span></button>)}{!customerOrders.length && <p className="empty">Sin órdenes asociadas.</p>}</div>
              </aside>
            )}
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
            <header className="inventory-header">
              <div><p className="eyebrow">Gestión de reparaciones</p><h2>Órdenes</h2><p>Seguimiento completo desde la recepción hasta la entrega.</p></div>
              <button className="primary" type="button" onClick={() => setShowOrderForm(true)}>Nueva orden</button>
            </header>
            <div className="inventory-toolbar">
              <label className="inventory-search">Buscar
                <input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="Número, cliente, equipo o problema" />
              </label>
              <label>Estado
                <select value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)}>
                  <option value="TODAS">Todas</option>
                  <option value="RECEIVED">Recibidas</option>
                  <option value="DIAGNOSIS">En diagnóstico</option>
                  <option value="WAITING_FOR_PARTS">Esperando aprobación/repuesto</option>
                  <option value="IN_REPAIR">En reparación</option>
                  <option value="READY_FOR_DELIVERY">Finalizadas</option>
                  <option value="DELIVERED">Entregadas</option>
                  <option value="CANCELLED">Canceladas</option>
                </select>
              </label>
            </div>
            <article className="panel-card inventory-table-card">
              <div className="table-wrap"><table className="inventory-table"><thead><tr><th>Número</th><th>Cliente</th><th>Equipo</th><th>Recepción</th><th>Estado</th><th>Técnico</th><th>Importe</th><th>Última actualización</th><th>Acciones</th></tr></thead><tbody>
                {orders
                  .filter((order) => orderFilter === "TODAS" || order.status === orderFilter || (orderFilter === "WAITING_FOR_PARTS" && ["WAITING_FOR_PARTS", "QUOTED", "APPROVED"].includes(order.status)) || (orderFilter === "READY_FOR_DELIVERY" && ["TESTING", "READY_FOR_DELIVERY", "NOT_REPAIRABLE"].includes(order.status)))
                  .filter((order) => !orderSearch || `${order.reference} ${order.customer_name} ${order.brand} ${order.model} ${order.reported_issue}`.toLowerCase().includes(orderSearch.toLowerCase()))
                  .map(order => <tr key={order.id}><td><strong>{order.reference}</strong></td><td>{order.customer_name}<br /><small>{order.customer_phone ?? ""}</small></td><td>{order.brand} {order.model}{order.serial_number ? ` · ${order.serial_number}` : ""}</td><td>{order.received_at ? new Date(order.received_at).toLocaleString("es-AR") : new Date(order.created_at).toLocaleString("es-AR")}</td><td><span className="badge">{statusLabel(order.status)}</span></td><td>{order.technician_name ?? "Sin asignar"}</td><td>{formatMoney(order.total_minor ?? 0)}</td><td>{new Date(order.created_at).toLocaleString("es-AR")}</td><td><div className="row-actions"><button className="secondary" type="button" onClick={() => openOrder(order)}>Detalle</button><button className="secondary" type="button" onClick={() => editOrder(order)}>Editar</button></div></td></tr>)}
              </tbody></table></div>
              {!orders.length && <p className="empty">Todavía no hay órdenes registradas. Crea la primera desde este módulo.</p>}
            </article>

            {showOrderForm && (
              <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-order-title">
                <article className="modal-card">
                  <div className="detail-heading"><h2 id="new-order-title">Nueva orden</h2><button className="overlay-close-inline" type="button" onClick={() => setShowOrderForm(false)}>×</button></div>
                  <form className="form form-grid" onSubmit={submitDirectOrder}>
                    <label>Cliente
                      <select name="customer" defaultValue={customerOrderPrefill} required onChange={(event) => {
                        const customerId = event.target.value;
                        setCustomerOrderPrefill(customerId);
                        if (customerId) void api<{ devices: Device[] }>(`/api/devices?customer=${encodeURIComponent(customerId)}`).then((result) => setAvailableDevices(result.devices)).catch(() => setAvailableDevices([]));
                        else setAvailableDevices([]);
                      }}><option value="">Seleccionar</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.surname ? ` ${customer.surname}` : ""}</option>)}</select>
                    </label>
                    <label>Equipo asociado
                      <select name="device"><option value="">Registrar equipo nuevo</option>{availableDevices.filter(device => !customerOrderPrefill || device.customer_id === customerOrderPrefill).map(device => <option key={device.id} value={device.id}>{device.brand} {device.model} · {device.serial_number ?? "Sin serie"}</option>)}</select>
                    </label>
                    <label>Categoría<select name="category"><option>Móvil</option><option>Electrodoméstico</option><option>Electrónica</option><option>PC/Laptop</option><option>Otro</option></select></label>
                    <label>Marca<input name="brand" /></label>
                    <label>Modelo<input name="model" /></label>
                    <label>Serie / IMEI<input name="serial" /></label>
                    <label>Condición física<input name="condition" /></label>
                    <label>Falla reportada<input name="reportedFault" /></label>
                    <label>Accesorios<input name="accessories" /></label>
                    <label>Problema informado<input name="reportedIssue" required /></label>
                    <label>Observaciones<textarea name="observations" rows={3} /></label>
                    <label>Prioridad<select name="priority"><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label>
                    <label>Fecha de recepción<input name="receivedAt" type="datetime-local" /></label>
                    <label>Entrega estimada<input name="estimated" type="datetime-local" /></label>
                    <button className="primary" type="submit" disabled={busy}>Guardar orden</button>
                  </form>
                </article>
              </div>
            )}
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
                  <div className="drawer-actions">
                    <button className="secondary" type="button" onClick={() => editOrder(selectedOrder)}>Editar orden</button>
                    <button className="primary" type="button" onClick={() => changeOrderStatus(selectedOrder, "DIAGNOSIS")}>Pasar a diagnóstico</button>
                    <button className="secondary" type="button" onClick={() => changeOrderStatus(selectedOrder, "CANCELLED")}>Cancelar</button>
                    <button className="danger" type="button" onClick={() => deleteOrder(selectedOrder.id)}>Eliminar orden</button>
                  </div>
              </article>
            )}
          </section>
        )}

        {tab === "inventario" && (
          <section className="content inventory-page">
            <header className="inventory-header">
              <div>
                <p className="eyebrow">Existencias y repuestos</p>
                <h2>Inventario</h2>
                <p>Administra unidades, movimientos y productos sin abandonar el flujo operativo.</p>
              </div>
              <div className="inventory-actions">
                <button className="secondary" type="button" onClick={loadInventoryHistory}>Historial</button>
                <button className="secondary" type="button" onClick={() => setShowMovementForm(true)}>Registrar movimiento</button>
                <button className="primary" type="button" onClick={() => setShowProductForm(true)}>Nuevo producto</button>
              </div>
            </header>

            <div className="inventory-metrics">
              <article><span>Productos activos</span><strong>{inventoryActiveParts.length}</strong></article>
              <article><span>Unidades disponibles</span><strong>{inventoryUnits}</strong></article>
              <article><span>Stock bajo</span><strong>{inventoryLowStock}</strong></article>
              <article><span>Sin stock</span><strong>{inventoryOutOfStock}</strong></article>
              <article><span>Valor a costo</span><strong>{formatMoney(inventoryValue)}</strong></article>
            </div>

            <div className="inventory-toolbar">
              <label className="inventory-search">Buscar
                <input value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Nombre o SKU" />
              </label>
              <label>Categoría
                <select value={inventoryCategory} onChange={(event) => setInventoryCategory(event.target.value)}>
                  <option value="TODAS">Todas</option>
                  {inventoryCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label>Ubicación
                <select value={inventoryLocation} onChange={(event) => setInventoryLocation(event.target.value)}>
                  <option value="TODAS">Todas</option>
                  {inventoryLocations.map((location) => <option key={location} value={location}>{location}</option>)}
                </select>
              </label>
              <label>Disponibilidad
                <select value={inventoryAvailability} onChange={(event) => setInventoryAvailability(event.target.value)}>
                  <option value="TODAS">Todas</option>
                  <option value="DISPONIBLE">Disponible</option>
                  <option value="BAJO">Stock bajo</option>
                  <option value="SIN">Sin stock</option>
                </select>
              </label>
              <label>Ordenar
                <select value={inventorySort} onChange={(event) => setInventorySort(event.target.value)}>
                  <option value="name">Nombre</option>
                  <option value="stock">Cantidad</option>
                  <option value="price">Precio</option>
                </select>
              </label>
              <button className="secondary" type="button" onClick={() => {
                setInventorySearch("");
                setInventoryCategory("TODAS");
                setInventoryLocation("TODAS");
                setInventoryAvailability("TODAS");
                setInventorySort("name");
              }}>Limpiar</button>
            </div>

            <div className="inventory-view-switch">
              <button className={!showArchived ? "active" : ""} type="button" onClick={() => setShowArchived(false)}>Productos activos</button>
              <button className={showArchived ? "active" : ""} type="button" onClick={() => setShowArchived(true)}>Productos archivados ({inventoryArchivedParts.length})</button>
            </div>

            <article className="panel-card inventory-table-card">
              <div className="table-wrap">
                <table className="inventory-table">
                  <thead><tr><th>Producto</th><th>Categoría</th><th>Ubicación</th><th>Existencias</th><th>Mínimo</th><th>Estado</th><th>Costo</th><th>Precio</th><th>Acciones</th></tr></thead>
                  <tbody>
                    {inventoryVisibleParts.map((part) => {
                      const availability = part.stock === 0 ? "SIN STOCK" : part.stock <= part.minimum_stock ? "STOCK BAJO" : "DISPONIBLE";
                      return (
                        <tr key={part.id}>
                          <td><button className="product-link" type="button" onClick={() => openPartDetail(part)}><strong>{part.name}</strong><small>{part.sku}</small></button></td>
                          <td>{part.category ?? "Sin categoría"}</td>
                          <td>{part.location ?? "Sin ubicación"}</td>
                          <td>
                            <div className="stock-stepper">
                              <button type="button" aria-label={`Descontar una unidad de ${part.name}`} disabled={busyPartId === part.id || part.stock === 0 || part.status !== "ACTIVO"} onClick={() => void quickStock(part, "OUT")}>−</button>
                              <strong>{part.stock}</strong>
                              <button type="button" aria-label={`Agregar una unidad a ${part.name}`} disabled={busyPartId === part.id || part.status !== "ACTIVO"} onClick={() => void quickStock(part, "IN")}>+</button>
                            </div>
                          </td>
                          <td>{part.minimum_stock}</td>
                          <td><span className={`stock-status ${availability === "SIN STOCK" ? "out" : availability === "STOCK BAJO" ? "low" : "available"}`}>{availability}</span></td>
                          <td>{formatMoney(part.cost_minor)}</td>
                          <td>{formatMoney(part.sale_price_minor)}</td>
                          <td><div className="row-actions"><button className="secondary" type="button" onClick={() => adjustToFinal(part)} disabled={part.status !== "ACTIVO"}>Ajustar</button><button className="secondary" type="button" onClick={() => openPartDetail(part)}>Detalle</button></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!inventoryVisibleParts.length && <p className="empty">No hay productos que coincidan con los filtros.</p>}
            </article>

            {showProductForm && (
              <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-product-title">
                <article className="modal-card">
                  <div className="detail-heading"><h2 id="new-product-title">Nuevo producto</h2><button className="overlay-close-inline" type="button" onClick={() => setShowProductForm(false)}>×</button></div>
                  <form className="form form-grid inventory-product-form" onSubmit={async (event) => {
                    await submitPart(event);
                    setShowProductForm(false);
                  }}>
                    <label>SKU<input name="sku" required /></label>
                    <label>Nombre<input name="name" required /></label>
                    <label>Categoría<input name="category" /></label>
                    <label>Ubicación<input name="location" /></label>
                    <label>Costo ($)<input name="cost" type="number" min="0" step="0.01" required /></label>
                    <label>Precio ($)<input name="price" type="number" min="0" step="0.01" required /></label>
                    <label>Stock inicial<input name="initialStock" type="number" min="0" step="1" defaultValue="0" required /></label>
                    <label>Stock mínimo<input name="minimum" type="number" min="0" defaultValue="0" required /></label>
                    <button className="primary" type="submit" disabled={busy}>Guardar producto</button>
                  </form>
                </article>
              </div>
            )}

            {showMovementForm && (
              <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="movement-title">
                <article className="modal-card">
                  <div className="detail-heading"><h2 id="movement-title">Registrar movimiento</h2><button className="overlay-close-inline" type="button" onClick={() => setShowMovementForm(false)}>×</button></div>
                  <form className="form" onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const partId = String(form.get("partId"));
                    const quantity = Number(form.get("quantity"));
                    await adjustPart(partId, String(form.get("kind")) as "IN" | "OUT", quantity);
                    setShowMovementForm(false);
                  }}>
                    <label>Producto
                      <select name="partId" required><option value="">Seleccionar</option>{inventoryActiveParts.map((part) => <option key={part.id} value={part.id}>{part.name} · {part.sku}</option>)}</select>
                    </label>
                    <label>Tipo<select name="kind"><option value="IN">Entrada</option><option value="OUT">Salida</option></select></label>
                    <label>Cantidad<input name="quantity" type="number" min="1" defaultValue="1" required /></label>
                    <button className="primary" type="submit" disabled={busy}>Registrar</button>
                  </form>
                </article>
              </div>
            )}

            {selectedPart && (
              <aside className="inventory-drawer" aria-label={`Detalle de ${selectedPart.name}`}>
                <div className="detail-heading"><div><p className="eyebrow">Detalle del producto</p><h2>{selectedPart.name}</h2></div><button className="overlay-close-inline" type="button" onClick={() => setSelectedPart(null)}>×</button></div>
                <p className="drawer-sku">{selectedPart.sku}</p>
                <div className="drawer-stock"><span>Existencias actuales</span><strong>{selectedPart.stock}</strong></div>
                <dl className="drawer-details">
                  <dt>Categoría</dt><dd>{selectedPart.category ?? "Sin categoría"}</dd>
                  <dt>Ubicación</dt><dd>{selectedPart.location ?? "Sin ubicación"}</dd>
                  <dt>Stock mínimo</dt><dd>{selectedPart.minimum_stock}</dd>
                  <dt>Costo</dt><dd>{formatMoney(selectedPart.cost_minor)}</dd>
                  <dt>Precio</dt><dd>{formatMoney(selectedPart.sale_price_minor)}</dd>
                  <dt>Estado</dt><dd>{selectedPart.status}</dd>
                  <dt>Último movimiento</dt><dd>{movements[0] ? new Date(movements[0].created_at).toLocaleString("es-AR") : "Sin movimientos"}</dd>
                </dl>
                <div className="drawer-actions">
                  <button className="secondary" type="button" onClick={() => void editPart(selectedPart)}>Editar producto</button>
                  <button className="secondary" type="button" onClick={() => void quickStock(selectedPart, "IN")} disabled={selectedPart.status !== "ACTIVO"}>Entrada +1</button>
                  <button className="secondary" type="button" onClick={() => void quickStock(selectedPart, "OUT")} disabled={selectedPart.stock === 0 || selectedPart.status !== "ACTIVO"}>Salida −1</button>
                  <button className="primary" type="button" onClick={() => void adjustToFinal(selectedPart)} disabled={selectedPart.status !== "ACTIVO"}>Ajustar existencias</button>
                  {selectedPart.status === "ARCHIVADO"
                    ? <button className="secondary" type="button" onClick={() => void changePartStatus(selectedPart, "ACTIVO")}>Reactivar</button>
                    : <button className="danger" type="button" onClick={() => void changePartStatus(selectedPart, "ARCHIVADO")}>Archivar producto</button>}
                </div>
                <div className="drawer-history">
                  <h3>Movimientos</h3>
                  {movements.slice(0, 10).map((movement) => (
                    <div className="movement-row" key={movement.id}>
                      <span>{movement.kind.replaceAll("_", " ")}</span>
                      <strong>{movement.quantity}</strong>
                      <small>{movement.stock_before ?? "—"} → {movement.stock_after ?? "—"} · {new Date(movement.created_at).toLocaleString("es-AR")}</small>
                    </div>
                  ))}
                  {!movements.length && <p className="empty">Sin movimientos registrados.</p>}
                </div>
              </aside>
            )}

            {showHistory && (
              <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="history-title">
                <article className="modal-card history-modal">
                  <div className="detail-heading"><h2 id="history-title">Historial de movimientos</h2><button className="overlay-close-inline" type="button" onClick={() => setShowHistory(false)}>×</button></div>
                  <div className="history-filter">
                    <label>Tipo
                      <select value={historyKind} onChange={(event) => setHistoryKind(event.target.value)}>
                        <option value="TODOS">Todos</option>
                        <option value="IN">Entradas</option>
                        <option value="OUT">Salidas</option>
                        <option value="ADJUSTMENT_IN">Ajustes de entrada</option>
                        <option value="ADJUSTMENT_OUT">Ajustes de salida</option>
                        <option value="RETURN">Devoluciones</option>
                      </select>
                    </label>
                    <button className="secondary" type="button" onClick={() => void loadInventoryHistory()}>Aplicar</button>
                  </div>
                  <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Anterior</th><th>Posterior</th><th>Motivo</th><th>Orden</th><th>Acción</th></tr></thead><tbody>
                    {movements.map((movement) => <tr key={movement.id}><td>{new Date(movement.created_at).toLocaleString("es-AR")}</td><td>{movement.part_name ?? "Producto"}<br /><small>{movement.sku ?? ""}</small></td><td>{movement.kind.replaceAll("_", " ")}</td><td>{movement.quantity}</td><td>{movement.stock_before ?? "—"}</td><td>{movement.stock_after ?? "—"}</td><td>{movement.reason}</td><td>{movement.order_id ?? "—"}</td><td>{movement.reference?.startsWith("reverse:") ? <span className="empty">Reversión</span> : <button className="secondary" type="button" onClick={() => void reverseMovement(movement)}>Revertir</button>}</td></tr>)}
                  </tbody></table></div>
                </article>
              </div>
            )}
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

        {tab === "asistencia" && (
          <section className="content">
            {!authUser || !["admin", "reception", "technical_lead"].includes(authUser.role) ? (
              <article className="panel-card"><h2>Asistencia / Conversaciones</h2><p className="empty">Se requiere una sesión aprobada del personal.</p><button className="primary" type="button" onClick={() => setShowLoginOverlay(true)}>Acceso administrativo</button></article>
            ) : (
              <>
              <article className="panel-card">
                <h2>Solicitudes de atención</h2>
                <div className="table-wrap"><table><thead><tr><th>Referencia</th><th>Tipo</th><th>Cliente</th><th>Problema / motivo</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead><tbody>
                  {assistantRequests.map((request) => (
                    <tr key={request.id}>
                      <td><strong>{request.reference}</strong></td>
                      <td>{request.request_type === "REPAIR" ? "Reparación" : "Contacto"}</td>
                      <td>{request.name}<br /><small>{request.phone}</small></td>
                      <td>{request.problem}</td>
                      <td><span className="badge">{request.status}</span></td>
                      <td>{new Date(request.created_at).toLocaleString("es-AR")}</td>
                      <td><div className="row-actions">
                        <select aria-label={`Estado de ${request.reference}`} value={request.status} onChange={(event) => updateAssistantRequestStatus(request.id, event.target.value)}>
                          {["NUEVA", "EN REVISION", "ESPERANDO CLIENTE", "DERIVADA", "RESUELTA", "CERRADA"].map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
                        {request.request_type === "REPAIR" && !request.order_id && <button className="secondary" type="button" onClick={() => convertAssistantRequest(request.id)}>Convertir en orden</button>}
                        {request.order_id && <small>Orden: {request.order_id}</small>}
                      </div></td>
                    </tr>
                  ))}
                </tbody></table></div>
                {!assistantRequests.length && <p className="empty">Todavía no hay solicitudes de asistencia.</p>}
              </article>
              <article className="panel-card admin-users">
                <h2>Base de conocimiento</h2>
                <form className="form form-grid" onSubmit={addKnowledge}>
                  <label>Categoría<select value={knowledgeCategory} onChange={(event) => setKnowledgeCategory(event.target.value)}>
                    <option>Reparación de celulares</option><option>Reparación de electrodomésticos</option><option>Microsoldadura</option><option>Diagnóstico</option><option>Presupuestos</option><option>Garantías</option><option>Tiempos</option><option>Horarios</option><option>Ubicación y contacto</option>
                  </select></label>
                  <label>Pregunta<input value={knowledgeQuestion} onChange={(event) => setKnowledgeQuestion(event.target.value)} maxLength={500} required /></label>
                  <label>Respuesta<textarea value={knowledgeAnswer} onChange={(event) => setKnowledgeAnswer(event.target.value)} maxLength={2000} required /></label>
                  <button className="primary" type="submit" disabled={busy}>Agregar conocimiento</button>
                </form>
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
