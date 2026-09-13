# Fix Plan

Part of the [13 Sep 2026 audit](AUDIT_REPORT.md).

## Fix log — 13 Sep 2026

**Verification:**
- `npm test`: 55 tests, all passing. This covers parsers, API security, and the whole sync plus the email scheduler against an in-memory MongoDB replica set.
- Every regression test was run against the pre-fix code (`417f460`) and **failed there**. That run also reproduced SEC-01 and REL-01 back-to-back: a stranger's session got through, the request hit the database, and the process exited.
- Checker output was identical before and after the dependency upgrades.
- The real `server.js` was booted against an in-memory database. `/health/deep` returned 200, and an unauthenticated socket was refused.
- The client passes lint (the two pre-existing warnings only) and builds.

### Fixed

| ID | What changed | Result on the real workbooks |
|---|---|---|
| DA-01 ⚑BR-1 | Client read from each block's own heading; tabs merged by key | No production recorded under two clients. L&T MHI final coat 2,934 → **507** (= the sheet's cumulative). |
| DA-02 ⚑BR-2 | "Ramboll Domestic" is its own department/category; the parser sums and warns instead of emitting duplicate keys; the sync refuses a month whose records do not add up | 0 rows rejected (was 17). The synopsis KPI now equals the monthly chart. |
| DA-03 | Day columns outside the workbook's month are left out, with their tonnage in the warning | January's `22.06.26` no longer lands in June. Its 120.211 MT is excluded until S-2 is fixed in the sheet. |
| DA-04 ⚑BR-3 | "ZETWERK (Job)" → Job Work (Zetwerk) / Job Work | Category "Other" is gone; Job Work mode +100.9 MT |
| DA-05 ⚑BR-4 | Dispatch tagged `businessUnit` from block titles; HSD excludes BU; the Bhilai view shows its own dispatch | HSD 5,505.786 MT, Bhilai 197.000 MT |
| DA-06 ⚑BR-5 | A block's own month wins; conflicting duplicates are warned | 10 RIL conflicts now reported instead of silent |
| DA-09 | Production stale cleanup (gated) | Removes the obsolete May–Nov 2025 L&T MHI documents on the first sync |
| DA-10 | Orphaned months removed (only after a clean run); one workbook per month, newest wins | — |
| DA-12 | The suspicious-increment guard needs a prior running total | — |
| DA-14 | `Grand Total` / `Sub-Total` skipped; numeric text and negatives warned | — |
| DA-16 | IST "today" and default range | — |
| DA-19 | Records validated before `bulkWrite`. **Found and fixed while doing this:** `dailyIncrementQty: min 0` would have discarded two genuine negative corrections (RIL −87 / −95), so the constraint was removed | — |
| DA-20 | One workbook download per sync | — |
| REL-01 | `asyncHandler` on every route; 4xx for client errors; `unhandledRejection` logger | — |
| REL-02 | DB-backed sync lease; manual sync returns 409 while a sync runs | — |
| REL-03 | Synopsis month written in a transaction | — |
| REL-04 | Atomic email claim; stale claims become `unknown`; retries only on Gmail 429/5xx; failed and unknown sends shown on the Email page | — |
| REL-05 | Issue severity; status derived from errors; per-source stats in SyncLog | — |
| REL-06 | Every source isolated (the live-workbook download too) | — |
| REL-07 | Drive 60 s timeout + one retry; Gemini 45 s timeout | — |
| REL-09 | Cleanup refused below 70% of the stored data; a synopsis month is not replaced below 50% of its tonnage | — |
| REL-10 | Abandoned `running` logs closed by the next run | — |
| REL-11 | AI output shape-validated before caching; cache keyed on the figures; panel wrapped in an ErrorBoundary | — |
| SEC-01 ⚑BR-12 | Sign-in allowlist (domain + listed emails + admins + EMAIL_USER), rechecked on every request | — |
| SEC-02 / 03 | `email_verified` required; OAuth `state` on all three flows | — |
| SEC-04 / 05 | Origin check on non-GET requests; the 20 MB email parser runs after auth | — |
| SEC-07 / 08 | Role re-derived per request; a deployed server refuses the dev secrets | — |
| SEC-09 (part) | `nodemailer` (high), `express`, `body-parser`, `qs` (override) fixed | — |
| SEC-10 / 11 / 13 (part) | Socket auth; no internal error text in responses; connector email shown to admins only; anti-framing headers on Vercel | — |
| PERF-01 / 02 | SyncLog index + 180-day TTL; InsightCache TTL; `DispatchRecord {businessUnit, date}` index; rate limit per user | — |
| UX-01 / 02 | "Figures as of the … sync", a newer-figures banner, error state, 401 → sign-in | — |
| UX-06 (part) | `aria-pressed`, `aria-expanded`, modal focus in and out | — |
| Checker gap | `check:manpower` also compares the as-stored figures (10 Feb: stored 229 vs sheet 515) | — |
| F-0 (part) | `check:production`, `check:dispatch`, `npm test` | — |

⚑ = the code now follows what the sheet itself states (a block's own heading, a column's title, a row's label). The business rule is still worth confirming, and the sync warns on every run until the sheet is tidied.

### Not done, and why

| ID | Reason |
|---|---|
| SEC-09 `xlsx` | The fix exists only as SheetJS's CDN tarball, and npm 12 on this machine blocks remote tarballs (`allow-remote=none`). Your call: allow it, or vendor the tarball. Re-run all checkers after. |
| SEC-09 `googleapis`, `node-cron`, `uuid` | Breaking majors that need testing against live Drive/Gmail. The `uuid` flaw needs a `buf` argument these libraries do not pass. |
| F-0 `reconcileDb.js` | Needs a read-only connection to the production database, which was deliberately not used. |
| REL-08 change detection | Performance only; the lock and gates removed the correctness risk the churn created. |
| DA-11, DA-15, DA-21 | Blocked on BR-6, BR-7, BR-9. |
| DA-07, DA-08, S-1…S-7 | Source-data fixes in the sheets (AUDIT_REPORT §5). |
| DA-13, DA-17, DA-18, DEBT-01, DEBT-03, UX-03/04/07/08, full CSP | P3; left for a later pass. |

### Before deploying: things that change

1. **Sign-in narrows.** Anyone not at `@salasartechno.com`, not an admin, and not `EMAIL_USER` is refused, including existing sessions. Put staff on personal Gmail in `ALLOWED_LOGIN_EMAILS` on Render first, or set `ALLOWED_LOGIN_DOMAINS=*` to keep the old behaviour deliberately.
2. **A deployed server will not boot** without `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY`. Confirm both are set on Render.
3. **`CLIENT_ORIGIN` must exactly match the Vercel URL**: state-changing requests from any other origin are refused.
4. **Figures change on the first sync. Tell the managers:**
   - All-time completed production drops by about 2,427 MT (the double count);
   - HSD dispatch drops by the Bhilai share (197 MT in the 10 Aug copy);
   - January synopsis drops by 120.211 MT until the `22.06.26` cell is fixed;
   - Jan–Mar synopsis gains the Ramboll tonnage that was being rejected (about 272.7 MT).
5. New indexes build automatically. The SyncLog TTL deletes logs older than 180 days when it first builds.

---

The order below follows the agreed sequence:

1. Data corruption
2. Calculations
3. Sync reliability
4. DB integrity
5. AuthN/Z
6. Security
7. Backend reliability
8. API
9. Stale data in the frontend
10. Performance
11. UX
12. Code quality

**One exception:** SEC-01 needs only a console check and a few lines of code, and it exposes every figure. It should run in parallel with step 1, not wait for step 5.

**Rules for every fix:**
- State the root cause.
- Make the smallest change.
- Add the regression test named in the row ([TEST_PLAN](TEST_PLAN.md)).
- Run all four `check:*` scripts, with zero new failures.
- Record the fix in the relevant report.

Fixes marked **⛔ BR-n** are blocked on the business answer listed in DATA_ACCURACY_REPORT §8. Until an answer comes, the code change is limited to *warning* about the condition. Nothing is reinterpreted.

---

## F-0 · Measure first (before changing any figure)

| Pri | Item | Change | Files | Risk | Test |
|---|---|---|---|---|---|
| P0 | Production and dispatch have no checker | Promote the audit probes to `check:production` / `check:dispatch` npm scripts | `server/package.json`, `server/scripts/audit/*` | none | Run against the latest workbook; commit the output to the PR |
| P0 | DB and Dashboard columns unmeasured | `scripts/audit/reconcileDb.js`: **read-only** connection (a separate DB user with the `read` role), parse a fresh local workbook, diff it against each collection per key, and print the reconciliation table | new script | none (read-only) | Run once now and again after each fix |
| P0 | Know the live index state | `db.<coll>.getIndexes()` for all 11 collections. A unique index silently fails to build if duplicates already exist. | — | none | Output attached |

## Step 1 · Data corruption / duplicates

| Pri | Issue | Root cause | Files | Recommended change | Risk | Test |
|---|---|---|---|---|---|---|
| P0 | DA-01 L&T MHI tab double-counts RIL (2,427 MT final coat) ⛔ BR-1 | Client taken from the tab name; the block's own client cell is ignored | `productionParser.js`, `sync.service.js` | Read the block client cell. Immediately: **warn** on mismatch, plus a cross-tab identical-data warning. After BR-1: skip or reassign those blocks, then delete the stale `L&T MHI` docs for May–Nov 2025 via a one-off script with a dry-run | Medium: historical totals drop; announce it | `production: block client cell overrides tab`, cross-tab warning |
| P0 | DA-02 Ramboll collision drops 272.7 MT ⛔ BR-2 (naming only) | Over-broad `/ramboll/` fold + unique index + `insertMany` rejects | `synopsisParser.js` | (a) The parser never emits two records with the same `date+department+mode`: warn and sum. **This part is not blocked.** (b) Add a `Ramboll Domestic` department and category once BR-2 is confirmed | Low | `synopsis: parser never emits a duplicate key`, `Ramboll Domestic ≠ Export` |
| P1 | DA-03 Day columns outside the month | Parser accepts any valid date | `synopsisParser.js` | Drop and warn on day columns whose month ≠ the resolved month. Ask the owner to fix the `22.06.26` cell (S-2) | Low | `day column outside the month is rejected` |
| P1 | DA-06 Overlapping trailing columns, silent overwrite ⛔ BR-5 | Every header date emitted; last write wins | `productionParser.js` | Assign each date to the block whose majority month it belongs to; warn when the values conflict. Add duplicate-key detection to the parse, as manpower has | Low | `overlapping next-month column` |
| P1 | DA-05 Bhilai dispatch in HSD ⛔ BR-4 | No business-unit concept in the dispatch parser | `dispatchParser.js`, `DispatchRecord.js`, `dashboard.controller.js` | Detect the block title → `businessUnit`; add it to the record and the queries; show BU dispatch in the Bhilai view | Medium | `dispatch: Bhilai block tagged BU` |
| P1 | DA-09 Production stale records | No cleanup | `sync.service.js` | `syncBatchId` per run; after a *plausible* parse (see REL-09), delete production docs for that client not in the batch, limited to the date span parsed | Medium | Sync semantics: stage renamed / date corrected |
| P1 | DA-10 Orphan / colliding synopsis months | Month derived from content; no reconciliation with the folder | `sync.service.js`, `SynopsisMonth.js` | Warn when two files resolve to one month (deterministic pick: newest `modifiedTime`). Mark months whose `sourceFileId` has left the folder as orphaned and exclude them from the API | Low | Sync semantics: file removed, two files one month |

## Step 2 · Wrong calculations

| Pri | Issue | Root cause | Files | Change | Risk | Test |
|---|---|---|---|---|---|---|
| P1 | DA-04 "ZETWERK (Job)" ⛔ BR-3 | Pattern gap | `synopsisParser.js` | `/zetwerk/i` → `Job Work (Zetwerk)`; `\(job\)` → Job Work mode and category | Low | `"ZETWERK (Job)" → Job Work` |
| P2 | DA-16 UTC "today" ⛔ BR-8 | `new Date()` + UTC bounds | `dashboard.controller.js` | Compute "today" and the default range as the IST calendar day, stored as UTC-midnight like the sheet dates | Low | `today uses IST` |
| P2 | DA-15 Two definitions of "completed" ⛔ BR-7 | Targets use the latest cumulative | `dashboard.controller.js` | Align to the confirmed definition | Low | Target progress test |
| P2 | DA-11 Opening balance ⛔ BR-6 | A blank first-day increment counts as 0 | `productionParser.js` | Implement the confirmed rule; warn on every first-day balance either way | Low | Fixture with a blank first increment |
| P2 | DA-12 Suspicious guard drops day one | Guard ignores the previous cumulative | `productionParser.js` | Apply the guard only when the previous cumulative exists and is ≤ the current one | Low | `suspicious guard spares day one` |
| P3 | DA-18 Client chart ≠ KPI | null client excluded | `dashboard.controller.js` | Include an "Other" bar | Low | Sum equality test |

## Step 3 · Sync reliability

| Pri | Issue | Root cause | Files | Change | Risk | Test |
|---|---|---|---|---|---|---|
| P1 | REL-02 No lock; manpower wipe race | In-process cron, no mutual exclusion, timestamp-based cleanup | `sync.service.js`, new `SyncLock` model, `sync.controller.js` | DB lease (`findOneAndUpdate` with `lockedUntil`); manual returns 409 while running; cleanup keyed by `syncBatchId`, not `syncedAt <` | Low | Concurrent syncs, race interleaving |
| P1 | REL-09 Bad parse destroys data | Only a zero-record guard | `sync.service.js` | Plausibility gate per source (vs the previous run's counts and structure); on failure keep the old data and report an `error` | Low | Parse loses 60% rows |
| P1 | REL-03 Non-atomic month write | Three independent operations | `sync.service.js` | Transaction, or batch-flip; verify `Σ records == dispatchedTotal` before commit | Low | Insert fails after delete |
| P2 | REL-06 Manpower not isolated | Missing try/catch | `sync.service.js` | Wrap it like the other steps; remove the dead cron branch | Low | Manpower step throws |
| P2 | REL-07 No timeouts / retries | gaxios defaults | `googleSheets.service.js`, `aiInsights.service.js` | `timeout` 60 s on Drive, 30 s on Gemini; one retry with backoff on 429/5xx | Low | Stubbed hang |
| P2 | REL-08 No change detection | `modifiedTime` discarded | `googleSheets.service.js`, `sync.service.js` | Store the last `modifiedTime` per file; skip unchanged ones (always re-run at least daily) | Low | Unchanged file → no writes |
| P3 | DA-20 Mixed workbook versions | 5 s cache | `googleSheets.service.js` | Download once per run; pass the workbook to each step | Low | — |

## Step 4 · Database integrity

| Pri | Issue | Files | Change | Risk | Test |
|---|---|---|---|---|---|
| P2 | DA-19 No validation on upserts | `sync.service.js` | `runValidators: true` on each `updateOne`, or validate in the parser | Low | Negative count / unknown stage rejected |
| P2 | Traceability | models + parsers | Add `sourceRow`, `sourceCol`, `sourceLabel`, `syncBatchId` to Production, Manpower and Dispatch records | Low | Records carry provenance |
| P2 | PERF-01 / indexes | models | `SyncLog {startedAt:-1}` + 90-day TTL; `DispatchRecord {date:1}`; InsightCache TTL on `generatedAt`; `ScheduledEmail` TTL for sent/cancelled | Low | `explain()` shows IXSCAN |

## Step 5 · Authentication / authorization

| Pri | Issue | Files | Change | Risk | Test |
|---|---|---|---|---|---|
| **P0** | SEC-01 Any Google account ⛔ BR-12 (domain vs list) | `auth.controller.js`, `Login.jsx` | **Today:** check the consent screen type in Google Cloud. Code: require `hd`/allowlist; reject otherwise; fix the login text | Low (existing users keep access if listed) | Non-company login rejected |
| P1 | SEC-02 `email_verified` | `auth.controller.js` | Reject unverified | Low | Stubbed payload |
| P1 | SEC-03 OAuth `state` | `auth.controller.js` | Signed state cookie on all three flows; PKCE | Low | Callback without state → rejected |
| P1\* | SEC-08 Secret fallbacks | `config/env.js` | Throw on fallback values outside localhost; **today:** confirm both are set on Render | Low | Boot test |
| P2 | SEC-07 Role in JWT | `middleware/auth.js` | Load the role per request | Low | Demoted admin → 403 |

## Step 6 · Security

| Pri | Issue | Files | Change | Risk | Test |
|---|---|---|---|---|---|
| P2 | SEC-04 CSRF | `app.js` | Origin check on non-GET routes | Low | Foreign Origin → 403 |
| P2 | SEC-05 20 MB pre-auth | `app.js`, `email.routes.js` | Move the large parser behind auth | Low | Unauth 20 MB rejected early |
| P2 | SEC-09 Dependencies | `package.json` | `npm audit fix`; SheetJS 0.20.3 from the CDN tarball; then googleapis and node-cron majors in separate PRs | Medium (xlsx behaviour): **run all checkers** | Checkers unchanged |
| P3 | SEC-10/11/13 | `sockets/index.js`, controllers, `vercel.json` | Socket auth; generic error bodies; CSP headers | Low | — |

## Step 7 · Backend reliability

| Pri | Issue | Files | Change | Risk | Test |
|---|---|---|---|---|---|
| P1 | REL-01 Crash on async error | all routes, `server.js` | `asyncHandler` wrapper on every route + `unhandledRejection` logger | Low | Bad ObjectId → 400, `/health` still OK |
| P1 | REL-04 Duplicate emails | `emailScheduler.js`, `ScheduledEmail.js` | Atomic claim `pending→sending`; stale `sending` → `unknown`; bounded retry on transient errors | Low | Overlapping ticks send once |
| P2 | REL-05 Status semantics | `sync.service.js`, `SyncLog.js`, `SyncStatusBadge.jsx` | Issue severity; status from errors; per-source counts (SyncLog v2) | Low | Routine notes → success |
| P2 | REL-10 Stuck `running` | `server.js` | On boot, mark old `running` logs as abandoned | Low | — |
| P2 | REL-11 AI output unvalidated | `aiInsights.service.js` | Validate the shape before caching; include the sync ID in the cache key | Low | Missing field → 503, not cached |

## Step 8 · API failures

| Pri | Issue | Files | Change | Test |
|---|---|---|---|---|
| P2 | Date params unvalidated | `dashboard.controller.js`, `synopsis.controller.js` | Shared `parseDay('YYYY-MM-DD')` → 400; use the same parsed value for validation and query | Invalid → 400 |
| P3 | `client` / `businessUnit` accept arrays or objects | same | Allowlist values | Bad value → 400 |

## Step 9 · Frontend stale-data problems

| Pri | Issue | Files | Change | Test |
|---|---|---|---|---|
| P1 | UX-01 | `dashboard.controller.js`, `synopsis.controller.js`, `Dashboard.jsx`, `SynopsisView.jsx` | `dataAsOf` in every payload; "Figures as of HH:MM"; "Newer data available · Refresh" banner on the socket event (keeps the no-shift rule) | Manual checklist |
| P2 | UX-02 | `Dashboard.jsx`, `api.js`, `App.jsx` | Error state; 401 interceptor → /login; React error boundary | API down → error state |

## Step 10 · Performance

PERF-02: key the rate limiter by user ID for authenticated routes, keeping the per-IP limit for `/auth`. DEBT-03: route-level `lazy()` for Email and Settings. Cache the summary server-side for 60 s per (range, BU, sync ID).

## Step 11 · UX

UX-03 (show the sync state to the PC account), UX-04 labels, UX-06 modal focus trap / `aria-pressed` / `aria-expanded`, UX-08 confirm on target Remove, "AI insights unavailable" note.

## Step 12 · Code quality

- Remove dead code (DEBT-01): `TargetPanel` (or render it once BR-7 is settled), `ProductionClientChart`, `listSheetTitles`, `/dashboard/manpower` + `fetchManpowerRecords`, server `axios`, `nodemon`, `EMAIL_APP_PASSWORD`.
- Fix the five inaccurate CLAUDE.md statements (AUDIT_REPORT §4) and stop git-ignoring it (DEBT-02).
- Normalise `CLIENT_ORIGIN` (strip the trailing slash).
- Separate the dev database from production.

---

## Source-data actions (owner: sheet maintainers, not code)

S-1 … S-7 in [AUDIT_REPORT §5](AUDIT_REPORT.md#5-source-data-issues-to-fix-in-drive-not-code). The code keeps reporting each one until it is fixed in Drive.
