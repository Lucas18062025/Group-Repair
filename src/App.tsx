import { useEffect, useState, type FormEvent } from "react";

type Tab = "panel" | "clientes" | "equipos" | "ordenes" | "inventario";

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
  brand: string;
  model: string;
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
  const [tab, setTab] = useState<Tab>("panel");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
    void refresh();
  }, []);

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
      event.currentTarget.reset();
      setMessage("Cliente registrado");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error al guardar");
      setBusy(false);
    }
  }

  async function submitPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
          minimumStock: Number(form.get("minimum"))
        })
      });
      event.currentTarget.reset();
      setMessage("Repuesto registrado");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error al guardar");
      setBusy(false);
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
          estimatedCompletionAt: form.get("estimated")
        })
      });
      event.currentTarget.reset();
      setMessage(`Orden ${created.reference} creada`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error al crear la orden");
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">GR</span>
          <div><strong>Group Repair</strong><small>Taller técnico</small></div>
        </div>
        <nav aria-label="Navegación principal">
          {([
            ["panel", "Panel"],
            ["clientes", "Clientes"],
            ["equipos", "Equipos"],
            ["ordenes", "Órdenes"],
            ["inventario", "Inventario"]
          ] as Array<[Tab, string]>).map(([key, label]) => (
            <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>
          ))}
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">Gestión operativa</p><h1>{tab === "panel" ? "Panel general" : tab[0].toUpperCase() + tab.slice(1)}</h1></div>
          {busy && <span className="loading">Actualizando</span>}
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
                  <label>Prioridad<select name="priority"><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label>
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
              <div className="table-wrap"><table><thead><tr><th>Referencia</th><th>Cliente</th><th>Equipo</th><th>Estado</th><th>Problema</th></tr></thead><tbody>
                {orders.map(order => <tr key={order.id}><td><strong>{order.reference}</strong></td><td>{order.customer_name}</td><td>{order.brand} {order.model}</td><td><span className="badge">{statusLabel(order.status)}</span></td><td>{order.reported_issue}</td></tr>)}
              </tbody></table></div>
              {!orders.length && <p className="empty">Todavía no hay órdenes.</p>}
            </article>
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
                <label>Stock mínimo<input name="minimum" type="number" min="0" defaultValue="0" required /></label>
                <button className="primary" type="submit" disabled={busy}>Guardar repuesto</button>
              </form>
            </article>
            <article className="panel-card">
              <h2>Existencias</h2>
              <div className="table-wrap"><table><thead><tr><th>SKU</th><th>Repuesto</th><th>Stock</th><th>Precio</th></tr></thead><tbody>
                {parts.map(part => <tr key={part.id}><td>{part.sku}</td><td>{part.name}</td><td>{part.stock}</td><td>{formatMoney(part.sale_price_minor)}</td></tr>)}
              </tbody></table></div>
            </article>
          </section>
        )}
      </main>
    </div>
  );
}
