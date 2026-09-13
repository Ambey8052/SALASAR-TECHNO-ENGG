# System Audit — Salasar HSD Plant Dashboard

**Date:** 13 Sep 2026 · **Scope:** the whole repository at `417f460` (`main`), both packages, every layer from the Drive workbook to the chart.
**Status:** audit completed first, then fixes applied the same day. What changed, what is verified and what remains is in the [fix log](FIX_PLAN.md#fix-log--13-sep-2026). The findings below are as found; they describe the code at `417f460`.

| Report | What it covers |
|---|---|
| [AUDIT_REPORT.md](AUDIT_REPORT.md) | Architecture as built, method, evidence base, every finding indexed |
| [DATA_ACCURACY_REPORT.md](DATA_ACCURACY_REPORT.md) | Source-to-dashboard trace, parser audit, calculation audit, reconciliation table |
| [SECURITY_REPORT.md](SECURITY_REPORT.md) | AuthN, AuthZ, OAuth, CSRF, input handling, dependencies, privacy |
| [RELIABILITY_REPORT.md](RELIABILITY_REPORT.md) | Sync, concurrency, atomicity, failure modes, observability, database, performance |
| [TEST_PLAN.md](TEST_PLAN.md) | What to test, with what, in what order |
| [FIX_PLAN.md](FIX_PLAN.md) | Ordered, file-level fix list |

---

## 1. How the audit was done

1. **Read all ~8,000 lines of source**, server and client. Nothing was sampled.
2. **Ran both official checkers** against local copies of the source workbooks found in `C:\Users\ambey\Downloads`:
   - `check:synopsis` against 8 monthly files (`Dispach Jan 2026.xlsx` … `Dispatch Aug 2026.xlsx`, downloaded 7–12 Sep 2026): **16 failures.**
   - `check:manpower` against `HSD Projects Progress Sheet-2025.xlsx` (saved 10 Aug 2026): **2 failures**, both the known §9.1 issue.
3. **Wrote reconciliation probes for production and dispatch.** Neither has a checker. Each probe re-adds the sheet and compares the result with figures the sheet computes itself: the `From 1st to till now` and per-day-average cells, and `Total Dispatch`. They are committed as `server/scripts/audit/*.js` so every number in these reports can be reproduced.
4. **Simulated the database.** Each probe replays the sync's own write semantics (upsert keys, last write wins, the unique index, whole-month replace) and feeds the result to the real pure payload builder (`buildSynopsisPayload`).
5. **Verified platform behaviour empirically** on the installed versions (Express 4.22.2, Mongoose 8.24.3, Node 24.18), rather than reasoning about it:
   - An error thrown in an async Express handler **kills the whole Node process**.
   - Mongoose `bulkWrite` `updateOne` **casts but never validates**.
6. Ran `npm audit` on both packages and `oxlint` on the client.

### What was *not* measured

- **Production MongoDB was not queried** and **the deployed dashboard was not opened.** The DB and dashboard columns of the reconciliation table come from the simulation, not from the live system. Confirming them needs read-only DB access. [FIX_PLAN](FIX_PLAN.md) step F-0 describes the script.
- The live workbook copy is from **10 Aug 2026**. Edits made since then may have fixed some source issues described here, or introduced new ones. Re-run the probes against a fresh download before acting on the exact figures.
- The Google Cloud OAuth consent-screen setting (Internal vs External) and the Render environment variables were not visible. Two security findings depend on them and are marked as conditional.

---

## 2. Architecture as built

```
Google Drive (uploaded .xlsx, hand-edited)
 ├─ HSD_SPREADSHEET_ID   one workbook, 21 tabs; 5 are read:
 │     Manpower · Adani Progress · " L&T MHI Progress" · RIL Progress · Daily Dispatch
 └─ SYNOPSIS_FOLDER_ID   one workbook per month (Jan–Aug 2026 present locally)
        │  Drive v3 files.get(alt=media) / files.list   — refresh token of an admin (drive.readonly)
        ▼
server/src/services/googleSheets.service.js   xlsx → array-of-arrays (5 s in-memory workbook cache)
        ▼
parsers/*  (pure)   manpower · production · dispatch · synopsis   → { records, warnings }
        ▼
sync.service.js   node-cron every 10 min + POST /sync/run   (no lock)
   Manpower     bulkWrite upsert  key date+BU+category+shift     + delete untouched records on parsed dates
   Production   bulkWrite upsert  key date+client+stage          (no cleanup)
   Dispatch     bulkWrite upsert  key tab+rowIndex+date          + $nor delete of everything else in the tab
   Synopsis     SynopsisMonth upsert → deleteMany(month) → insertMany   (not atomic)
   SyncLog      status success|partial|failed + issues[]   → Socket.IO 'sync:completed'
        ▼
MongoDB (11 collections)
        ▼
controllers  dashboard.controller (Mongo pipelines) · synopsis.controller (pure JS) · insights (Gemini, 24 h cache)
        ▼  JSON, httpOnly JWT cookie (SameSite=None in prod)
client  React 19 + TanStack Query (staleTime: Infinity, figures frozen per page load) → Recharts
```

**Roles.** Everyone who signs in with Google becomes `manager`. Addresses in `ADMIN_EMAILS` become `admin`. `EMAIL_USER` gets the Email feature. The server enforces all three. The client only hides UI.

**Every place data is transformed:**

| Stage | Where | What happens |
|---|---|---|
| Fetch | `googleSheets.service.js` | Downloads the whole file every sync. No `modifiedTime` check, no timeout, no retry. |
| Parse | `parsers/*.js` | Header discovery by date serials (40000–60000) or `dd.mm.yy` text. Label → canonical mapping by regex. Summary rows skipped by label or Sr. No. |
| Normalise | `categoryAliases.js`, `stageAliases.js`, `synopsisParser.js` patterns | Collapses spellings. **This is where distinct things get merged** (DA-02, DA-04). |
| Store | `sync.service.js` | Upsert by natural key: **last write wins, no warning**. Cleanup strategy differs per collection. |
| Aggregate | `dashboard.controller.js` | Sums increments, weights 12.30 by ½, averages headcount per day. "Today" is computed in UTC. |
| Reshape | `synopsis.controller.js` | Pro-rates monthly plan for ranges, derives the covered window, builds the matrices. |
| Round | `roundDeep` | To 3 decimals, once, at the controller boundary. |
| Cache | InsightCache (24 h), TanStack Query (per page load) | Nothing shows the user how old the figures are. |
| Display | Recharts components | Stacking only. No client-side re-aggregation beyond per-bar totals. |

---

## 3. Headline results

**The code is careful, and most of the pipeline is right.** Adani production reconciles with the sheet on every one of its 36 stage-months. Dispatch reconciles on every one of its 40 rows. The manpower parser matches the raw grid on all 459 days. The synopsis parser matches every department's own cumulative, balance and achieved-% cells.

The errors that remain come from **places where the sheet contains something the code has no rule for**, which the code resolves by silently picking one answer:

1. **For May–Nov 2025, the L&T MHI tab contains RIL's data.** Its blocks are labelled `RIL` and are identical to the RIL tab record for record. The parser takes the client from the tab name, so **2,427 MT of final coat, and every other stage for 7 months, is counted twice**. That makes the all-time "Completed production" figure about **27% too high**. The "cumulative reset" in CLAUDE.md §7.3 is this switchover, not a reset.
2. **Two department labels are folded into one key.** "Ramboll Domestic" and "Ramboll Export" both become `Ramboll Export`, and the database's unique index then **rejects 272.7 MT of Jan–Mar dispatch**. The Dispatch Synopsis page ends up disagreeing with itself: the KPI says 18,641 MT while the monthly chart says 19,000 MT.
3. **A mistyped day header (`22.06.26` in January's workbook)** files January figures under 22 June. That pulls January's plan into June ranges and collides with June's real records.
4. **Bhilai dispatch blocks sit inside the Daily Dispatch tab**, and 197 MT of them are counted as HSD.
5. **Anyone with any Google account can sign in** and read all of it: the login page literally says so.
6. **One error inside any async route crashes the whole server**, including the sync and email crons. It is proven on the installed versions.
7. **Nothing stops two syncs running at once.** A specific interleaving can **delete every manpower record** for the dates being synced, and a local `npm run dev` pointed at the production DB counts as a second instance. Nothing stops **a scheduled email being sent twice** either.
8. **The page says "Synced 2 minutes ago" over figures that may be hours old.** The badge is live; the numbers are frozen for the page load.

---

## 4. Findings index

Priority: **P0** critical (data corruption, security hole) · **P1** high (wrong business result, serious reliability) · **P2** medium · **P3** low.
Type: BUG · DQ (source data quality) · BR (business rule needs confirming) · SEC · PERF · UX · DEBT.

| ID | P | Type | Finding | Report |
|---|---|---|---|---|
| DA-01 | **P0** | BUG + DQ | L&T MHI tab holds RIL-labelled blocks for May–Nov 2025. 1,070 records identical to the RIL tab; 2,427 MT final coat double-counted | Data §3 |
| DA-02 | **P0** | BUG | "Ramboll Domestic" → "Ramboll Export"; unique-index collisions drop 272.7 MT (Jan–Mar); KPI ≠ monthly chart | Data §3 |
| SEC-01 | **P0**\* | SEC | Any Google account can sign in and read everything (\*unless the OAuth consent screen is *Internal*) | Security §2 |
| DA-03 | P1 | DQ + BUG | Jan workbook day header `22.06.26`: 22 Jun double-counted (+306.6 MT in the cumulative series), Jan plan pro-rated into June ranges, 22 Jan has no data | Data §3 |
| DA-04 | P1 | BUG / BR | "ZETWERK (Job)" falls through the rules: category Other, mode Inhouse (should be Job Work) | Data §3 |
| DA-05 | P1 | BUG / BR | Bhilai blocks in Daily Dispatch counted as HSD dispatch: 197 MT (AMNS 79, Utility Bridge 118) | Data §3 |
| DA-06 | P1 | BUG + DQ | Production blocks overlap the next month's first days. The same date is parsed twice with different values; last write wins silently (15 records) | Data §3 |
| DA-08 | P1 | DQ | Manpower 10 Feb / 11 Mar mistyped headers (known §9.1): still open in the 10 Aug copy | Data §3 |
| DA-09 | P1 | BUG | Production has no stale-record cleanup: corrected typos and removed rows survive forever | Data §4 |
| DA-10 | P1 | BUG | Synopsis months are never removed. Two files resolving to the same month overwrite each other nondeterministically | Data §4 |
| REL-01 | P1 | BUG | Unhandled async error terminates the process (proven). 14 handlers have no try/catch | Reliability §3 |
| REL-02 | P1 | BUG | No sync lock (cron overlap, manual + cron, multiple instances). The manpower cleanup race can wipe the synced dates | Reliability §2 |
| REL-03 | P1 | BUG | Synopsis month write is three non-atomic steps. A failure leaves a month with a total but no records | Reliability §2 |
| REL-04 | P1 | BUG | Email scheduler has no claim/lock: duplicate sends on slow sends, restarts, or a second instance | Reliability §2 |
| REL-09 | P1 | BUG | A bad parse mid-edit deletes the last valid data (dispatch `$nor`, synopsis replace). Only an all-empty parse is guarded | Reliability §2 |
| SEC-02 | P1 | SEC | `email_verified` is not checked; the admin role is granted by email string match | Security §2 |
| SEC-03 | P1 | SEC | No OAuth `state`: login CSRF, and an attacker's Drive token can be planted via the connect callback | Security §2 |
| SEC-08 | P1\* | SEC | `JWT_SECRET` / `TOKEN_ENCRYPTION_KEY` fall back to public dev strings if unset (\*P0 if unset on Render) | Security §3 |
| UX-01 | P1 | UX | Live "Synced N min ago" badge over frozen figures; no "data as of" anywhere | Reliability §6 |
| DA-07 | P2 | DQ | The sheet's own `From 1st` cells are stale for Nov 2025 (both tabs) and several RIL months | Data §3 |
| DA-11 | P2 | BR | Opening balances: first-day cumulative with a blank increment is never counted (e.g. 97 MT L&T cutting, 1 Dec 2025). RIL final coat increments 4,506 vs cumulative 4,564 | Data §5 |
| DA-12 | P2 | BUG | The suspicious-increment guard zeroes genuine day-one / post-reset increments (latent: 0 hits today) | Data §4 |
| DA-14 | P2 | BUG | Dispatch parser silently ignores numeric text, negatives, and `Grand/Sub Total` labels (latent) | Data §4 |
| DA-15 | P2 | BR | Two definitions of "completed": latest cumulative (targets) vs sum of increments (everything else) | Data §5 |
| DA-16 | P2 | BUG | "Today" and default ranges are computed in UTC, so 00:00–05:30 IST shows yesterday | Data §5 |
| DA-19 | P2 | DEBT | `bulkWrite` skips schema validation; the enum/min "DB boundary" check in CLAUDE.md does not exist | Data §4 |
| REL-05 | P2 | BUG | Sync status carries no signal: routine notes make every run `partial`; no per-source counts | Reliability §5 |
| REL-06 | P2 | BUG | The Manpower step isn't isolated, so one exception skips production, dispatch and synopsis | Reliability §2 |
| REL-07 | P2 | BUG | No timeouts on Drive or Gemini calls; a hung download never finishes | Reliability §2 |
| REL-08 | P2 | PERF | Every file is re-downloaded and every synopsis month rewritten every 10 min, even when unchanged | Reliability §7 |
| REL-10 | P2 | BUG | A crash mid-sync leaves a `running` SyncLog; the badge then shows "Awaiting first sync" | Reliability §5 |
| REL-11 | P2 | BUG | Malformed AI output is cached for 24 h and crashes the Dashboard render (no error boundary) | Reliability §4 |
| SEC-04 | P2 | SEC | Cross-site POST (SameSite=None cookie) can disconnect Drive or trigger syncs | Security §2 |
| SEC-05 | P2 | SEC | 20 MB JSON bodies are parsed on `/api/email/*` before authentication | Security §4 |
| SEC-07 | P2 | SEC | The role is frozen in the JWT for 12 h; removed admins keep admin rights | Security §3 |
| SEC-09 | P2 | SEC | `xlsx` 0.18.5 prototype pollution / ReDoS (no npm fix); `nodemailer` high (fix available) | Security §5 |
| PERF-01 | P2 | PERF | SyncLog grows ~144 docs/day with no index on `startedAt`, and every open tab polls it every 60 s | Reliability §7 |
| PERF-02 | P2 | PERF | Rate limit 300 / 15 min **per IP**: an office behind one NAT exhausts it at ~20 open tabs | Reliability §7 |
| UX-02 | P2 | UX | Overview has no error state and no 401 handling; failures render as rows of dashes | Reliability §6 |
| DA-13 | P3 | BUG | Any row with ≥3 numbers in 40000–60000 is treated as a date header (latent) | Data §4 |
| DA-17 | P3 | BUG | API without `businessUnit` merges HSD and BU categories (the UI always sends one) | Data §5 |
| DA-18 | P3 | UX | "Dispatched by client" excludes unmapped projects, so the chart doesn't add up to the KPI | Data §5 |
| DA-20 | P3 | BUG | 5 s workbook cache: tabs in one sync can come from two different downloads | Reliability §2 |
| DA-21 | P3 | BR | AFCONS, AMNS-Bhilai and Utility Bridge-Bhilai progress tabs exist but are not synced | Data §5 |
| SEC-10 | P3 | SEC | Socket.IO is unauthenticated: anyone can receive sync events | Security §4 |
| SEC-11 | P3 | SEC | Internal error text and Drive IDs are returned to clients | Security §4 |
| SEC-12 | P3 | SEC | Plant figures are sent to Gemini (no PII; `store:false`) | Security §6 |
| SEC-13 | P3 | SEC | No CSP on the Vercel client | Security §4 |
| UX-03…08 | P3 | UX | See Reliability §6 (badge hidden for PC user, labels, TZ rendering, a11y) | Reliability §6 |
| DEBT-01 | P3 | DEBT | Dead code: `TargetPanel`, `ProductionClientChart`, `listSheetTitles`, `/dashboard/manpower` + `fetchManpowerRecords`, server `axios`, `nodemon`, `EMAIL_APP_PASSWORD` | Fix plan |
| DEBT-02 | P3 | DEBT | CLAUDE.md is git-ignored, and five of its statements are inaccurate (listed below) | Fix plan |
| DEBT-03 | P3 | PERF | Client ships one 1.05 MB JS chunk (no route splitting) | Reliability §7 |

### CLAUDE.md statements the audit found to be wrong

| Claim | Reality |
|---|---|
| "Mongoose schemas give the enum constraints that catch parser drift at the DB boundary" | Not for Manpower, Production or Dispatch: `bulkWrite updateOne` never validates (DA-19). |
| §7.3 "L&T MHI and RIL genuinely reset their running totals" | For L&T MHI the "reset" on 1 Dec 2025 is the tab switching from RIL data to MHI data (DA-01). RIL does have two genuine mid-2025 decreases. |
| §8.1 "Each source is wrapped so one failure cannot cost the others their sync" | The Manpower step is not wrapped (REL-06). |
| §8.2 "only a fresh sign-in loads a new snapshot" | Any page reload does. The cache is in memory. |
| §5.2 "Settings — Drive connection, targets" | Settings has no targets UI; `TargetPanel` is not rendered anywhere. |

---

## 5. Source data issues to fix in Drive (not code)

These are reported, not corrected. Each needs the sheet owner.

| # | Workbook / tab | Cell / location | Problem |
|---|---|---|---|
| S-1 | Live workbook · L&T MHI Progress | Blocks at rows 8–71 (May–Nov 2025), client cell `RIL` | RIL data in the L&T MHI tab (DA-01) |
| S-2 | `Dispach Jan 2026.xlsx` | Department header, column 31 | `22.06.26` should be `22.01.26` (DA-03) |
| S-3 | Live workbook · Manpower | Header rows 140 / 156 | 11-Mar in Feb's table, 10-Feb in Mar's table (§9.1, DA-08) |
| S-4 | Live workbook · RIL Progress | Jan 2026 block trailing columns | Dated 02-02, 02-03 (1 Feb skipped); values differ from the Feb block's for the same days (DA-06) |
| S-5 | Live workbook · L&T MHI / RIL | `From 1st to till now`, Nov 2025 block (and RIL Jan–Mar 2026) | Stale formula range; disagrees with the row's own per-day average (DA-07) |
| S-6 | `Dispatch June 2026.xlsx` | Buyout total row, 12.06.26 | 147.039 MT with zero department rows (known §9.3) |
| S-7 | Jan/Feb/Mar synopsis | "Ramboll Domestic" row | Confirm it is a different department from Ramboll Export (BR-2) |
