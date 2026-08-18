# Initial review

Complete this file before making implementation changes.

## Critical issues

1. No implementation of Dual control as mentioned in the TASK, and at the current version app-high-value would become APPROVED immediately.

underwriterProcedure only checks that role is truthy

decide() turns every failure into 500 (A try/catch wraps the handler and rethrows INTERNAL_SERVER_ERROR. CONFLICT, NOT_FOUND, and business BAD_REQUEST never reach the client)The review page special-cases CONFLICT and will never see it. Empty reason still returns BAD_REQUEST because Zod fails before the handler; whitespace " " becomes 500.

Find → update → audit, no transaction, no WHERE status = PENDING_REVIEW. Two underwriters can both approve. If audit insert fails, the loan is decided with no trail (failNextAudit exists in tests and is unused)

Headers x-user-id / x-user-role; the UI never sends them. Dual control cannot even be exercised

Zero and negative integers pass. Zod is z.number().optional(), not positive int. The browser conversion is not exact across IEEE 754

After a successful decide, the query is not invalidated, so the form stays on stale PENDING_REVIEW

List polling uses isFetching, so the table unmounts into “Loading…” every 5s

Review screen has no confirm, proposed amount, actor, audit, or monthly income (toView strips income; the list still shows tax ID/gender)

DecisionFormValue is hand-written; TASK.md wants inferred tRPC types

decide returns status: input.decision, not the persisted status — that will lie once PENDING_CONFIRMATION exists

Domain types duplicate Prisma enums and will drift

delete is a public mutation; audit FKs are ON DELETE RESTRICT


## Non-critical improvements

Lift `Providers` into the root layout instead of remounting a `QueryClient` on every page. List → review would keep cached application data and avoid a redundant `getForReview` on every navigation.

Stop treating row checkboxes, `pageSize = 2`, and “N selected” as a workspace. Selection has no action, is keyed by page-local row index, and resets meaning across pages. Remove it or key rows by application id and drive a real bulk/read action. Benefit: less misleading UI and fewer pagination bugs.

Add a development-only session switcher for the seeded users (Ada, Grace, Sam) and send verified `x-user-id` / `x-user-role` from the web client. Dual control cannot be demonstrated from the UI today even after the API is fixed. Production would replace this with a real identity provider.

Put a back link (and application id in the document title) on the review screen. Underwriters currently have no in-app path back to the queue.

Split list vs review fields on purpose: drop tax id / gender from the queue table; show monthly income and requested vs proposed amount only on the review screen, and only to `UNDERWRITER`. Support stays read-only in the UI even if the API already forbids `decide`.

Drive the review form from inferred tRPC `RouterInputs` / `RouterOutputs` (not a parallel `DecisionFormValue`), and render `PENDING_CONFIRMATION` with a read-only proposed amount plus Confirm / Reject rather than a second amount field. Benefit: UI cannot drift from the API contract.

Replace `type="number"` major-unit input with a string/decimal field that parses to integer minor units (or accept minor units directly), with accessible inline errors for empty, non-integer cents, `<= 0`, and `> requested`. Native `min`/`max`/`step` are not a validation layer.

After a successful decision: invalidate `getForReview` and `list`, announce the new status in an `aria-live` region, and disable the form. That is UX/a11y on top of the stale-cache bug listed under critical issues.

Add CSS / status copy for `PENDING_CONFIRMATION`. Today only pending / approved / rejected are styled; a new state would look like an unknown pending chip.

Resolve the actor from the `User` table (id, name, role) instead of hard-coding `"Development User"`. Audit rows would then match the seed names operators see.

Delete or lock down `loanApplications.delete` once it is confirmed out of scope. If it stays, it must be authenticated, authorized, and defined around the audit FK (`ON DELETE RESTRICT`).

Trim and max-length the reason at the Zod boundary (`z.string().trim().min(1).max(...)`). Whitespace-only reasons are a correctness issue today; a max length is the non-critical part (unbounded text in audit + logs).

Seed at least one already-`APPROVED`, one `REJECTED`, and (after migration) one `PENDING_CONFIRMATION` row proposed by Ada. Benefit: terminal and confirmation UI can be clicked without first mutating the three `PENDING_REVIEW` fixtures. Keep the seed upsert-safe.

Deduplicate `formatMoney`, and do not assume EUR in a helper name if currency is not on the record. Fine for this exercise; wrong if another book is added.

Server-side list pagination and `status` index later. Client slicing of `list()` is acceptable at seed size only.

Use Prisma enums as the single source of truth (re-export to the API) so domain unions cannot silently omit `PENDING_CONFIRMATION`.

Redis is in Compose and unused. Either drop it from the implied architecture or reserve it for rate-limiting `decide` / notification outbox — do not leave a dead dependency that looks like session infrastructure.

Extra tests beyond the highest-risk suite: money parsing table (`1.10`, `1.115`, empty), list polling does not unmount, support user can `getForReview` but not `decide`, seed threshold fixture (`1_000_000`) is immediately final. These harden the slice; they are not the first tests to write.

## Implementation plan

1. _Your first step_

## What I will not complete within the timebox


**From Critical issues — real problems, wrong spend for this slice**


1. **Review screen as a full underwriting dossier (actor name, audit timeline, monthly income; list tax id / gender).** TASK requires the screen to *represent the workflow* (propose vs confirm vs reject, proposed amount, useful errors). Reconstructing history is already the audit table’s job; rendering it, and reshaping PII columns, is product polish. Income is not in the business rules.

2. **Real authentication / loading the `User` row instead of headers.** Dual control only needs two distinct underwriter ids in session. The seed and `x-user-id` / `x-user-role` already exist for that. Replacing headers with an IdP, sessions, or a DB-backed principal is production identity work TASK does not ask for. (A tiny *dev* user switcher that *sends* those headers is in scope if we cannot otherwise confirm as Grace; looking up `"Development User"` is not.)

3. **Unifying domain unions with Prisma enums.** Drift is a maintenance risk. Adding `PENDING_CONFIRMATION` in both places is enough for the migration and the router. A single source of truth is a refactor with merge risk and no extra guarantee in 90 minutes.

4. **IEEE 754–proof money widget (`type="number"` → parsed string / minor-unit field).** Exactness is enforced where it must be: Zod + integer minor units + DB `Int`. The existing form already converts via `Math.round(n * 100)` and has a public test. A custom parser, inline error catalog, and a11y pass on the input are not what fails `app-high-value` today.


**From Non-critical improvements — redundant or out of scoring**

5. **Lift `Providers` to the root layout.** Shared React Query cache is nicer navigation, not a correctness property of decide/confirm.

6. **Row checkboxes, `pageSize = 2`, selection count, `getRowId`.** Dead chrome on an unscored list. Removing it is cleanup; wiring bulk actions is a different product.

7. **Support-specific read-only UI and field-level PII split (hide tax id on the list, income only for underwriters).** The requirement is `role === UNDERWRITER` on *record decision*. Support is already a 403 if we fix `underwriterProcedure`. A second UI skin is redundant.

8. **`aria-live` success theatre and extra status CSS as a project.** Invalidate the review query and show the new status; that is enough accessible feedback. A dedicated `PENDING_CONFIRMATION` chip style is welcome if it is one class, not a design pass.

9. **Reason `max()` length.** Non-empty (trim) is required. An arbitrary cap is policy, not in TASK, and the audit column is already `String`.

10. **Extra seed rows (already `APPROVED` / `REJECTED` / `PENDING_CONFIRMATION`).** The three pending fixtures plus two underwriters are the designed demo. Extra terminal rows make screenshots easier; they do not prove the transition rules. Keep the seed rerunnable, do not grow the fixture book.

11. **Server-side pagination and a `status` index.** Three (or a handful of) rows. Client `list()` is the intended size of this repo.

12. **Redis: use it or delete it.** Compose leftover. TASK says notification *infrastructure* is out of scope; Redis is not required for an in-process `LoanNotifier`.

13. **Broad extra tests (money parsing matrix, polling unmount, support `getForReview`, etc.).** TASK asks for a *focused* suite on the highest risks: threshold vs high-value, self-confirm denied, reject clears amount, support cannot decide, conflict/transaction, notifier calls. The rest remains unverified on purpose.

14. **Observability stack, outbox, rate limits, idempotency keys, bigint amounts.** Already in Production readiness / Known limitations. Implementing metrics, traces, alerts, or a notification worker would consume the entire timebox and is explicitly not obligated.

**Also not doing (requirements people confuse with the test)**

- External notification transport, schedulers, and “exactly-once” delivery — TASK forbids spending time here; wire `LoanNotifier.send` so it is callable and testable, document after-commit best-effort.
- Editing `20260809000000_init` or backfilling old `APPROVED` rows into pending confirmation — forbidden, not deferred.
- Visual polish of the list/table beyond what the review screen needs.

## Production readiness

### Observability

**Metrics (RED + workflow)**

- `loan_decision_total{action, from_status, to_status, result}` — `action` in `{approve,propose,confirm,reject}`, `result` in `{success,validation,forbidden,conflict,not_found,error}`. This is the operator dashboard, not request logs.
- `loan_decision_duration_seconds` histogram for the tRPC `decide` / confirm path (includes DB transaction, excludes notification I/O if notifications are after commit).
- `loan_applications{status}` gauge (or a periodic count query): `PENDING_REVIEW`, `PENDING_CONFIRMATION`, `APPROVED`, `REJECTED`.
- `loan_pending_confirmation_age_seconds` — max and p95 age of rows waiting on a second underwriter. This is the dual-control SLA metric; a stuck high-value proposal is a business incident, not just a slow request.
- `loan_notification_total{type, result}` for `APPROVAL_PROPOSED` / `APPROVED` / `REJECTED` × `success|failure`.
- `loan_authz_denied_total{reason}` — `not_underwriter`, `self_confirm`, unauthenticated. Useful for spotting a broken session header or a probing client.
- `loan_decision_conflict_total` — optimistic-lock / `WHERE status = expected` misses. A spike means double-submit or a stale UI, not necessarily fraud.

**Safe logs**

- Today `decide` logs `{ input, application, user }`, which includes national id, tax id, phone, email, and the free-text reason. That is not an acceptable production log.
- Info/audit logs should carry: `requestId`, `applicationId`, `actorId`, `actorRole`, `action`, `previousStatus`, `newStatus`, `approvedAmountMinor` (integer only), `durationMs`, `result`. No customer contact fields, no national/tax identifiers, no full request body.
- Do not log `reason` at info level. It is unbounded underwriter text and often contains customer financial detail; it already lives in `LoanDecisionAudit`. If needed for support, query the audit table under access control.
- Errors: log `error.code` / `error.name` and a stable message. Never Prisma `meta`, connection strings, or raw driver text to the client; to logs only as a redacted `cause` on 5xx.
- Actor name `"Development User"` should not appear in production logs; log ids, join names in the admin UI.

**Traces**

- One server span per tRPC procedure (`loanApplications.decide`, `getForReview`, `list`) with attributes `rpc.method`, `enduser.id` (internal user id), `loan.application_id`, `loan.action`, `loan.result`.
- Child spans: `db.find_application`, `db.decision_tx` (update + audit insert), `notifier.send`. That split shows whether latency is lock contention, I/O, or notification.
- Do not put reason, email, tax id, or the full application record on span attributes (they are often exported to a vendor).
- Propagate `traceparent` from the Next.js client if we keep browser-initiated tRPC; otherwise start the trace at Fastify.

**Alerts (admin-facing, low volume)**

- Page: `loan_decision_total{result="error"}` rate above a small baseline for 5 minutes — decide is a low-QPS path, so a handful of 5xx is already material.
- Page: `loan_notification_total{result="failure"}` > 0 for 10 minutes if we treat notifications as at-least-once after commit (decision succeeded, downstream did not).
- Ticket / SLA: `loan_pending_confirmation_age_seconds` max > 4 hours (or whatever policy is). High-value loans sitting on one underwriter is the operational risk this product exists to manage.
- Ticket: `loan_applications{status="PENDING_CONFIRMATION"}` drops to zero while `loan_decision_total{action="propose"}` is non-zero — possible migration/enum/read-model bug.
- Watch (not page): `loan_authz_denied_total` spike (misconfigured role header or someone hitting the API as SUPPORT); `loan_decision_conflict_total` spike (UI double-submit).

Health remains `GET /health` as liveness only. I would not make it check Postgres in the same process until there is a separate readiness probe; coupling liveness to DB causes false restarts.

### Rollout and rollback

Schema changes must be additive (`TASK.md`): do not edit `20260809000000_init`. Existing `APPROVED` / `REJECTED` / `PENDING_REVIEW` rows stay as they are; they must not be backfilled into `PENDING_CONFIRMATION`.

**Order (expand → code → contract)**

1. Ship a Prisma migration that only *adds*: `PENDING_CONFIRMATION` on `LoanApplicationStatus`, plus whatever nullable bookkeeping is required (for example `proposedByUserId`). PostgreSQL `ALTER TYPE ... ADD VALUE` is the dangerous part — it is easy to roll *forward* and painful to roll *back*. Apply this in a maintenance window or as a standalone expand step, and wait until it has run on every environment before the API writes the new value.
2. Deploy API that *reads* the new enum (and unknown statuses as non-decidable) while still only *writing* the old three statuses. Old web continues to work: it already treats anything other than `PENDING_REVIEW` as “already processed”.
3. Deploy API that writes `PENDING_CONFIRMATION`, enforces dual control, and emits notifications. tRPC response `status` must be the persisted status, not `input.decision`, or the UI will show `APPROVED` for a proposal.
4. Deploy web that can propose / confirm / reject and render the new status. Because tRPC types are compiled in, API and web should be released as a pair once the input/output shapes change; until then keep the decide input backward compatible (`APPROVED` | `REJECTED` plus optional amount).
5. Re-run seed only in non-prod; it must remain upsert-safe on a populated database.

**Runtime compatibility**

- Old API + new DB: safe if the new status is unused.
- New API + old web: high-value proposals become `PENDING_CONFIRMATION`; old web will show “already processed” and cannot confirm. That is fail-closed (no false final approval), but dual control is stuck until web is deployed. Treat API+web as one release after step 2.
- New web + old API: web may send actions the old router does not understand — do not ship web first.

**Rollback**

- Prefer rolling back **application code** (API then web, or the combined release) and **leaving the migration in place**. Forward-only schema. An unused enum value and a nullable column are harmless to the old slice (`PENDING_REVIEW` → `APPROVED` | `REJECTED`).
- Do not attempt to remove a PostgreSQL enum value as a rollback step. If a row has already been written as `PENDING_CONFIRMATION` and we roll back the API, the old handler will refuse further decisions (`status !== PENDING_REVIEW`) and those loans cannot be confirmed until the new API is restored. Mitigation: feature-flag the *write* of `PENDING_CONFIRMATION` (threshold still computed, but behind a flag defaulting off until web is live), or pause high-value decisions during the cutover.
- Notifications: if `send` is after commit, rollback of code does not unsend. Document as at-least-once; do not put notification I/O in the decision transaction unless we are willing to fail the business write on a stub/network error.
- Data rollback is not “delete the migration”. Compensating action if a bad build final-approved high-value loans: manual ops via audit trail (who approved, amounts), not a silent status rewrite. Reinterpreting `APPROVED` as pending confirmation is forbidden by the task.

**Verify before calling the release good**

- Threshold fixture (`1_000_000`) is immediately `APPROVED`.
- High-value proposal stays `PENDING_CONFIRMATION` with amount retained.
- Proposer cannot confirm; second underwriter can; reject from either non-terminal state clears `approvedAmountMinor` and keeps audit rows.
- Support user cannot `decide`.
- Existing prod-like `APPROVED` rows still read as approved after migrate.







### Known limitations

- Authentication is still a trusted development header, not an identity provider. Anyone who can reach the API can impersonate Ada or Grace until that is replaced. Dual-control integrity is only as strong as session integrity; the code can enforce “not the same `actorId`”, not “two real people”.
- `SUPPORT` is a role in the seed but has no specified product surface beyond “must not decide”. Read-only queue access is an assumption.
- Notification delivery is in-process via `LoanNotifier`. There is no outbox, retry, poison queue, or exactly-once guarantee. If we notify after commit, a crash can skip the event; if we notify inside the transaction, a notifier failure can abort a legally recorded decision. The honest production answer is outbox + worker; out of scope here. External transport is also out of scope per `TASK.md`.
- Amounts are JavaScript `number` plus Prisma `Int` (32-bit). Exact integer minor units are guaranteed only inside the 32-bit range (~21.4M EUR at 2 decimal places). No `bigint` / `decimal`, no multi-currency, currency is implied EUR in the UI only.
- Dual-control “who proposed” will be denormalized on the application (or equivalent) for enforcement; the audit table is the reconstruction source of truth. If those ever disagree, the transactional write is the bug — we will not silently trust the UI.
- Optimistic locking on `status` (and proposer) closes the obvious double-approve race; it does not by itself serialize two different applications or protect against lost updates to unrelated columns.
- Reason text is stored in clear in `LoanDecisionAudit`. That is required for the business audit; it is still PII-adjacent and needs table-level access control we do not have.
- No idempotency key on `decide`. A retried client request after a timeout may `CONFLICT` even though the first attempt committed — operators need the audit row, not a second click.
- List endpoint is unpaged and polling-based. Fine for the seed; not an operations console for a real book of applications.
- Redis, rate limits, WAF, and per-user decide throttling are not in the slice.
- Observability described above is not wired; today you only have Fastify logs (unsafe) and `/health`.
- Tests in this exercise can prove handler rules and a fake notifier; they will not prove production Postgres isolation, notification transport, or browser-vs-API clock issues unless we add slower integration tests later.
- Timebox: completing dual control, atomic audit, money/authz validation, and a focused test set is more important than the non-critical UI list. Anything in “Non-critical improvements” that we do not ship remains a known UX/ops gap, not a silent claim of production completeness.

