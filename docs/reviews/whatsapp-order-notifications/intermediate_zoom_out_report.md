# Stage 8 — Intermediate Zoom Out Review

Target: `C:\Users\HP Ryzen 5\Proyectos\Git-Hub\Group-Repair\docs\designs\whatsapp-order-notifications.md`
Reviewer: `egm-zoom-out`
Scope: full file, lines 1–419
Context: `zoom_out_report.md`, `comprehension_report.md`, `critic_report.md`

## Verdict

The high-level design **fails the Zoom Out Standard**. Later findings and proposed mitigations did not change the architecture; they consolidated it. The core remains outbox + adapter boundary + token tracking page + webhook + retry machine + token tables. Proposed mitigations add more tables and state transitions around a design that sends no real message. Net complexity increased after Stages 5–7.

Code checks verified: `WORKSHOP_ID = "workshop-main"` at `src/worker.ts:101`; existing public tracking endpoint at `src/worker.ts:1982–2041` and `src/domain/authz.ts:104`; duplicate status maps at `src/worker.ts:109–126`, `src/worker.ts:2018–2030`, and `src/App.tsx`; phone helpers at `src/domain/assistant.ts:3–30` and `src/worker.ts:165–169`; token and hash helpers at `src/auth.ts:54–57,162–164` and `src/domain/assistant.ts:32–39`; rate limiting at `src/worker.ts:181–223`; `package.json` has `cf:types`, `cf:migrate`, `build`, `test`, `typecheck`, and no lint script.

## Finding 1 — Blocker

**Affected Scope**: Overview L9–17; Author decisions L99–105; Option C L151–157; mitigations I2/I3/D2/D11/D13.

**Simplicity Rationale**: The design builds a delivery platform with new tables, scheduled sender, lease and reconciliation, signed webhook handling, retry state machine, token subsystem, and staff panel to send zero customer messages. Later mitigations deepen the investment instead of reducing scope. The root problem can be addressed by extending existing tracking plus one durable notification record and manual retry when a real provider exists. This violates Zoom Out Standard sections 1 and 2.

## Finding 2 — Major

**Affected Scope**: CUJ 5 L89–93; decision L104; data model L165; worker L342; UI L359; finding D7.

**Simplicity Rationale**: `POST /api/assistant/orders/track` already returns reference, equipment, Spanish status, next step, and budget with rate limiting and phone validation. The design creates a second public path, token table, endpoint, page, and another status-label map. The proposed mitigation to deprecate the legacy endpoint expands scope rather than reusing what exists.

## Finding 3 — Major

**Affected Scope**: data model L162–166; privacy L224; NFR L263, L273; finding D6.

**Simplicity Rationale**: Multi-tenancy is speculative. The codebase uses one hardcoded workshop. Adding workshop scoping and a tenant prerequisite to a feature that sends no message is future platform work without a current consumer.

## Finding 4 — Major

**Affected Scope**: `notifications.ts` L293–296; `tracking-links.ts` L313–321; verification L231; mitigation D9.

**Simplicity Rationale**: Phone helpers, CSPRNG tokens, hashes, rate limiting, and status labels already exist. The design proposes new modules for each and a new HMAC scheme. A third status map and second token generator are divergence risks.

## Finding 5 — Major

**Affected Scope**: message content L188, L206; Non-Goals L49; webhook L129–132; opt-out parser L296; privacy L392–395; findings D3/I1.

**Simplicity Rationale**: The template promises reply `BAJA`, but two-way messaging is excluded and the only webhook handles delivery status. The simple option is to remove the instruction, parser, and metric. If opt-out is mandatory, use staff-mediated revocation on the existing consent field instead of adding inbound messaging.

## Finding 6 — Major

**Affected Scope**: Detailed Implementation Plan L284–405, especially L293–321 and L333–346; mitigations I2/I3/D2/D9/D11.

**Simplicity Rationale**: The plan goes down to helper and state-machine detail. The high-level interface can be stated as: on two order events, write one durable row; a sender delivers it; failure is visible. Lease, idempotency key derivation, and backoff tuning should wait for a real provider and a measured failure.

## Finding 7 — Nit

**Affected Scope**: verification L236 vs Future Improvements L281; mitigation D12.

**Simplicity Rationale**: Delivery metrics and capacity analysis have no consumer before one real message is sent. Keep verification to no duplicates, no message without consent, and successful order write when the provider is down.

## Finding 8 — Nit

**Affected Scope**: Open Questions L59–61; decision L100; rollout L268; L190; findings D4/I5/Y1/Y2.

**Simplicity Rationale**: Provider, template, consent wording, data-processing decision, token TTL, backoff schedule, and meaning of delivered remain unresolved. Status should be blocked, not "all decisions resolved."

## Conclusion for the orchestrator

Fixing Stage 5–7 findings is not enough. All corrections stay inside the same over-built architecture. Passing the Zoom Out Standard requires high-level scope reduction: extend existing tracking, add one durable notification hook with a real provider, and defer tokens, webhook, retries, lease, metrics, and multi-tenancy until a real message has been sent and a problem is measured.
