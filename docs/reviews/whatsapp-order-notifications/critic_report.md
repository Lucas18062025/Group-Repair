# Stage 7 — Critic Review

Target: `C:\Users\HP Ryzen 5\Proyectos\Git-Hub\Group-Repair\docs\designs\whatsapp-order-notifications.md`
Reviewers: `egm-design`, `egm-structural`, `egm-style`
Scope: FeatureRange lines 1–283
GoldfishContext: empty

## egm-design findings

### Finding D1 — Blocker

**Affected Scope**: Alternatives Considered, lines 245, 251, 257; Open Questions, line 61.

**Finding & Recommendation**: The mandatory Alternatives Rule is violated. Every rejection rationale says "Rejected by author" with no linked issue, discussion, PR, or ADR. The standard forbids attributing rejection to a maintainer without such a link. A fresh reader cannot verify why the paths were rejected. Replace each phrase with a concrete trade-off statement and attach an issue/ADR, or convert them into documented design decisions with evidence.

### Finding D2 — Blocker

**Affected Scope**: Goals line 41; architecture lines 107, 118, 163; delivery lines 211–213; NFR line 264.

**Finding & Recommendation**: "Prevent duplicate customer messages" is asserted but not achieved. A UNIQUE key prevents duplicate rows, not duplicate sends. Two workers can read the same `PENDING` row and both call the provider. Provider idempotency is conditional and has no key derivation. Require an explicit claim protocol: conditional status update to `PROCESSING` with a lease, visibility timeout, deterministic idempotency key derived from the immutable outbox row id, and a fallback for providers without idempotency.

### Finding D3 — Blocker

**Affected Scope**: Non-Goals line 49; webhook flow lines 129–132; message content lines 188, 206.

**Finding & Recommendation**: The template promises the customer can reply `BAJA`, but the design excludes a two-way bot and the webhook only handles delivery status. There is no inbound ingestion, consent revocation rule, or opt-out audit event. Either add inbound webhook handling and consent revocation in this phase, or remove the opt-out instruction.

### Finding D4 — Major

**Affected Scope**: Open Questions lines 59–61; SPEC.md section 10; lines 100, 190, 268.

**Finding & Recommendation**: "All design decisions were resolved" is false. Unresolved items include provider, approved template text, consent wording, token TTL, backoff schedule, rate-limit values, opt-out handling, and the meaning of "delivered." Add an open-questions table with owner, blocking decision, and target resolution.

### Finding D5 — Major

**Affected Scope**: lines 100, 151–157, 211, 265, 268.

**Finding & Recommendation**: The chosen path delivers no customer value until a provider is selected. No sender trigger is decided: Cron Trigger, Queue, or scheduled handler. No polling interval, batch size, concurrency limit, backpressure, or behavior for pending rows while no adapter exists. Define these mechanics and a go/no-go gate.

### Finding D6 — Major

**Affected Scope**: data model lines 162, 165; privacy line 224; NFR lines 263, 273; `src/worker.ts:101`.

**Finding & Recommendation**: The design assumes multi-tenancy, but the codebase uses one hardcoded `WORKSHOP_ID = "workshop-main"`. Either drop speculative tenant design or add an explicit prerequisite with migration scope.

### Finding D7 — Major

**Affected Scope**: Goal line 39; CUJ 5 lines 89–93; decision line 104; `src/worker.ts:1982–2041`.

**Finding & Recommendation**: The token-gated page does not address the existing public endpoint `/api/assistant/orders/track`, which discloses status, equipment, and budget with a `GR-` reference plus fuzzy phone matching. This defeats the stated privacy goal and creates two tracking paths. Deprecate the legacy disclosure or require the token for all status reads.

### Finding D8 — Major

**Affected Scope**: CUJ 3 lines 77–81; data model lines 162, 166.

**Finding & Recommendation**: When consent is missing or the phone is invalid, no outbox row can be created because the unique key needs a recipient hash, yet the CUJ says the reason is recorded and visible to staff. Define a `SKIPPED`/`REJECTED` record with reason code and no recipient hash, or use a separate skip log.

### Finding D9 — Major

**Affected Scope**: data model line 162; privacy lines 220, 263.

**Finding & Recommendation**: A plain hash of a phone number is brute-forceable. Require keyed HMAC-SHA256 with a secret in Worker secrets, a fixed masking rule such as last four digits, and state that the hash is a correlation key, not anonymisation. Apply the same rule to `recipient_hash`.

### Finding D10 — Major

**Affected Scope**: CUJ 5 line 93; sender line 124; data model lines 162, 165; privacy line 226; NFR line 263.

**Finding & Recommendation**: Token design is ambiguous. "Delivered" can mean the webhook delivery state and revoke the link after the first message. No entropy, hash scheme, TTL, or one-token-per-order policy is given. The token hash is duplicated in two tables. Define "delivered" as the pickup event, require at least 128-bit CSPRNG tokens stored as keyed hashes, set a TTL, keep one source of truth, and reference a token id from the outbox.

### Finding D11 — Major

**Affected Scope**: webhook flow lines 129–132; data model line 164; dedup line 214; privacy line 222.

**Finding & Recommendation**: Webhook handling has no timestamp or nonce freshness check, so captured events can be replayed. Terminal failures are not mapped to retry state. Failed verification events stored under the same provider event id can poison deduplication. Require signed timestamp validation, replay rejection, separation of rejected events, and a status-to-action map.

### Finding D12 — Major

**Affected Scope**: data model lines 162–166; delivery lines 209–216; metrics line 236; standard Risks & Limits.

**Finding & Recommendation**: No scalability, capacity, or retention analysis. Three new tables grow without bound. No expected volume, cleanup, index strategy, provider quota, retry multiplier, or message cost. Add a Risks & Limits section with these items.

### Finding D13 — Major

**Affected Scope**: decision line 103; data model lines 159–166; `AGENTS.md` migration requirements.

**Finding & Recommendation**: No migration strategy, rollback path, or backfill. Existing orders have no consent value. State the default as `consent = false`, add rollback, and record audited `consent.granted` and `consent.revoked` events with actor and UTC time.

### Finding D14 — Major

**Affected Scope**: problem line 27; CUJ 4 line 85; message content line 190; rollout line 268.

**Finding & Recommendation**: Approved templates are acknowledged but not modelled as a gate. Template rejection is a configuration blocker, not a transient error; five retries will fail identically. Distinguish permanent template/configuration errors from transient provider errors and assign template-approval ownership.

### Finding D15 — Major

**Affected Scope**: delivery line 213; NFR line 264.

**Finding & Recommendation**: "Unique provider request key when the provider supports idempotency" is not a specification. Define the exact key, prove it is stable across retries, and specify the non-idempotent fallback.

### Finding D16 — Nit

**Affected Scope**: lines 151, 253.

**Finding & Recommendation**: Two different concepts are both labelled Option C. Rename one.

### Finding D17 — Nit

**Affected Scope**: lines 215, 236, 265.

**Finding & Recommendation**: Several requirements are untestable: "soon after," delivery metrics without thresholds, and manual retry state semantics. Add timing targets, alert thresholds, and explicit retry state rules.

## egm-structural findings

### Finding S1 — Major

**Affected Scope**: Missing canonical Risks & Mitigations section; risks are spread across lines 23–30, 218–227, and 261–268.

**Discrepancy Description & Rationale**: The standard requires an explicit risk inventory with failure modes, security implications, scalability limits, and mitigations. The document lacks that canonical section and has no scalability limits.

### Finding S2 — Major

**Affected Scope**: Provider paths considered lines 137–157 vs Alternatives Considered lines 239–257.

**Discrepancy Description & Rationale**: The alternatives evaluation is duplicated with two schemas and conflicting "C" labels. The canonical section does not identify the selected option.

### Finding S3 — Nit

**Affected Scope**: lines 97, 139, 145, 151, 157.

**Discrepancy Description & Rationale**: Bold pseudo-headings are used instead of H4 headings. Screen readers and tables of contents cannot detect them. "decisions" and "decision" are inconsistent.

### Finding S4 — Nit

**Affected Scope**: lines 261, 270, 277.

**Discrepancy Description & Rationale**: Additional Resources and Future Improvements are H3 children of Non-Functional Requirements but are appendices, not requirements.

### Finding S5 — Nit

**Affected Scope**: lines 19, 34, 46, 95.

**Discrepancy Description & Rationale**: Header labels differ from the standard's canonical labels. The standard calls these examples, so this is a traceability issue rather than a strict violation.

Verified without findings: sequential H1→H2→H3 hierarchy, closed code blocks, consistent bullet markers, and no markdown links to validate.

## egm-style findings

### Finding Y1 — Major

**Affected Scope**: Open Questions line 61; CALIBRATE.

**Style Rationale**: "All design decisions for this phase were resolved by the author" is contradicted by deferred provider, template, consent wording, and rollout gates. Narrow the claim to the decisions actually resolved.

### Finding Y2 — Major

**Affected Scope**: Open Questions line 61 vs lines 100, 192, 235, 268; RELOCATE.

**Style Rationale**: `Open Questions: None` hides four deferred items. Move them into Open Questions or reference them there.

### Finding Y3 — Nit

**Affected Scope**: The Problem line 21; CALIBRATE.

**Style Rationale**: "Uncertainty" is subjective and not measurable. Replace with repeated status inquiries or another observable effect.

### Finding Y4 — Nit

**Affected Scope**: CUJ 3 line 81; DROP/CALIBRATE.

**Style Rationale**: "Clear reason" is value language. "Unnecessary personal data" has no limit. Drop "clear" and state the hash plus last-digits rule.

### Finding Y5 — Major

**Affected Scope**: Provider paths lines 137–157 vs Alternatives lines 239–257.

**Style Rationale**: Substantial duplication and conflicting "C" labels. Unify into one alternatives table with one labelling scheme.

### Finding Y6 — Nit

**Affected Scope**: lines 17, 48–49, 54.

**Style Rationale**: Non-Goals repeat statements from Overview and Goals. Keep one formulation per concept.

### Finding Y7 — Nit

**Affected Scope**: lines 261–268 vs 107, 209–216, 218–227.

**Style Rationale**: Non-Functional Requirements repeats secrets, transaction, idempotency, token expiry, and staff visibility. Reduce to cross-references or remove duplicates.

### Finding Y8 — Nit

**Affected Scope**: lines 110, 114, 141, 147, 211, 232, 263.

**Style Rationale**: Worker, D1, and BSP are not defined at first use. Define each term.

### Finding Y9 — Nit

**Affected Scope**: lines 67, 69, 192.

**Style Rationale**: "Approved session," "ordinary logs," and "Example wording shape" are imprecise.

### Finding Y10 — Nit

**Affected Scope**: lines 13, 61, 97, 157, 190, 245, 251, 257.

**Style Rationale**: Repeated "supplied by the author," "Author decision," and "Rejected by author" add attribution without technical content. State decisions and reasons directly.

Verified references without findings: `src/worker.ts:1483` generates `GR-0000N`; `src/domain/authz.ts:104` declares `POST /api/assistant/orders/track` as public.
