# Group Repair

![Group Repair](./Group-Repair.jpg)

Group Repair es una aplicación web para gestionar las operaciones de un taller de reparación: clientes, equipos, órdenes, diagnósticos, presupuestos, pagos e inventario. Está pensada para mantener trazabilidad de las operaciones y centralizar la información del taller.

## Aplicación

- **Aplicación desplegada:** [group-repair.lucaslean1806.workers.dev](https://group-repair.lucaslean1806.workers.dev/)
- **Stack:** React, TypeScript, Vite, Cloudflare Workers y Cloudflare D1.
- **Persistencia:** Cloudflare D1, vinculada al Worker mediante `DB`.
- **Especificación del producto:** [`SPEC.md`](SPEC.md).
- **Privacidad:** [Política de privacidad](https://group-repair.lucaslean1806.workers.dev/privacy)
- **Términos:** [Términos de servicio](https://group-repair.lucaslean1806.workers.dev/terms)

La aplicación incluye un panel operativo y secciones para clientes, equipos, órdenes e inventario. El Worker expone operaciones de API para la gestión del taller, con validaciones de dominio, registro de eventos y persistencia en D1. La disponibilidad de servicios externos —por ejemplo, Google o Gemini— depende de la configuración de credenciales y APIs correspondientes.

## Acceso y autenticación

Las operaciones de negocio (clientes, equipos, órdenes, diagnósticos, presupuestos, pagos, inventario, adjuntos y dashboard) requieren una sesión aprobada. El servidor aplica **deny-by-default**: toda ruta `/api/*` exige autenticación, taller autorizado y rol salvo una allowlist mínima (`/api/health`, configuración/identidad pública de auth, login/logout y endpoints públicos con consentimiento/rate limiting del asistente). No se confía en `workshop_id`, `tenant_id`, rol, owner, actor, total ni estado enviados por el cliente; se derivan de la sesión y se validan contra persistencia.

Roles server-side: `viewer` (solo lectura), `reception`, `technician`, `technical_lead`, `cashier`, `admin`. La creación, edición, aprobación, cobro, administración y eliminación son permisos separados. `requireOrderAccess` verifica taller + rol + propiedad/asignación de la orden. `technical_lead` aprueba presupuestos/órdenes; `cashier` registra pagos/reembolsos; `admin` administra y elimina. Un presupuesto se crea `draft` y se aprueba explícitamente con `PATCH /api/orders/:orderId/quotes/:quoteId/approve` por `technical_lead`/`admin`.

Las funciones administrativas, la gestión de cuentas Google autorizadas y las credenciales OAuth permanecen protegidas por sesión aprobada. El asistente virtual público (consultas y solicitudes) sigue disponible sin login con consentimiento y límites.

Los secretos de Google, Gemini y Cloudflare no se exponen al frontend. Configure `GOOGLE_BOOTSTRAP_SUB` antes del primer despliegue para definir el administrador inicial.

## Órdenes e inventario

Las órdenes muestran detalle completo, relación con cliente/equipo, recepción, observaciones, accesorios, estado, técnico y presupuesto. Los registros vacíos pueden corregirse o eliminarse con protección; una orden con historial asociado no se elimina para preservar trazabilidad.

El stock se calcula exclusivamente desde movimientos de inventario. Al crear un repuesto puede registrarse el stock inicial como movimiento `IN`; las entradas y salidas posteriores se registran como movimientos trazables. Los repuestos existentes sin movimientos conservan el stock calculado disponible y no reciben cantidades inventadas automáticamente.

## Inventory 2.0

El módulo Inventario permite operaciones rápidas de una unidad, ajustes manuales con motivo, filtros, detalle lateral, archivo/reactivación e historial de movimientos. Los movimientos incluyen referencia única, stock anterior y posterior.

Las modificaciones de inventario requieren una sesión aprobada. El acceso público temporal conserva solamente consultas generales y no sustituye autorización para administrar productos o stock.

## Clientes y órdenes

Clientes y órdenes pueden administrarse mediante operaciones persistidas en D1. Las operaciones de creación, edición y eliminación requieren una sesión aprobada y validan propiedad de los registros; los registros históricos sin propietario quedan disponibles para administración por usuarios administradores sin reasignación automática.

La eliminación de un cliente con dependencias conserva integridad mediante una operación transaccional que identifica equipos y elimina sus órdenes y registros asociados solo después de confirmar el nombre del cliente.

## Asistente virtual de clientes

El asistente público combina clasificación determinista de intenciones, flujos guiados para solicitudes/seguimiento y Gemini opcional. Cuando Gemini está configurado, recupera entradas relevantes activas de `knowledge_base` mediante consultas convencionales de D1, limita y delimita ese contexto como referencia no ejecutable, y aplica un fallback determinista si el proveedor falla o no tiene información suficiente. Esto es grounding por recuperación de registros, no un índice vectorial ni RAG avanzado.

Antes de enviar contexto al proveedor se acotan las entradas, se limita el historial y se redactan teléfonos, emails y referencias públicas. La consulta de órdenes y el registro de solicitudes permanecen en endpoints backend separados, con validación, consentimiento, rate limiting y verificación de teléfono; Gemini no decide autorizaciones ni ejecuta SQL.

Las conversaciones y solicitudes se guardan en D1 con consentimiento, límites de longitud, rate limiting y referencias públicas aleatorias. El seguimiento de órdenes exige número de orden y teléfono coincidente. El personal autorizado revisa solicitudes desde `/?tab=asistencia` y puede convertirlas a órdenes reales sin crear confirmaciones automáticas.
## Despliegue (Cloudflare)

La aplicación está desplegada en Cloudflare Workers: [https://group-repair.lucaslean1806.workers.dev/](https://group-repair.lucaslean1806.workers.dev/).

Para publicar cambios, configurá los bindings y secretos necesarios en el entorno de Cloudflare, revisá y aplicá las migraciones pertinentes, y ejecutá las pruebas y verificaciones de build antes del despliegue. Mantené los secretos fuera del repositorio y separá los entornos según corresponda.

### Gemini

Gemini permanece deshabilitado hasta configurar su secreto independiente:

```bash
npx wrangler secret put GEMINI_API_KEY
```

Opcionalmente se puede configurar el modelo y el límite diario mediante variables públicas:

```json
"vars": {
  "GEMINI_MODEL": "gemini-2.5-flash",
  "GEMINI_DAILY_LIMIT": "20"
}
```

No ejecutes ni declares la integración como operativa hasta una prueba real con respuesta del proveedor.

## Configuración operativa

- Jurisdicción del taller: San Miguel de Tucumán, Tucumán, Argentina.
- Moneda: pesos argentinos (`ARS`).
- Horario informado: lunes a sábado, de 9:00 a 21:00; domingos cerrado.
- Consultas sobre garantías: `+54 9 381 524-9553`.

Las condiciones de garantía y cualquier requisito fiscal o legal deben confirmarse para el caso aplicable; la aplicación no sustituye asesoramiento profesional.

## Seguridad y privacidad

No cargues información real de clientes, credenciales, tokens ni evidencia privada en issues o commits. Gestioná las credenciales mediante secretos del entorno de despliegue y evitá almacenar datos de tarjetas de pago. Reportá vulnerabilidades de forma privada al propietario del repositorio.

## Licencia

Este proyecto está bajo la licencia [MIT](LICENSE).
