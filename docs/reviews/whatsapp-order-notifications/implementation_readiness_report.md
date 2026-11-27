# Stage 9 — Implementation Readiness Test

Target: `C:\Users\HP Ryzen 5\Proyectos\Git-Hub\Group-Repair\docs\designs\whatsapp-order-notifications.md`
Reviewers: `egm-implementation-readiness`, `egm-codebase-details`, `egm-style`
Scope: DetailedRange lines 284–419
GoldfishContext: empty

## egm-implementation-readiness findings

### Blocker R1 — Missing DDL

**Affected Scope**: lines 288–291, migration `0012_whatsapp_notifications.sql`.

**Finding & Guidance**: The migration step names concepts but not columns, types, nullability, defaults, constraints, foreign keys, consent fields, unique definition, or index definitions. An implementer must design the schema. Provide full SQL or a column table per table, plus exact `ALTER TABLE` and `CREATE INDEX IF NOT EXISTS` statements.

### Blocker R2 — Retry policy is not numeric

**Affected Scope**: lines 293–296, 298–301, 340.

**Finding & Guidance**: "Increasing delay," "exponential backoff," and "five total attempts" do not define base delay, multiplier, cap, jitter, or cron cadence. Provide an explicit sequence such as `[1m, 5m, 25m, 2h, 6h]` or a formula and cron schedule, then assert those values in tests.

### Blocker R3 — Webhook signature contract missing

**Affected Scope**: lines 326–327, 341.

**Finding & Guidance**: The chosen path says no provider is selected, but the plan requires signature verification without header name, algorithm, secret name, or event shape. Define an agnostic contract such as `X-GroupRepair-Signature: sha256=<HMAC-SHA256 of raw body with WHATSAPP_WEBHOOK_SECRET>` and event schema, or move the webhook to a later phase with a documented stub.

### Blocker R4 — Opt-out has no implementation path

**Affected Scope**: line 306, privacy page line 395.

**Finding & Guidance**: The template promises reply `BAJA`, and privacy must explain opt-out, but there is no inbound channel, event type, consent update, or audit event. Add the opt-out route/event and its effect, or remove the instruction from the template and legal text.

### Major R5 — No phases or checkpoints

**Affected Scope**: lines 284–419.

**Finding & Guidance**: A flat list of 21 files mixes migration, domain, transaction, worker, sender, webhook, UI, and docs. Define incremental phases with buildable exit criteria.

### Major R6 — Staff and tracking API contracts incomplete

**Affected Scope**: lines 340–343.

**Finding & Guidance**: Staff endpoints for list and retry have no paths, methods, parameters, request/response shapes, or codes. `GET /api/tracking/:token` does not say JSON or HTML or which fields it exposes. `isPublicApiRoute` needs a regex pattern, not a literal `:token` entry.

### Major R7 — Tracking token parameters missing

**Affected Scope**: lines 313–321, 342, 359.

**Finding & Guidance**: Missing token length, charset, hash algorithm, TTL name/default, revocation SQL, public base URL, rate-limit values, and SPA route. Tests have no values to assert.

### Major R8 — Adapter configuration names missing

**Affected Scope**: lines 303–306, 337, 367–370, 377–380.

**Finding & Guidance**: No exact variable names, allowed mode values, default, or invalid-mode behavior. Define names such as `WHATSAPP_ADAPTER_MODE=disabled|sandbox`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_WEBHOOK_SECRET`.

### Major R9 — Sender reservation mechanism missing

**Affected Scope**: line 340.

**Finding & Guidance**: "Bounded batch" and "reserves them without duplicate sends" omit batch size, reservation state, lease duration, and crash recovery. Define `PENDING → PROCESSING → SENT/FAILED`, `reserved_at`, `lease_expires_at`, batch limit `N`, and requeue of expired leases.

### Major R10 — Phone validation and helper reuse undefined

**Affected Scope**: lines 293–301, 337, 346.

**Finding & Guidance**: The plan says recipient validation and phone normalization without naming `isValidPhone`, `normalizePhone`, `validatedPhone`, or `NORMALIZED_PHONE_SQL`, and does not state how many last digits are stored.

### Major R11 — Status-label consolidation missing

**Affected Scope**: lines 293–301, 344.

**Finding & Guidance**: `statusLabel()` already exists. The plan proposes state labels in a new module without deciding whether to extract or duplicate the map.

### Major R12 — Template rendering underspecified

**Affected Scope**: lines 293–296, 306.

**Finding & Guidance**: No template key enum, placeholders, language code, or final approved strings. The example is explicitly not final, so tests have no canonical text.

### Major R13 — Audit actions undefined

**Affected Scope**: line 344.

**Finding & Guidance**: Existing audit infrastructure already carries request id, actor, UTC time, and before/after. The plan does not name actions or exact metadata. Define actions such as `notification.created`, `notification.sent`, `notification.failed`, `notification.retried`, and `consent.captured`.

### Major R14 — Consent fields and UI behavior undefined

**Affected Scope**: lines 337–338, 357.

**Finding & Guidance**: No exact fields, flag semantics, timestamp source, actor source, revalidation at `READY_FOR_DELIVERY`, or phone-confirmation behavior.

### Major R15 — Scheduled handler has no request context

**Affected Scope**: line 333–346.

**Finding & Guidance**: A scheduled handler has no `Request`, so `cf-ray` request id does not exist. Define a system actor and generated request id. Also account for global CSRF handling on the webhook POST.

### Major R16 — Migration rollback and backfill missing

**Affected Scope**: lines 288–291, 409–415.

**Finding & Guidance**: Migration is additive but no down SQL or explicit forward-only statement is given. Existing orders need a default consent value and remediation rule.

### Major R17 — Test cases lack concrete assertions

**Affected Scope**: lines 348–351, 407–414.

**Finding & Guidance**: Missing tenant isolation, tracking rate limit, token expiry/revocation integration, and log redaction assertions. Convert narrative cases into given/when/then with exact data and expected outputs.

### Nit R18 — Generated Env duplication

**Affected Scope**: line 372–375.

**Finding & Guidance**: `src/worker.ts` declares `Env` manually; regenerating bindings creates another definition. State that the manual interface must be extended and generated file used only as reference.

## egm-codebase-details findings

All cited existing `Modify` and `No change expected` files exist. Migration `0012` is the next number. All referenced scripts exist. Proposed `Create` files are not defects.

### Major C1 — Wrong role literal

**Affected Scope**: line 326.

**Discrepancy Description & Rationale**: The plan says `technical lead`, but `ROLES` uses `technical_lead`. A literal with a space never authorizes.

### Major C2 — Viewer decision left open

**Affected Scope**: line 326.

**Discrepancy Description & Rationale**: "`viewer` remains read-only if viewing is allowed" leaves the access decision unresolved.

### Major C3 — Dynamic public tracking route missing

**Affected Scope**: lines 326, 342.

**Discrepancy Description & Rationale**: `isPublicApiRoute` uses exact matches and one regex. A literal `GET /api/tracking/:token` would never match a real token.

### Major C4 — Assistant order conversion path omitted

**Affected Scope**: line 338.

**Discrepancy Description & Rationale**: Orders are also created by `POST /api/admin/assistant/requests/:id/convert`. The plan only covers `POST /api/orders`, so converted orders get no consent or outbox row.

### Major C5 — Two order forms exist

**Affected Scope**: line 357.

**Discrepancy Description & Rationale**: `submitOrder` and `submitDirectOrder` both create orders. Consent and phone confirmation must be defined for both. Phone lives on `customers.phone`, not the order form.

### Major C6 — No public tracking route in SPA

**Affected Scope**: line 359.

**Discrepancy Description & Rationale**: `App.tsx` uses query parameter `?tab=` and no path router. The plan does not define a public URL or token extraction. Initial `useEffect` calls protected APIs and would generate errors for a public visitor.

### Major C7 — Fake D1 infrastructure missing from file list

**Affected Scope**: lines 350, 413.

**Discrepancy Description & Rationale**: No D1 fake, setup file, or SQLite test dependency exists. The file list omits the fake helper. D1 interfaces are private to `worker.ts`.

### Major C8 — Concurrent sender claim missing

**Affected Scope**: line 340.

**Discrepancy Description & Rationale**: D1 has no row locks. Without a status update guarded by `meta.changes` and a lease, two cron runs can send duplicates.

### Major C9 — Staff endpoint paths missing

**Affected Scope**: line 343.

**Discrepancy Description & Rationale**: No paths or methods for list and retry endpoints, and no decision whether to extend `GET /api/orders/:id`.

### Major C10 — Reuse opportunities missing

**Affected Scope**: lines 296, 316, 342, 344.

**Discrepancy Description & Rationale**: Existing helpers for token generation, hashing, token format, phone validation, status labels, rate limiting, and audit are not named for reuse.

### Nit C11 — Webhook CSRF dependency undocumented

**Affected Scope**: line 341.

**Discrepancy Description & Rationale**: All non-read methods pass CSRF origin checks. Public webhook status in authz does not bypass that middleware. An `Origin` header from a provider would cause a silent 403.

### Nit C12 — Existing consent UI pattern not reused

**Affected Scope**: line 357.

**Discrepancy Description & Rationale**: `consentChecked` and `acceptChatConsent` already exist in `App.tsx`; the plan does not reference them.

## egm-style findings

### Major Y1 — Status naming inconsistent

**Affected Scope**: lines 339, 351, 414.

**Style Rationale**: `READY_FOR_DELIVERY`, "ready-for-pickup," and "ready for pickup" name one state in three ways. Standardize one identifier and one display label.

### Major Y2 — Conditional viewer statement

**Affected Scope**: line 326; CALIBRATE.

**Style Rationale**: "`viewer` remains read-only if viewing is allowed" defers the authorization decision. Replace with a closed rule.

### Major Y3 — Duplicate rollout gate

**Affected Scope**: lines 385, 415; CALIBRATE.

**Style Rationale**: The same "do not claim live before sandbox test" gate appears twice, and "this check" has no precise antecedent. Consolidate and name the gate.

### Major Y4 — Undefined privacy limit

**Affected Scope**: line 359; CALIBRATE.

**Style Rationale**: "No personal data beyond what the customer needs" is not testable. List exact allowed fields or state "no personal data."

### Nit Y5 — Uncited repository claim

**Affected Scope**: line 412; CALIBRATE.

**Style Rationale**: "No lint script exists yet" is an repo-state claim without an in-document source.

### Nit Y6 — Generator signature

**Affected Scope**: line 419; DROP.

**Style Rationale**: "*Drafted with EGM*" has no technical meaning for the reader.

Other caveats in the range were KEEP: they name concrete rules or gates. No RELOCATE candidates were found. No hyperbole or subjective quality judgments were found.
