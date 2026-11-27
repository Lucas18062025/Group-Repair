# Consolidated Review Report — WhatsApp Order Notifications

Target: `C:\Users\HP Ryzen 5\Proyectos\Git-Hub\Group-Repair\docs\designs\whatsapp-order-notifications.md`
Pipeline: Consolidated full review, Stages 5–9
Stage reports: `zoom_out_report.md`, `comprehension_report.md`, `critic_report.md`, `intermediate_zoom_out_report.md`, `implementation_readiness_report.md`
Reviewers: egm-zoom-out, egm-inventive-catalyst, egm-comprehension, egm-design, egm-structural, egm-style, egm-implementation-readiness, egm-codebase-details

## Verdict

The design is **not ready for implementation**. Stage 8 concluded that the high-level architecture fails the Zoom Out Standard. Stage 9 found four implementation blockers. The main problem is not missing detail; it is that the design builds a delivery platform around a provider that has not been selected and a message that cannot yet be sent.

## Consolidated Action Items

### 🔴 B1 — Reduce scope before adding more components

**Action**: Choose a smaller architecture before completing the detailed plan. Extend the existing public tracking flow and add one durable notification record with one send path once a provider exists. Defer token tables, inbound webhook, retry lease machinery, delivery metrics, and speculative multi-tenancy until a real message has been sent and a measured problem exists.

**Why**: Stage 8 found that all later mitigations added components around the same over-built core. The current design creates three tables, a scheduled sender, a webhook, retry state, token subsystem, staff UI, and tests, while sending zero messages.

### 🔴 B2 — Define the database schema exactly

**Action**: Replace the migration description with full DDL or a column-by-column table definition. Include exact column names, types, nullability, defaults, foreign keys, checks, consent fields, the unique constraint, and index names.

**Why**: Implementation Readiness R1. The implementer currently has to design the schema.

### 🔴 B3 — Define retry and scheduling numerically

**Action**: Set one retry budget, for example five total attempts with four retries, and an explicit delay sequence or formula. Define cron trigger, batch size, lease duration, visibility timeout, and expired-lease requeue.

**Why**: Stage 6 finding 3, Inventive I4, Design D2/D5, Zoom Out Z5, Readiness R2/R9, Codebase C8. Three different retry meanings exist, and duplicate-send prevention has no claim protocol.

### 🔴 B4 — Define the webhook contract or defer it

**Action**: Either specify the provider-independent signature header, algorithm, secret name, raw-body rule, timestamp freshness, replay rejection, and event schema, or move the webhook to a later phase with a documented stub.

**Why**: Readiness R3, Design D11, Codebase C11. No provider is selected, but signature verification is required now. Non-read methods also pass the existing global CSRF check.

### 🔴 B5 — Resolve opt-out before implementation

**Action**: Choose one path: remove `BAJA`, opt-out parsing, and the opt-out metric; or add inbound-message handling, consent revocation, audit event, and cancellation of pending rows. Update the template and privacy text to match the chosen path.

**Why**: Design D3, Inventive I1, Zoom Out Z4/I5, Comprehension findings, Readiness R4, Style Stage 7. The document promises a reply path it explicitly excludes.

### 🟡 M1 — Consolidate alternatives and mark the decision clearly

**Action**: Keep one alternatives section with one label scheme. Rename the two conflicting "C" options. State the selected option directly in that section. Replace "Rejected by author" with concrete technical reasons.

**Why**: Design D1, Structural S2, Style Y5, Comprehension finding 4, Inventive I5, Style Stage 9 Y10.

### 🟡 M2 — Add a canonical Risks & Limits section

**Action**: Add one section listing failure modes, security implications, scalability limits, provider quota assumptions, message cost, retention, and mitigations. Include the fact that the app currently has one hardcoded workshop.

**Why**: Structural S1, Design D12, Zoom Out S8 F3, Comprehension finding 2. Risks are scattered and scalability is absent.

### 🟡 M3 — Replace "Open Questions: None"

**Action**: List deferred decisions with owner and gate: provider, approved template, consent wording, data-processing approval, token TTL, backoff values, rate limits, meaning of delivered, and rollout gate. Mark status as blocked where appropriate.

**Why**: Comprehension finding 2, Design D4, Inventive I5, Style Y1/Y2, Zoom Out Stage 8 F8.

### 🟡 M4 — Reuse existing helpers and tracking flow

**Action**: Name the helpers to reuse: `statusLabel`, `ORDER_STATUSES`, `normalizePhone`, `isValidPhone`, `phonesMatch`, `validatedPhone`, `randomToken`, `sha256`, `createPublicReference`, `consumeRateLimit`, `clientSubject`, and the existing audit closure. Decide whether to extend `/api/assistant/orders/track` instead of creating a parallel token flow.

**Why**: Zoom Out Z1/Z2/Z6, Design D7/D10, Codebase C10, Comprehension findings, Style Stage 9 Y1.

### 🟡 M5 — Define exact API contracts

**Action**: Define methods, paths, request bodies, response fields, status codes, roles, and generic not-found behavior for:
* `GET /api/tracking/:token`
* staff list endpoint
* staff retry endpoint
* `POST /api/webhooks/whatsapp`

Use `technical_lead`, not `technical lead`. Add a regex pattern to `isPublicApiRoute` for dynamic tracking tokens. Define viewer access as a closed rule.

**Why**: Readiness R6, Codebase C1/C2/C3/C9, Style Y2, Comprehension findings 4 and 13.

### 🟡 M6 — Define tracking token details

**Action**: Set token length and charset, keyed hash scheme, TTL, one-token-per-order or per-notification rule, revocation conditions, public URL construction, rate limits, and SPA route. Keep one source of truth for the token hash. Define "delivered" as the order pickup event, not the webhook delivery event.

**Why**: Design D10, Readiness R7, Zoom Out Z5, Comprehension finding 6.

### 🟡 M7 — Define adapter configuration and permanent errors

**Action**: List exact variable names, allowed mode values, default, invalid-mode behavior, and template-approval owner. Separate permanent template/configuration errors from transient provider errors; permanent errors fail fast and alert staff, without five identical retries.

**Why**: Readiness R8, Design D14, Zoom Out Z3, Comprehension finding 7.

### 🟡 M8 — Define consent and order-creation coverage

**Action**: Add exact consent fields, flag semantics, UTC source, actor source, and revalidation rule at `READY_FOR_DELIVERY`. Cover both `POST /api/orders` and `POST /api/admin/assistant/requests/:id/convert`. Cover both UI order forms. State that `customers.phone` is the source for contact details and define phone confirmation exactly.

**Why**: Codebase C4/C5, Readiness R14, Comprehension findings 9 and 10.

### 🟡 M9 — Add append-only attempt history

**Action**: Keep the outbox row as current state and add immutable attempt records with request id, UTC time, actor, template key, provider message id, and error code. Add a test that prior attempts survive retry.

**Why**: Inventive I2, Design D15, Stage 7 Style, AGENTS.md history rule.

### 🟡 M10 — Fix privacy definitions

**Action**: Define recipient hash as keyed HMAC-SHA256 with a Worker secret and fixed last-four-digit masking. State that the hash is a correlation key, not anonymisation. List exact fields shown on the tracking page or state that none are personal.

**Why**: Design D9, Comprehension finding 5, Style Stage 9 Y4.

### 🟡 M11 — Add migration rollback and backfill

**Action**: Add down SQL or an explicit forward-only declaration with rollback steps. Default existing orders to no consent. Add audited `consent.captured` and any revocation event.

**Why**: Readiness R16, Design D13.

### 🟡 M12 — Make tests executable and specific

**Action**: Add the fake D1 helper file to the file list. Specify test infrastructure, given/when/then cases, exact assertions, tenant isolation, tracking rate limit, token expiry and revocation, and a log-redaction assertion. Clarify how `cf:migrate` local testing differs from vitest.

**Why**: Codebase C7, Readiness R17, Stage 6 and Stage 8 findings.

### 🟢 N1 — Documentation cleanup

**Action**: Remove repeated Non-Goals, duplicated NFR text, "supplied by the author" attribution, "*Drafted with EGM*", and unmapped quality adjectives. Define Worker, D1, and BSP on first use. Use one term for `READY_FOR_DELIVERY`.

**Why**: Style Stage 7 and Stage 9 findings, Structural S3/S4/S5.

## Traceability Matrix

| Raw findings | Consolidated action |
|---|---|
| Z1, Z2, Z6, S8 F2, D7, D10, C10, Comprehension 4/6 | M4 |
| Z3, Z5, S8 F1, I2/I3, D2/D5, R2/R9, C8 | B1, B3 |
| Z4, I1, D3, R4, Comprehension findings on opt-out | B5 |
| Z7/Z8, S8 F7, D12 | M2 |
| Z3, S8 F8, I5, D4, Comprehension 2, Y1/Y2 | M3 |
| I2, D15 | M9 |
| I3, D2, R9, C8 | B3 |
| I4, Comprehension 3, R2 | B3 |
| I5, D4, Y1/Y2, S8 F8 | M3 |
| S1, D12, S8 F3 | M2 |
| S2, D1, D16, Comprehension 4, Y5 | M1 |
| S3/S4/S5, Y3/Y6/Y7/Y8/Y9/Y10, N1 | N1 |
| Comprehension 1 | M4 |
| Comprehension 5, D9 | M10 |
| Comprehension 7, D14, R8 | M7 |
| Comprehension 8/9, C5, R14, C4 | M8 |
| Comprehension 11, R16, D13 | M11 |
| Comprehension 12, C7, R17 | M12 |
| Comprehension 13, R6, C3 | M5/B3 |
| Comprehension 14 | N1 |
| Comprehension 15 | M1 |
| Comprehension 16, M8 | M8 |
| D1, R1 | B2 |
| D4, D6, S8 F3 | M2/M3 |
| D5, R5 | B1/B3 |
| D6, S8 F3 | M2 |
| D8 | M8/M9 |
| D10, R7 | M6 |
| D11, R3, C11 | B4 |
| D12, R16 | M2/M11 |
| D13, R16 | M11 |
| D14, R8, M7 | M7 |
| D15, R8 | M7 |
| R6, C1/C2/C3/C9 | M5 |
| R10, C10 | M4/M8 |
| R11, C10, Y1 | M4/N1 |
| R12, Comprehension 2 | M7 |
| R13, M9 | M9 |
| R15 | B4/B3 |
| R18 | M12 |
| C6 | M5/M6 |
| C12 | M8 |
| Stage 9 Y3/Y4/Y5/Y6 | M7/M10/N1 |

## Stage Outcome

Do not implement from this document yet. Resolve B1–B5 and the Major actions, then run Stage 5 and Stage 9 again on the revised document.
