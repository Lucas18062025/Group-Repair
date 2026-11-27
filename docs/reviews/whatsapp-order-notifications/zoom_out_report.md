# Stage 5 — Initial Zoom Out Review

Target: `C:\Users\HP Ryzen 5\Proyectos\Git-Hub\Group-Repair\docs\designs\whatsapp-order-notifications.md`
Reviewers: `egm-zoom-out`, `egm-inventive-catalyst`
Scope: full file, lines 1–419
GoldfishContext: empty

## egm-zoom-out findings

### Finding Z1 — Major

**Affected Scope**: The Problem / CUJ 5 (L89–93), author decision (L104), Data model changes (L165), worker plan (L342), UI plan (L359).

**Simplicity Rationale**: The repository already has `POST /api/assistant/orders/track` in `src/worker.ts:1982-2041`. It returns the order reference, equipment, Spanish status, next step, uses phone matching, and uses rate limiting. The design creates a second public tracking path, a token table, a new endpoint, a new page, and another status-label map without explaining why the existing flow cannot be extended with an optional token. This duplicates the public data flow and increases attack surface.

### Finding Z2 — Major

**Affected Scope**: Trigger rules (L173), proposed `notifications.ts` (L293–296), proposed `tracking-links.ts` (L313–321), Verification approach (L231).

**Simplicity Rationale**: Three proposed utilities already exist:
- Spanish status labels in `src/worker.ts:109-126` and `src/App.tsx:190-207`, with order states in `src/domain/status.ts:1-37`. A third copy would create divergent customer-facing text.
- Phone normalization and validation in `src/domain/assistant.ts:3-10` and `validatedPhone()` in `src/worker.ts:165-169`. A new implementation could break the existing last-10-digit matching rule.
- Token generation and hashing in `src/auth.ts:54-57,162-164`, and public-key format validation in `src/domain/customer-assistant.ts:40,78-80`.

Centralize status labels in `src/domain/status.ts` and reuse the existing token, hash, and phone helpers.

### Finding Z3 — Major

**Affected Scope**: Author decisions (L99–100), Provider paths / Option C (L151–157), proposed `whatsapp-adapter.ts` (L303–311).

**Simplicity Rationale**: The selected option creates three tables, three domain modules, a scheduled sender, a webhook, a retry state machine, and UI, but sends no real message. There is no provider, credential, or approved template. A factory with disabled and sandbox adapters is speculative when no production adapter exists. Use one interface and one no-op adapter, and defer the rest until a provider and template are approved.

### Finding Z4 — Major

**Affected Scope**: Message content (L188, L206), Non-Goals (L49), proposed `notifications.ts` opt-out parsing (L296), Delivery and retries (L209–216).

**Simplicity Rationale**: The template tells the customer to reply `BAJA`, but the design excludes a two-way bot. The only webhook is delivery-status-only. `notification_delivery_events` does not store inbound message content. Opt-out parsing has no caller and the opt-out instruction is an incomplete loop. Either define inbound opt-out handling or remove the instruction and parser.

### Finding Z5 — Major

**Affected Scope**: CUJ 4 (L83–87), Data model changes (L164), Delivery and retries (L209–216).

**Simplicity Rationale**: A five-attempt backoff system, a delivery-event table with signature verification, event deduplication, and read/delivered metrics are a full delivery reporting subsystem before one real message has been sent. With two notifications per order, one attempt, visible failure, manual retry, and provider idempotency cover the user journeys without this machinery.

### Finding Z6 — Nit

**Affected Scope**: Privacy and security (L225), worker plan (L342).

**Simplicity Rationale**: The document says to rate limit tracking-link access and webhook ingestion without naming the existing `consumeRateLimit()` helper in `src/worker.ts:188-223`, `clientSubject()` in `src/worker.ts:181-186`, and `chat_rate_limits` table. Reuse the existing mechanism.

### Finding Z7 — Nit

**Affected Scope**: Detailed Implementation Plan (L284–405), especially L293–296 and L333–346.

**Simplicity Rationale**: The plan drops to helper-level detail such as deduplication key construction, opt-out parsing, and token format validation. The Zoom Out standard asks high-level sections to focus on components, interfaces, and data flow.

### Finding Z8 — Nit

**Affected Scope**: Verification approach (L236) vs Future Improvements (L281).

**Simplicity Rationale**: The verification section collects delivery metrics including read and opted-out states while delivery analytics is listed as a future improvement. Collecting these dimensions now has no defined consumer. Keep verification to no duplicates, no message without consent, and no order rollback when delivery fails.

## egm-inventive-catalyst findings

### Finding I1 — Major

**Affected Scope**: Message content (L188, L206), Non-Goals (L49), Open Questions (L61), Target Files #4/#10/#19 (L303, L333–346, L392–395), Future Improvements (L279).

**False Compromise**: The design promises opt-out by reply `BAJA`, includes opt-out parsing and an opted-out metric, and says the privacy page will explain opt-out. It also excludes two-way WhatsApp support and defines only a delivery-status webhook. There is no inbound-message path, no inbound signature verification, and no `opted_out` field. A compliance-facing promise has no implementation path.

**Proposed Resolution**: Choose one path: remove `BAJA`, opt-out parsing, and the opted-out metric, and document staff-mediated revocation; or add an inbound-message webhook that verifies signature, deduplicates, parses `BAJA`, sets `opted_out_at` on the order, and cancels pending outbox rows.

**Secondary Liabilities**: The inbound path adds a second provider event surface, deduplication, rate limiting, new order rules, and a residual race where a message already reserved before revocation is still sent.

### Finding I2 — Major

**Affected Scope**: Goals (L40), Data model changes (L162–164), Delivery and retries (L215), worker plan (L344).

**False Compromise**: The goal requires request id, actor, UTC time, and history for every attempt. The model has one outbox row with an aggregate attempts counter, one current error, and one request id. `notification_delivery_events` is webhook-only. Attempt history is overwritten, which conflicts with `AGENTS.md` rule 12.

**Proposed Resolution**: Add append-only `notification_attempts` rows keyed by outbox row and attempt number. Keep the outbox row as current state. Add a test that prior attempts remain unchanged after retry.

**Secondary Liabilities**: One more table, one more D1 write, retention rules, and reconciliation between projection and log.

### Finding I3 — Major

**Affected Scope**: worker plan scheduled handler (L340), Delivery and retries (L211–216), NFR Reliability/Operations (L264, L267).

**False Compromise**: "Reserves them without duplicate sends" is stated without a lease, `locked_until`, or reclaim mechanism. A worker crash between reservation and adapter call leaves the row stuck in flight with no next attempt and no staff visibility.

**Proposed Resolution**: Use a bounded lease and a reconciliation sweep that returns expired leases to pending or marks them failed after the retry budget. Keep the provider idempotency key for at-least-once safety.

**Secondary Liabilities**: A new state transition, a lease-duration setting, and possible duplicate sends if the provider ignores the idempotency key.

### Finding I4 — Nit

**Affected Scope**: CUJ 4 (L87), Author decisions (L105), Delivery and retries (L212), Test scope (L301).

**False Compromise**: "Retried up to five times" can mean five retries after the first send, while "five total attempts" can mean four retries. The retry budget is numeric but inconsistent.

**Proposed Resolution**: Define one constant, for example `MAX_ATTEMPTS = 5` total sends, and align all prose and tests.

**Secondary Liabilities**: Documentation and test consistency only.

### Finding I5 — Nit

**Affected Scope**: Open Questions (L61) vs Author decisions (L100), Rollout (L268), Verification Plan (L414–415).

**False Compromise**: The document says all decisions are resolved, while it also defers provider selection, credentials, templates, data-processing decision, and consent wording. Activation depends on unresolved external decisions.

**Proposed Resolution**: Replace "None" with a Deferred / Blocking Decisions list with owners and gates. Qualify status as blocked on provider, template, and consent approval.

**Secondary Liabilities**: Documentation only.
