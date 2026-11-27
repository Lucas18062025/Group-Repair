# WhatsApp Order Notifications

* **Author:** Lucas Villagra
* **Status:** Proposed
* **Date:** 2026-11-26

--------------------------------------------------------------------------------

## Overview

Group Repair needs to keep the customer informed after a repair order is opened and while it moves through the workshop. The first message is sent when the order is created. The second message is sent when the order is ready for pickup.

Each message identifies the workshop, the order number, the equipment, the plain-language state, and a tracking link. The example supplied by the author uses an `ODR-...` reference from another product. Group Repair currently creates `GR-00001`-style references. This design keeps `GR-00001` and does not introduce a second public reference.

The tracking link uses a random token. It does not expose the order number or phone number in the URL.

The notification is an operational message. It is not a marketing campaign and not a customer support bot.

## The Problem

Customers currently have to call the workshop or use the public assistant to learn what happened to a repair. That creates repeated phone calls, uncertainty, and extra work for reception.

A WhatsApp message can reduce that work, but it also creates risks:

* A phone number can belong to the wrong person or be typed incorrectly.
* Sending repair information to WhatsApp without clear consent can violate the workshop's privacy commitments.
* WhatsApp requires approved message templates for outbound messages outside a customer-initiated window.
* A failed delivery must not stop the workshop from continuing to process the order.
* A retry must not send the same message several times to the customer.
* A tracking URL that contains only an order number can expose customer information to anyone who guesses the number.

The current application stores customer phone numbers and order state, but it has no WhatsApp provider integration, no notification log, no order-level message consent flag, and no public order page with a verified tracking token.

## Goals

* Send one WhatsApp message to the customer when a new order is created, only when the customer has valid contact details and the required consent.
* Send one WhatsApp message when the order reaches `READY_FOR_DELIVERY`.
* Include workshop name, order number, equipment description, plain-language state, and a tracking link in every message.
* Use a tracking link that does not reveal customer data to an unverified visitor.
* Record consent, template used, provider message id, delivery result, attempt count, actor, UTC time, and a request id for every attempt.
* Prevent duplicate customer messages for the same order, state, and notification purpose.
* Continue workshop operations when WhatsApp is unavailable; delivery failures must be visible to staff but must not roll back the order change.
* Keep provider credentials outside the repository and controlled by deployment configuration.
* Make the integration testable without sending real WhatsApp messages.

## Non-Goals

* No marketing broadcasts, promotions, or abandoned-order campaigns.
* No two-way WhatsApp support bot in this design.
* No payment collection, invoice delivery, or attachment delivery through WhatsApp in this design.
* No automatic diagnosis or AI-generated repair advice in the message.
* No replacement for the internal audit log or the order status history.
* No duplicate of the external `ordendereparacion.com` product behavior, including its `ODR-...` reference format.
* No second public reference number. The customer sees `GR-00001`.
* No messages for diagnosis, quote, approval, rejection, repair progress, testing, cancellation, or reopening in this phase.
* No storing WhatsApp access tokens or customer conversation content in the repository.
* No assumption that Google Drive, Sheets, Photos, or unimplemented services are involved.

## Open Questions

None. All design decisions for this phase were resolved by the author.

## Critical User Journeys (CUJs)

### CUJ 1: New order sends the first message

* **Given**: Reception has an approved session, the customer has a valid phone number, WhatsApp consent is checked in the order form, and the service is configured.
* **When**: Reception creates a new repair order.
* **Then**: The order is saved first. A notification request is recorded with a unique key for that order and purpose. One WhatsApp message is sent with order number, equipment, plain-language state, and a tracking link. The outbox row stores the request id, actor, UTC time, template, provider message id, and delivery state. No customer phone number is written to ordinary logs.

### CUJ 2: Ready-for-pickup message

* **Given**: The order reached `READY_FOR_DELIVERY`, consent was recorded when the order was created, and an earlier message was not already sent for this state.
* **When**: The responsible user changes the order state.
* **Then**: One message is sent saying the equipment is ready for pickup. The message includes the `GR-00001` order number and a valid tracking link. Duplicate status changes or retries do not create duplicate customer messages.

### CUJ 3: Missing consent or invalid phone

* **Given**: The order was created, but the order has no consent record or the phone is invalid.
* **When**: A notification would be triggered.
* **Then**: No WhatsApp message is sent. The order still succeeds. Staff see a clear reason such as "missing consent" or "invalid phone" in the order notification panel. The reason is recorded in the notification log without exposing unnecessary personal data.

### CUJ 4: Provider failure

* **Given**: WhatsApp is unavailable or rejects a template.
* **When**: The worker tries to send a queued notification.
* **Then**: The order operation is not rolled back. The notification stays in the outbox with attempt count, error code, and next attempt time. Delivery is retried up to five times with increasing delay. After the last failure, the item is marked failed and visible to staff for manual action.

### CUJ 5: Customer opens the tracking link

* **Given**: The customer received a tracking link with a random token.
* **When**: The customer opens the link in a browser.
* **Then**: The page shows only the state and next step for that order. The token is checked against a stored hash, rate limited, and can expire. An invalid token returns a generic not-found response. The page works on mobile and with a keyboard, and does not communicate state only by color.

## Technical Plan (Architecture)

**Author decisions:**

* Build the outbox and provider adapter boundary first.
* Do not select or implement a concrete WhatsApp provider until credentials, templates, and the data-processing decision are resolved.
* Show the existing `GR-00001` order reference to the customer.
* Send only two notifications: order created and ready for pickup.
* Capture WhatsApp consent in each new order, with actor and UTC date stored on the order.
* Publish a tracking page reached by a random token, not by the order number alone.
* Retry failed delivery up to five times with increasing delay and staff visibility.

The design uses an outbox between workshop operations and WhatsApp. The workshop writes the order change and a notification request in the same database transaction. A separate sender reads pending requests and calls the messaging provider. This keeps order processing independent from WhatsApp availability and gives one place for retries, idempotency, and audit.

```text
Staff UI / Worker
        |
        | create order or status change to READY_FOR_DELIVERY
        v
D1 transaction
  |
  +-- repair_orders + order_status_events + audit_events
  |
  +-- notification_outbox (one row per order/state/purpose)
        |
        v
Notification sender
  |
  +-- check consent + phone + template
  +-- create tracking token if needed
  +-- call WhatsApp adapter
  +-- save provider id / error / attempt / next attempt
        |
        v
WhatsApp provider webhook
        |
        +-- verify signature
        +-- update delivery status in outbox
```

The provider-specific call stays behind one adapter. The rest of the application must not know whether the provider is Meta, a business messaging provider, or another service. The adapter sends a rendered approved template and receives a provider message id or a typed error.

### Provider paths considered

**Option A: Direct Meta WhatsApp Cloud API**

* **Mechanism**: A Worker calls the Meta Graph API with a phone number id, access token, and approved template name. Webhooks report delivery status.
* **Trade-offs**: Fewer services in the path and direct control over templates. The team owns token rotation, webhook verification, error mapping, and Meta policy details.
* **Failure condition**: It fails when the workshop needs multi-number routing, local provider support, or a vendor contract that Meta does not provide.

**Option B: Business messaging provider**

* **Mechanism**: A Worker calls one certified provider such as Twilio or a regional BSP. The provider handles phone onboarding, template submission, and webhook normalization.
* **Trade-offs**: Less provider-specific code and a single vendor API for delivery status. It adds vendor cost, contract dependency, and another data processor to review.
* **Failure condition**: It fails when the vendor does not support the required region, pricing, template behavior, or data retention terms.

**Option C: Outbox now, adapter implementation later**

* **Mechanism**: Implement consent, outbox, deduplication, audit, staff visibility, and sender retries first. Add one provider adapter when credentials and approvals exist.
* **Trade-offs**: The core reliability and privacy work is not blocked by vendor onboarding. No customer message is sent until an adapter is chosen and verified.
* **Failure condition**: It fails if the feature is expected to send real messages before provider selection and testing are complete.

**Author decision:** Option C.

### Data model changes

* Add order-level WhatsApp consent fields with actor and UTC consent time.
* Add `notification_outbox` with workshop id, order id, customer id, notification purpose, order state, recipient hash, template key, language, tracking token hash, status, attempts, next attempt time, provider message id, error code, request id, actor id, UTC timestamps, and minimal before/after fields.
* Add a unique key for workshop, order, purpose, state, and recipient hash to prevent duplicate customer messages.
* Add `notification_delivery_events` for provider webhook events, with signature verification result, provider event id, and UTC time.
* Add `order_tracking_tokens` with a random public token hash, order id, workshop id, expires at, revoked at, created at, and request id. Do not put the customer phone, plain order reference, or customer id in the token.
* Add an order detail panel showing notification status and manual retry, limited to authorized staff.

### Trigger rules

* Notification creation happens after authorization and order validation, in the same D1 transaction as the order write.
* Only two purposes exist: `ORDER_CREATED` and `READY_FOR_DELIVERY`.
* The sender never trusts state, phone, customer id, workshop id, actor, or template name from the request body.
* State labels shown to the customer come from a server-side map in plain Spanish, not from internal status codes.
* A status change that does not change the state does not create a notification.
* Moving to `READY_FOR_DELIVERY` more than once does not create a second customer message.

### Message content

A message contains:

* workshop name;
* greeting using the customer's first name when available and consented;
* `GR-00001` order number;
* equipment description;
* plain-language state;
* short next step when known;
* tracking link with a random token;
* a clear opt-out instruction.

The example supplied by the author must be rewritten with `GR-00001`, the Group Repair workshop name, and the new token link. It must avoid legal or warranty promises that have not been approved.

Example wording shape, not a final approved template:

```text
[MENSAJE AUTOMÁTICO]

Hola [Nombre].

En [Taller] hemos actualizado la orden: GR-00001
Equipo: [Marca y modelo]

Estado: [Estado en lenguaje claro]

Puedes ver el seguimiento en: [URL con token]

Para dejar de recibir estos avisos, responde "BAJA".
```

### Delivery and retries

* Pending messages are sent by a separate scheduled process or worker handler.
* Retry with exponential backoff up to five total attempts.
* Use a unique provider request key when the provider supports idempotency.
* Webhook events are deduplicated by provider event id.
* Staff can retry a failed notification manually; manual retry writes a new audit event and keeps the old attempts.
* No message is sent for a test order unless the order is explicitly marked as test and the provider account is a sandbox.

### Privacy and security

* Store the phone in the notification log only as a hash plus the last digits needed for staff verification.
* Do not log message bodies containing customer data.
* Verify webhook signatures before changing delivery state.
* Keep access tokens in deployment secrets, never in the repository.
* Enforce tenant scope on every read and write.
* Rate limit tracking-link access and webhook ingestion.
* Expire and revoke tracking tokens when the order is delivered, cancelled, replaced, or after the configured lifetime.
* The tracking page must not be indexed by search engines.

### Verification approach

* Unit tests for consent checks, phone normalization, template rendering, state-to-message mapping, deduplication keys, and retry timing.
* D1 integration tests for transaction behavior and unique constraints.
* A fake notification adapter for local tests; no real WhatsApp calls in CI.
* Contract tests for provider request shape and webhook verification.
* Manual sandbox test before production.
* Delivery metrics: sent, delivered, read when available, failed, retried, opted out, and manually corrected.
* Operational checks: no duplicate messages, no message without consent, order write succeeds when the provider is down.

## Alternatives Considered

### Alternative A: Direct Meta WhatsApp Cloud API first

* **Pros**: Fewer services in the path. The team controls template submission and webhook handling directly.
* **Cons**: The team owns token rotation, error mapping, phone onboarding, Meta policy details, and webhook signature verification. Provider selection becomes a hard dependency before the outbox and consent model are ready.
* **Reason for Rejection**: Rejected by author: build the provider-independent outbox and adapter boundary first, so consent, retries, audit, and data handling can be verified without vendor onboarding.

### Alternative B: Business messaging provider first

* **Pros**: One vendor API can normalize templates, delivery webhooks, and phone onboarding. It can reduce provider-specific code.
* **Cons**: It adds cost, contract dependency, and another data processor. It does not remove the need for consent, outbox, retries, or deduplication inside Group Repair.
* **Reason for Rejection**: Rejected by author: the workshop should not depend on a vendor contract before the internal notification model is defined and tested.

### Alternative C: Send WhatsApp directly from the status-change request

* **Pros**: Simple code path. The message is attempted immediately after the order write.
* **Cons**: A provider outage can slow or fail the request. Retries become harder to control. Duplicate delivery is more likely when the browser retries. There is no durable record of every attempt unless a second model is added anyway.
* **Reason for Rejection**: Rejected by author: order processing must continue when WhatsApp is unavailable, and retries must be visible and idempotent.

--------------------------------------------------------------------------------

## Non-Functional Requirements

* **Security and privacy**: Store phone hashes in notification records, not raw phone bodies in logs. Verify webhook signatures. Use random tracking tokens with hashes in D1. Expire and revoke tokens. Keep provider secrets in Worker secrets. Never show another workshop's data.
* **Reliability**: The order write and outbox write happen in one D1 transaction. Sending happens outside that transaction. Duplicate prevention uses a database unique key plus provider idempotency when available.
* **Delivery timing**: The initial message can be attempted soon after order creation. The pickup message can be attempted soon after the status change. Both remain in the outbox until delivery is confirmed.
* **Accessibility**: The tracking page and staff panel use Spanish labels, visible focus, keyboard operation, sufficient contrast, and text in addition to color.
* **Operations**: Failed messages are visible to authorized staff with reason and retry action. No staff action is required for normal delivery.
* **Rollout**: The adapter starts in sandbox or disabled mode. No real customer message is sent until templates, provider credentials, and consent wording are approved.

### Additional Resources

* `SPEC.md` sections on customer consent, order status history, audit, privacy, and deployment.
* `AGENTS.md` requirements for deny-by-default authorization, no client-supplied tenant or actor, UTC dates, and no secrets in the repository.
* Current order reference format `GR-00001` in `src/worker.ts`.
* Current public assistant order tracking endpoint `/api/assistant/orders/track`.

### Future Improvements

* **Two-way WhatsApp**: Let customers confirm pickup or ask for status from the same thread.
* **More status messages**: Add diagnosis, quote approval, or delay messages after measuring customer demand.
* **Delivery analytics**: Track delivery, read, and opt-out rates by workshop.
* **Multiple languages**: Add templates for English and Portuguese if the workshop needs them.

## Detailed Implementation Plan

### Target Files to Create/Modify

#### 1. `migrations/0012_whatsapp_notifications.sql` (Create)

* **Type / Scope**: D1 schema migration.
* **Proposed Changes**: Add order-level WhatsApp consent fields with actor and UTC consent time. Add `notification_outbox`, `notification_delivery_events`, and `order_tracking_tokens`. Add a unique key for workshop, order, purpose, state, and recipient hash. Add indexes for pending notifications, order lookup, token hash, and delivery event id. Do not drop existing columns or tables.

#### 2. `src/domain/notifications.ts` (Create)

* **Type / Scope**: Pure TypeScript domain module.
* **Proposed Changes**: Define the two notification purposes, outbox status values, retry policy, recipient validation, deduplication key construction, plain-Spanish state labels, message template rendering, and opt-out parsing. Keep this module free of D1 and provider SDK calls.

#### 3. `src/domain/notifications.test.ts` (Create)

* **Type / Scope**: Unit tests.
* **Proposed Changes**: Cover consent required, invalid phone, exact two purposes, deduplication key stability, template rendering with `GR-00001`, state labels, no sensitive data in rendered logs, and five-attempt backoff policy.

#### 4. `src/domain/whatsapp-adapter.ts` (Create)

* **Type / Scope**: Provider boundary.
* **Proposed Changes**: Define a send result with provider message id or typed error. Provide a disabled adapter and a sandbox adapter for local tests. Add a factory that returns an adapter from deployment configuration. Do not implement a concrete production provider in this phase.

#### 5. `src/domain/whatsapp-adapter.test.ts` (Create)

* **Type / Scope**: Unit and contract tests.
* **Proposed Changes**: Verify disabled mode sends nothing, sandbox mode returns a deterministic id, adapter errors are typed, and no secret or phone body appears in result metadata.

#### 6. `src/domain/tracking-links.ts` (Create)

* **Type / Scope**: Pure TypeScript domain module.
* **Proposed Changes**: Generate random tracking tokens, hash tokens, validate token format, compute expiry, and decide when a token is revoked. The token must not encode order id, phone, or customer id.

#### 7. `src/domain/tracking-links.test.ts` (Create)

* **Type / Scope**: Unit tests.
* **Proposed Changes**: Cover token format, hash stability, expiry boundary, revocation rule, rejection of short or malformed tokens, and absence of customer data in token strings.

#### 8. `src/domain/authz.ts` (Modify)

* **Type / Scope**: Authorization policy.
* **Proposed Changes**: Add explicit public routes for the tracking API and WhatsApp webhook. Keep order and staff notification endpoints protected. Add read and retry roles for notifications: reception, technical lead, and admin. `viewer` remains read-only if viewing is allowed.

#### 9. `src/domain/authz.test.ts` (Modify)

* **Type / Scope**: Unit tests.
* **Proposed Changes**: Verify tracking and webhook are the only new public API routes. Verify notification retry is not available to viewer, technician, or cashier. Verify tenant checks still apply to staff routes.

#### 10. `src/worker.ts` (Modify)

* **Type / Scope**: Cloudflare Worker API, persistence, scheduled sender, and webhook handler.
* **Proposed Changes**:
  * Add deployment configuration fields for adapter mode and provider secret names.
  * On order creation, validate the consent checkbox and write consent fields plus an outbox row in the same D1 batch.
  * On status transition to `READY_FOR_DELIVERY`, write an outbox row in the same D1 batch as the status event.
  * Add a scheduled handler that selects a bounded batch of pending rows, reserves them without duplicate sends, resolves the tracking token, calls the adapter, and stores the result or error.
  * Add `POST /api/webhooks/whatsapp` with signature verification and event deduplication.
  * Add `GET /api/tracking/:token` with rate limit and generic not-found response.
  * Add staff endpoints to list notification attempts and retry one failed attempt.
  * Include request id, actor, UTC time, minimal before/after, and provider message id in audit events.
  * Keep provider calls out of the order transaction.
  * Do not log phone numbers, message bodies, or access tokens.

#### 11. `src/worker.notifications.test.ts` (Create)

* **Type / Scope**: Worker integration tests using a fake D1 and fake adapter.
* **Proposed Changes**: Verify order creation with consent creates one outbox row; no consent creates none; ready-for-pickup creates one row; repeated state change creates none; sender failure leaves the order intact; retry increments attempts; webhook duplicate is ignored; tracking token resolves only the matching order.

#### 12. `src/App.tsx` (Modify)

* **Type / Scope**: React UI.
* **Proposed Changes**:
  * Add a required consent checkbox and phone confirmation to the new-order form.
  * Add a notification panel in order detail showing purpose, state, delivery status, attempts, last error, and retry button for authorized staff.
  * Add a public tracking page for the token route with Spanish text, heading, status, next step, and no personal data beyond what the customer needs.
  * Show explicit empty, loading, and error states. Do not close forms when validation or save fails.

#### 13. `src/styles.css` (Modify)

* **Type / Scope**: Styles.
* **Proposed Changes**: Add styles for the notification panel and tracking page. Add visible `:focus-visible` styles and reduced-motion handling. Keep status communicated by text plus color.

#### 14. `wrangler.jsonc` (Modify)

* **Type / Scope**: Cloudflare configuration.
* **Proposed Changes**: Add a non-secret adapter mode variable and a cron trigger for the scheduled sender. Do not place tokens, phone numbers, or webhook secrets in this file.

#### 15. `worker-configuration.d.ts` (Modify)

* **Type / Scope**: Generated Worker bindings.
* **Proposed Changes**: Regenerate with `npm run cf:types` after configuration changes.

#### 16. `.env.example` (Modify)

* **Type / Scope**: Configuration example without values.
* **Proposed Changes**: Document the names of WhatsApp adapter mode, provider token, phone number id, and webhook verification secret as empty variables. Add a note that real values belong in Worker secrets.

#### 17. `README.md` (Modify)

* **Type / Scope**: Product documentation.
* **Proposed Changes**: Document the two notification moments, consent requirement, tracking page, staff retry, failure policy, and configuration steps. Do not claim the provider is live until a sandbox test passes.

#### 18. `SPEC.md` (Modify)

* **Type / Scope**: Product specification.
* **Proposed Changes**: Add WhatsApp notifications to order lifecycle and customer communication. State that consent is captured per order and that state events must not be lost when delivery fails.

#### 19. `public/privacy.html` (Modify)

* **Type / Scope**: Public privacy page.
* **Proposed Changes**: Explain that phone number, order number, equipment description, and status can be sent through WhatsApp only after consent. Explain opt-out, retention, and tracking-token purpose.

#### 20. `public/terms.html` (Modify)

* **Type / Scope**: Public terms page.
* **Proposed Changes**: Clarify that operational messages are informational and not a warranty promise. Reference the privacy page for message data.

#### 21. `.github/workflows/ci.yml` (No change expected)

* **Type / Scope**: CI.
* **Proposed Changes**: Keep existing test, typecheck, build, and dry-run steps. Confirm that the new tests are picked up by `npm test`. Add lint only if a script is introduced in a separate change.

### Verification Plan

* **Compilation/Build**: `npm run typecheck`, `npm run build`.
* **Unit Tests**: `npm test`, including notification, adapter, tracking token, and authorization tests.
* **Local migrations**: `npm run cf:migrate`.
* **Static checks**: `git diff --check`. No lint script exists yet.
* **Integration**: D1 local test for transaction, uniqueness, retry, webhook deduplication, and tracking token lookup.
* **Manual local flow**: Create an order with consent in sandbox adapter, confirm one outbox row and one rendered message. Move order to ready for pickup, confirm second message. Disconnect adapter, confirm order change still succeeds and retry appears.
* **Production readiness**: Apply migration first, configure secrets, verify webhook URL, send a sandbox message, then enable the adapter. Do not mark production integration active before this check passes.

--------------------------------------------------------------------------------

*Drafted with EGM*
