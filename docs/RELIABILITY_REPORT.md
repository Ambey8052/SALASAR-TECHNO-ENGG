# Reliability, Database, Performance & Frontend Report

Part of the [13 Sep 2026 audit](AUDIT_REPORT.md).

---

## 1. Summary

| ID | P | Finding |
|---|---|---|
| REL-01 | P1 | An error in any of 14 async handlers terminates the Node process (proven on Express 4.22.2 / Node 24.18). |
| REL-02 | P1 | No sync lock. An interleaving of two syncs deletes every manpower record for the synced dates. |
| REL-03 | P1 | The synopsis month write is three separate, non-atomic operations. |
| REL-04 | P1 | Scheduled emails can be sent twice. |
| REL-09 | P1 | A malformed parse mid-edit destroys the last valid data. |
| UX-01 | P1 | The "Synced N min ago" badge implies figures that fresh; the figures are frozen at page load. |
| REL-05/06/07/08/10/11 | P2 | Status semantics, step isolation, timeouts, change detection, stuck logs, AI-output crash |
| PERF-01/02 | P2 | Unbounded SyncLog scans; per-IP rate limit vs office NAT |

---

## 2. Sync (`services/sync.service.js`, `jobs/cron.js`)

### Requirements check

| Requirement | Status | Evidence |
|---|---|---|
| Same file synced 10× without changes → no duplicates | ✅ for all five collections | Natural-key upserts, a unique index on each, whole-month replace for the synopsis |
| Removed source row → removed from the DB | Manpower ✅ (dates still parsed) · Dispatch ✅ · Synopsis ✅ within a month · **Production ❌** (DA-09) · **Synopsis month ❌** when a file leaves the folder (DA-10) · a Manpower date whose header is deleted ❌ | `sync.service.js:57`, `:117`, `:184` |
| Changed row → updated, not duplicated | ✅ when the key is unchanged. A key change (date typo corrected, stage renamed, project row moved) → new doc + stale old doc for Production | |
| Failure halfway → last valid data survives | ❌ | REL-03, REL-09 |
| No concurrent syncs | ❌ | REL-02 |
| One source's failure isolated | ⚠ Production, Dispatch and each synopsis file are isolated; **Manpower is not** | REL-06 |
| Truthful status | ⚠ | REL-05 |

### REL-02 · P1 · No lock: overlapping syncs

Nothing prevents two `runSync` calls running at once:
- `node-cron` v3 does not skip a tick while the previous run is still going;
- `POST /sync/run` does not check for a running sync;
- a **second process**, such as a Render deploy overlap or a laptop running `npm run dev` against the production DB, runs its own cron.

**Concrete failure (manpower).** Each run stamps its writes with a `syncedAt` taken once after parsing, then deletes the records on the parsed dates that are older than that stamp.

| Time | Run A (stamp t1) | Run B (stamp t2 > t1) |
|---|---|---|
| 1 | | bulkWrite → all docs `syncedAt = t2` |
| 2 | bulkWrite (slower) → all docs `syncedAt = t1` | |
| 3 | | `deleteMany({ date ∈ parsed, syncedAt < t2 })` → **deletes every doc A just rewrote, i.e. all of them** |

Result: manpower is empty for every parsed date (about 15 months) until the next sync, 10 minutes later. Anyone who loads the dashboard in that window keeps the empty snapshot for their whole page session.

Other collisions:
- **Synopsis:** interleaved delete/insert pairs raise E11000 on the second run and log noisy failures.
- **Dispatch:** each run's `$nor` cleanup can remove rows the other run just wrote if the sheet changed between their downloads.

**Fix:** a DB-backed lease (one `SyncLock` document, `findOneAndUpdate({ _id:'sync', lockedUntil: { $lt: now } }, …)` with a TTL a few minutes longer than the longest sync). It must live in the database, not in memory, because the second instance is a separate process. Manual sync returns 409 "already running". Use a per-run `syncBatchId` instead of a timestamp comparison.

### REL-03 · P1 · Synopsis month write is not atomic

`syncSynopsisMonth` runs three separate operations:
1. `SynopsisMonth.findOneAndUpdate`
2. `SynopsisDispatchRecord.deleteMany({ month })`
3. `insertMany`

A failure after step 2 (network, E11000 as in DA-02, process crash per REL-01) leaves a month that has a total but no records, or only some. The Dispatch Synopsis KPI then disagrees with the month chart until a later sync succeeds, and with DA-02 that is *never*.

**Fix:** a MongoDB transaction (Atlas supports them), or write the new records under a new `syncBatchId`, flip the month document's `activeBatchId`, then delete the old batch. Refuse to commit when `Σ records ≠ dispatchedTotal`.

### REL-09 · P1 · A bad parse destroys the last valid data

The only guard is "zero records parsed". Someone editing the live workbook can momentarily delete or reshape a header row, and a sync that runs in that window:
- **Dispatch:** `$nor` deletes every record not in the current, partial parse.
- **Synopsis:** the month is replaced with whatever was parsed.
- **Manpower:** dates missing from the parse are left alone ✅, but shift-shape changes delete.

**Fix:** a plausibility gate before any destructive step. Examples: refuse cleanup if the parse lost more than X% of the previous run's records or dates for that source; refuse when the parse is structurally weaker (fewer header rows or blocks). Report `partial` and keep the old data.

### REL-06 · P2 · Manpower step not isolated

`syncManpowerTab` has no try/catch. An exception there (for example Drive unreachable, or a bulkWrite error) jumps to `runSync`'s outer catch. Production, Dispatch **and the separate synopsis folder** are skipped, and the run is marked `failed`. `cron.js`'s `DriveNotConnectedError` branch is dead code, because `runSync` never throws.

### REL-07 · P2 · No timeouts or retries

- Drive `files.get`, `files.list` and `export` use `gaxios` defaults (no timeout). One hung download stalls the sync indefinitely, and further crons pile on top (REL-02).
- Gemini calls have no server timeout; the client aborts at 75 s.
- No retry or backoff on 429/5xx from Drive, Gmail or Gemini.

### REL-08 · P2 · No change detection

Every 10 minutes the server downloads the 540 KB workbook plus all eight synopsis files and rewrites all eight months, whether or not anything changed. `files.list` already returns `modifiedTime`, but it is discarded. Skipping unchanged files would remove most of the write churn, and with it most of the race window.

### DA-20 · P3 · Snapshot consistency

The workbook is cached for 5 s. If the Manpower step takes longer than that, the progress and dispatch tabs are read from a *second* download. One sync can then mix two versions of the sheet. Download once per run and pass the workbook down.

---

## 3. REL-01 · P1 · Process crash on any async error

**Proven:** on the installed Express 4.22.2 / Node 24.18, a handler `async () => { throw … }` never reaches the error middleware. The rejection is unhandled and Node exits with code 1 (test script in the audit scratchpad; trivially re-created).

| Handlers without try/catch (14) |
|---|
| `getHsdSummary`, `listManpowerRecords`, `getSynopsisSummary`, `getSyncStatus`, `getCurrentUser`, `disconnectDrive`, `getGmailSendStatus`, `listTargets`, `upsertTarget`, `deleteTarget`, `scheduleReport`, `listScheduledEmails`, `cancelScheduledEmail`, `getHsdInsights` (its cache read sits outside the try) |

**Triggers:**
- Any MongoDB hiccup: Mongoose buffers for 10 s, then rejects. That turns a transient DB blip into a crash, and a restart loop while it lasts.
- `DELETE /api/email/scheduled/<not-an-ObjectId>` → CastError.
- Every open dashboard polling `/sync/status` during a DB outage.

**Collateral damage:**
- A sync in progress is killed, leaving a `running` SyncLog (REL-10) and possibly a half-written synopsis month (REL-03).
- The email loop is killed between Gmail `send` and `save`, and that email is sent again after restart (REL-04).

**Fix:** a 5-line `asyncHandler` wrapper (or `express-async-errors`) on every route, plus `process.on('unhandledRejection')` logging as a backstop.

---

## 4. External APIs

| API | Token lifecycle | Failure behaviour today | Gap |
|---|---|---|---|
| Drive v3 | Refresh token from the admin's grant; access tokens refreshed by the library | Revoked/expired → `invalid_grant` → every sync `failed`, message in the badge | ✅ visible. ❌ No alert beyond the badge; no "reconnect" prompt for admins. |
| OAuth login | Online, ID token verified (issuer and audience by `verifyIdToken`) | Errors → `/login?error=login_failed` | See SEC-01/02/03 |
| Gmail | Separate send-only refresh token | Immediate send → 502 with message ✅. Scheduled → status `failed`, no retry. | ❌ No retry for transient 5xx/429; nobody is notified of a failed scheduled send |
| Gemini | API key | Missing key → 503 → panel hidden ✅ | ❌ No timeout. ❌ Output parsed but **not validated** against the schema (REL-11). ✅ Advisory only: cannot write data; totals come from deterministic code |

**REL-11 · P2 · Malformed AI output breaks the page.** `generateInsights` only does `JSON.parse`. A response missing `insights` is cached for 24 h, and `InsightsPanel` calls `data.insights.map(…)`. There is no React error boundary, so the **whole Dashboard unmounts to a blank page** for everyone using that filter for up to 24 h. **Fix:** validate the shape before caching, and wrap panels in an error boundary.

Other Gemini notes:
- **Stale insights:** they are keyed by date range only. A sync that changes the figures does not invalidate the day's cached insight, so the narrative can quote numbers the charts no longer show. Include the latest successful sync ID in the cache key.
- The AI never computes business totals. It receives the deterministic summary and is instructed to ground every claim in it ✅.

### REL-04 · P1 · Duplicate scheduled emails

`runDueScheduledEmails` reads every due `pending` email, sends them one by one, and only then marks each `sent`. Nothing claims an email before sending. Duplicates happen when:
- a tick runs longer than 60 s (large inline images, a Gmail cold call), so the next tick re-reads the same `pending` emails;
- two processes run the scheduler (see the local `.env` note in the Security report);
- the process dies between `send` and `save` (REL-01).

One failed email does **not** stop the others ✅ (per-email try/catch).

**Fix:** atomic claim (`findOneAndUpdate({ _id, status:'pending' }, { status:'sending', claimedAt })`), then `sent`/`failed`. Treat stale `sending` records as `unknown` for a human to check: at-most-once is the right default for mail to clients. Add a bounded retry for transient errors only.

---

## 5. Observability

### REL-05 · P2 · Sync status carries no signal

`status = issues.length > 0 ? 'partial' : 'success'`, but `issues` mixes real failures with routine notes:
- "Removed N stale records"
- "Skipped a Vehicle Plan block"
- the standing §9.1 manpower warning, which fires every run until the sheet is fixed

So every run is `partial`, and a synopsis folder that cannot be read looks the same as a routine note.

**Fix:** give each issue a `severity` (`info` | `warning` | `error`). Derive the status from errors only.

### Can the logs answer these questions?

| Question | Answerable? |
|---|---|
| When did the sync start / finish? | ✅ `startedAt`, `finishedAt` (no per-step timing) |
| Which file / sheet? | ⚠ Tab names and synopsis months; **no file ID, no `modifiedTime`, no workbook version** |
| Rows read? | ❌ |
| Records created / updated? | ⚠ Combined into `rowsUpserted` (unchanged rows excluded; synopsis adds parsed rows, which is a different meaning) |
| Records deleted? | ⚠ Only inside message text |
| Records rejected, and why? | ❌ Silent skips are never counted (see the parser checklist) |
| Which parser warned? | ⚠ The tab name stands in for the parser |
| Which source failed? | ✅ `issues[].tab` |
| Duration? | ⚠ Total only |
| Secrets in logs? | ✅ None |

**REL-10 · P2.** A crash mid-sync leaves `status: 'running'` with no `finishedAt`. The badge then reads "Awaiting first sync". Mark runs older than the lock TTL as `failed (abandoned)` at boot.

**Proposed SyncLog v2:** `batchId`, `trigger`, `startedAt`/`finishedAt`, and per source `{ fileId, modifiedTime, rowsRead, parsed, inserted, updated, unchanged, deleted, rejected[{reason,count}], warnings[{severity,message}], durationMs }`. Put a TTL on logs older than 90 days.

---

## 6. Frontend: caching, stale data, UX, accessibility

### Caching model

| Query | Key | staleTime | Refetch | Invalidated by |
|---|---|---|---|---|
| `hsd-summary` | `['hsd-summary', {from,to,businessUnit}]` ✅ filter-dependent | ∞ | never | logout (`queryClient.clear()`), page reload, target save |
| `synopsis` | `['synopsis', params]` ✅ | ∞ | never | logout, reload |
| `hsd-insights` | `['hsd-insights', params]` | ∞ | never, `retry:false` | logout, reload |
| `sync-status` | `['sync-status']` | 30 s | every 60 s + socket | socket event |

- Filters do reach the backend: `from`, `to` and `businessUnit` are request parameters, and the server filters in `$match` ✅. No filtering is UI-only. `client` is supported by the API but not exposed in the UI.
- **User switching:** logout clears the cache. Login is a full-page redirect, which also drops the in-memory cache ✅.

### UX-01 · P1 · Stale-data confusion

The figures are deliberately frozen for the page load, but nothing on screen says when they were loaded. Next to them, the sync badge updates live: "Synced 2 minutes ago". A manager reads that as "these numbers are two minutes old". They may be hours old. After an admin clicks "Sync now", the badge turns green and the numbers do not move. "Manpower today", loaded before midnight, still shows the previous day the next morning.

**Fix (keeps the no-shifting rule):**
- Have the API return `dataAsOf`, the `finishedAt` of the latest successful sync used, and render "Figures as of 09:40".
- When `sync:completed` arrives with a newer ID, show a non-intrusive "Newer data available · Refresh" banner.
- Keep the badge about *sync* health.

### Other findings

| ID | P | Finding |
|---|---|---|
| UX-02 | P2 | Overview has no `isError` branch: a failed summary renders headings and "—" cards with no explanation. No axios 401 interceptor, so an expired session fails silently instead of returning to /login. (Synopsis does have an error state ✅.) |
| UX-03 | P3 | The sync badge is hidden entirely for `pc.hsd@`, the account that emails figures to clients, so the person most likely to forward a stale number cannot see sync health. |
| UX-04 | P3 | "Dispatched (Custom)" label; "Dispatched (d MMM)" shows the latest day overall even when the selected range is in the past. "Dispatched by client" excludes unmapped projects, so it does not add up to the KPI (DA-18). |
| UX-05 | P3 | Chart dates format UTC-midnight timestamps in the browser's zone: correct in India, a day early west of UTC. |
| UX-06 | P3 | Accessibility: the modal has `role=dialog` + Escape ✅ but no focus trap or focus return. Preset/unit buttons lack `aria-pressed` (ViewToggle has it). The date-picker trigger lacks `aria-expanded`. Charts have no text or table alternative. Clickable chart cards are keyboard-operable ✅. Contrast tokens are validated per CLAUDE.md §5.3. |
| UX-07 | P3 | Mobile: the navbar does not collapse. Stat rows scroll horizontally (acceptable). The date picker is single-month when narrow ✅. |
| UX-08 | P3 | Duplicate-click protection: Sync now ✅, Send ✅, Schedule ✅, target Save ✅, Disconnect ✅ (confirm). Target **Remove** has no confirmation. The insights panel hides its errors silently, so "AI unavailable" is invisible. |

---

## 7. Database and performance

### Indexes vs queries

| Collection | Indexes | Dashboard query | Uses index? |
|---|---|---|---|
| ManpowerRecord | unique `{date, businessUnit, category, shift}` | `date` range (+BU) | ✅ prefix |
| ProductionRecord | unique `{date, client, processStage}` | `date` range; `processStage:'finalCoat'` all-time sort by date | ✅ / ⚠ the all-time latest scans every finalCoat doc (small) |
| DispatchRecord | unique `{sourceTab, sourceRowIndex, date}` | `date` range; latest date overall | ❌ **COLLSCAN** (a few hundred docs today). Add `{date:1}`. |
| SynopsisDispatchRecord | unique `{date, department, mode}`, `{month}` | `month $in` or `date` range | ✅ |
| SynopsisMonth | unique `{month}` | find all | ✅ tiny |
| SyncLog | **none** | `findOne().sort({startedAt:-1})` from every open tab every 60 s | ❌ **PERF-01**: scan and sort of a collection that grows about 144 docs/day, forever. Add `{startedAt:-1}` + TTL. |
| ScheduledEmail | `{status, sendAt}` | due scan each minute | ✅ |
| InsightCache | unique `{key}` | by key | ✅ (no TTL; it grows by one doc per filter combination) |
| User / GoogleToken / Target | unique fields | by key | ✅ |

- No `populate()`, no N+1 queries.
- `/hsd/summary` runs about 14 small aggregation pipelines per request in parallel. That is fine at today's data size (about 5k manpower, 5k production, a few hundred dispatch docs).

### Capacity estimate (current Render free-tier single instance)

| Users | Bottleneck | Expected behaviour |
|---|---|---|
| 10 | none | OK |
| 50 | **PERF-02**: the rate limit is 300 req / 15 min **per IP**. Staff behind one office NAT share it. Sync-status polling alone is 15 req / 15 min per open tab, so about 20 tabs exhaust it. | HTTP 429s across the office. Key the limiter by user ID for authenticated routes. |
| 100 | + CPU: each sync parses a 540 KB workbook and 8 files on a fractional CPU; a summary burst after a sync | Slow responses during syncs |
| 500 | + memory (xlsx parse spikes), in-process crons, a single instance | Needs a paid instance, change-detected syncs (REL-08), a short server-side summary cache per (range, BU, sync ID), and the cron moved to a single worker |

**Frontend:** one 1.05 MB JS chunk (DEBT-03). Route-split Email and Settings and lazy-load Recharts. The socket is a module singleton; listeners are cleaned up correctly on unmount ✅, but it never disconnects on logout (P3). There is no render hot spot: every chart is small.

---

## 8. Failure-mode analysis

| # | Scenario | Expected | Current behaviour | Data-loss risk | User experience |
|---|---|---|---|---|---|
| 1 | Drive unavailable | Keep the last data; log `failed`; retry | Manpower throws → whole run `failed` (REL-06); data untouched ✅ | None | Red badge; figures from the last sync, undated (UX-01) |
| 2 | OAuth token expired | Auto-refresh | Library refreshes the access token ✅ | None | Invisible ✅ |
| 3 | Access revoked | Fail loudly; prompt the admin | Every run `failed` with `invalid_grant` | None | Badge only; no admin prompt |
| 4 | Excel file missing | Fail that source | Workbook: 404 → run failed. Tab renamed: `[]` → "no header rows" warning, `partial`, data kept ✅. Synopsis file removed: **month kept forever** (DA-10) | Stale data shown as current | Misleading |
| 5 | File corrupted | Fail that source | `XLSX.read` throws → manpower → whole run failed; synopsis file isolated ✅ | None | Badge |
| 6 | Structure changed | Warn; keep data | Partial parse → **dispatch cleanup deletes**; synopsis replaced (REL-09) | **High** | Silent drop in totals |
| 7 | Malformed date | Warn; skip the cell | Serial out of range → column ignored silently. Wrong-but-valid date → stored under that date (DA-03, DA-08) | Misfiled data | Silent |
| 8 | Duplicate rows | Warn; never drop | Manpower warns; production and synopsis silently keep one (DA-02, DA-06) | **Yes** | Silent |
| 9 | MongoDB unavailable | 503; retry | Mongoose buffers 10 s → rejection → **process crash** (REL-01) | In-flight sync/email interrupted | Errors, then cold start |
| 10 | Write fails halfway | Roll back | Synopsis month half-written (REL-03); bulkWrite `ordered:false` applies partially | **Yes** | KPI ≠ chart |
| 11 | Gemini unavailable | Hide the panel | 503 → panel hidden ✅; no timeout (REL-07) | None | Panel silently absent |
| 12 | Gmail unavailable | Surface the error; retry scheduled | Immediate: 502 + message ✅. Scheduled: `failed`, no retry, nobody told | Unsent report | Discovered late |
| 13 | API timeout | Error state + retry | Axios default: no timeout (insights 75 s); Overview has no error state (UX-02) | None | Endless "Loading…" or dashes |
| 14 | Frontend loses network | Error state | Query retries once, then dashes | None | Unclear |
| 15 | Render cold start | Acceptable delay | Keep-alive pings every 10 min ✅; the first request after a sleep takes 30–60 s | None | Slow first load |
| 16 | Cron runs twice | Skip if running | Both run (REL-02) | **Manpower wipe possible** | Empty charts for 10 min |
| 17 | Manual sync during cron | 409 "already running" | Both run (REL-02) | As above | As above |
| 18 | User refreshes during sync | Consistent snapshot | Reads whatever is mid-write: synopsis between delete and insert shows the month with zero records | Display only | Wrong numbers frozen for that session |

---

## 9. Deployment

| Item | Finding |
|---|---|
| Vercel SPA rewrite | ✅ `client/vercel.json` |
| `VITE_API_URL` | Must be set; no build-time check, so a missing value silently calls the Vercel origin |
| CORS | Exact-string origin: a trailing slash in `CLIENT_ORIGIN` (present in the local `.env`) breaks every request. Normalise it in `env.js`. |
| Cookies | Shape from `req.secure` ✅, consistent between dev (Lax over http) and prod (None + Secure) |
| Redirect URIs | Three, defaulting to localhost. A missing prod value produces a Google `redirect_uri_mismatch`, not a boot error. |
| Crons | In-process. Horizontal scaling, deploy overlap and a local dev server all multiply them (REL-02, REL-04). |
| `/api/health` | Returns `ok` without checking MongoDB, so it hides a dead DB connection. Keep it cheap for keep-alive, but add `/api/health/deep`. |
| Secrets committed | None (full-history scan) ✅ |
| CLAUDE.md | Listed in `.gitignore`, so it is not versioned despite being the project's main engineering document |
