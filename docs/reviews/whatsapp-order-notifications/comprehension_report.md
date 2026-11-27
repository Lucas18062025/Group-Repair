# Stage 6 — Comprehension Test

Target: `C:\Users\HP Ryzen 5\Proyectos\Git-Hub\Group-Repair\docs\designs\whatsapp-order-notifications.md`
Reviewer: `egm-comprehension`
Scope: FeatureRange lines 1–283, DetailedRange lines 284–419
GoldfishContext: empty

## What this proposes

El documento propone añadir notificaciones WhatsApp operativas en dos momentos del ciclo de vida de una orden de reparación: la creación de la orden y el paso a `READY_FOR_DELIVERY`. Cada mensaje incluiría el nombre del taller, la referencia `GR-00001`, el equipo, el estado en lenguaje claro y un enlace de seguimiento con un token aleatorio. El diseño incorpora consentimiento por orden, un outbox en D1 con deduplicación por clave única, reintentos con backoff, verificación de firmas de webhook, una página pública de seguimiento y un panel del staff con reintento manual y visibilidad de fallos. También define una capa de adaptador de proveedor (modos deshabilitado/sandbox, sin proveedor de producción en esta fase), migración, nuevos módulos y pruebas, cambios de UI y actualizaciones de `SPEC.md`, `README.md`, privacidad y términos.

## How the existing system works, per this document

Según el documento, la aplicación actual ya almacena teléfonos de clientes y estados de órdenes, genera referencias `GR-00001` en `src/worker.ts`, dispone de un "public assistant" con el endpoint `/api/assistant/orders/track`, un log de auditoría interno y un historial de estados de orden, y opera sobre D1/Cloudflare Worker con roles como reception, technician, cashier, viewer, technical lead y admin. Hoy no existe integración con WhatsApp, log de notificaciones, flag de consentimiento a nivel de orden ni página pública de seguimiento con token verificado; por eso el diseño propone construir primero el outbox y el límite del adaptador. El documento apoya las convenciones del proyecto en `SPEC.md` y `AGENTS.md`: autorización deny-by-default, fechas UTC, sin secretos en el repositorio y sin suponer servicios como Google Drive o Sheets.

## Findings

### 1 — Major

**Affected Scope**: The Problem, line 21; Additional Resources, line 275 — term "public assistant".

**Discrepancy Description & Rationale**: "The public assistant" is a project-specific term that is never defined. The document does not say whether it is a chatbot, a web page, an API, or who uses it. A new reader cannot understand the problem being reduced or which existing system is affected. The endpoint `/api/assistant/orders/track` locates code but does not define the concept or link to documentation.

### 2 — Major

**Affected Scope**: Technical Plan / Author decisions, line 100 — "the data-processing decision".

**Discrepancy Description & Rationale**: The text names this as a prerequisite for choosing a provider but never explains what the decision is, who makes it, or what criteria resolve it. It also contradicts "Open Questions: None" at line 61. An assumed workflow prerequisite is left vague.

### 3 — Major

**Affected Scope**: CUJ 4, line 87; Delivery and retries, line 212; `notifications.test.ts`, line 301.

**Discrepancy Description & Rationale**: Three statements describe retry policy differently: "retried up to five times", "up to five total attempts", and "five-attempt backoff policy". A reader cannot tell whether the system sends six total messages or five. This is an ambiguity in a core reliability behavior.

### 4 — Major

**Affected Scope**: Provider paths considered / Option C, lines 151–157; Alternatives Considered / Alternative C, lines 253–257.

**Discrepancy Description & Rationale**: Two different items are both labelled "C". "Option C: Outbox now, adapter implementation later" is the author decision. "Alternative C: Send WhatsApp directly from the status-change request" is rejected. A new reader cannot map "Author decision: Option C" to the alternatives section.

### 5 — Major

**Affected Scope**: Data model changes, lines 162–163 — "recipient hash".

**Discrepancy Description & Rationale**: The field is in the model and unique key, but the document never defines which hash it is. Line 220 separately says to store the phone as a hash plus last digits. A critical privacy and deduplication field is left implicit.

### 6 — Major

**Affected Scope**: Privacy and security, line 226 — "delivered, cancelled, replaced".

**Discrepancy Description & Rationale**: Token revocation depends on order states that are never presented as valid system states. The document introduces creation and `READY_FOR_DELIVERY`; cancellation appears only as an excluded notification. The existing state machine is an unstated prerequisite.

### 7 — Major

**Affected Scope**: Target Files / `src/worker.ts`, line 216 — "order is explicitly marked as test".

**Discrepancy Description & Rationale**: The rule assumes a test-order flag and a provider sandbox account exist. Neither mechanism is described. It also conflicts with the decision not to implement a production provider in this phase.

### 8 — Nit

**Affected Scope**: CUJ 1, line 67 — "and the service is configured".

**Discrepancy Description & Rationale**: "The service" is not identified. It could mean the adapter, worker, provider, or deployment configuration.

### 9 — Nit

**Affected Scope**: Target Files / `src/App.tsx`, line 357 — "phone confirmation".

**Discrepancy Description & Rationale**: The UI concept is undefined. It could mean retyping the number, a verification code, or visual confirmation.

### 10 — Nit

**Affected Scope**: Author decisions, line 103; Data model changes, line 161; CUJ 1, line 69 — consent actor.

**Discrepancy Description & Rationale**: The document says consent is captured per order with actor and UTC date but does not say whether the actor is the customer or the staff member who registers it.

### 11 — Nit

**Affected Scope**: Data model changes, line 162; worker plan, line 344 — "minimal before/after fields".

**Discrepancy Description & Rationale**: The document requires minimal before/after audit fields without specifying their contents or what "minimal" means.

### 12 — Nit

**Affected Scope**: Target Files / `worker-configuration.d.ts`, line 375; Verification Plan, line 411; CI, line 405.

**Discrepancy Description & Rationale**: The document assumes `npm run cf:types`, `npm run cf:migrate`, and dry-run CI steps exist without verifying or linking `package.json`. It admits no lint script exists, which shows uncertainty about scripts while asserting others.

### 13 — Nit

**Affected Scope**: Target Files / `src/worker.ts`, line 340 — "reserves them without duplicate sends".

**Discrepancy Description & Rationale**: The reservation mechanism is not explained or linked. The document mentions the unique key and provider idempotency but does not explain how duplicate sends are prevented between scheduled executions.

### 14 — Nit

**Affected Scope**: Provider paths considered / Option B, line 147 — "a regional BSP".

**Discrepancy Description & Rationale**: "BSP" is an industry-specific acronym and is not defined or linked. Even in a rejected option, a new reader cannot know what kind of entity is being compared with Twilio.

### 15 — Nit

**Affected Scope**: Overview, line 13; Message content, line 190 — "the example supplied by the author".

**Discrepancy Description & Rationale**: The document requires rewriting the author's original example with `GR-00001` and the new token, but the original `ODR-...` example is not shown. A new message shape is included, but the source example is absent.

### 16 — Nit

**Affected Scope**: Message content, line 182 — "when available and consented".

**Discrepancy Description & Rationale**: "Consented" does not specify whether using the customer's first name needs the general WhatsApp consent or a separate consent. The rest of the document defines only one consent flag.
