# Test Plan

Part of the [13 Sep 2026 audit](AUDIT_REPORT.md).

## 1. Approach

- **No framework install.** Use Node's built-in `node:test` + `node:assert` (Node 24 is already the runtime). Add one script, `"test": "node --test test/"`, to `server/package.json`. This matches the "no test runner" constraint in spirit: no dependency, no config.
- **Fixtures are small hand-built row arrays** (array-of-arrays, exactly what `sheet_to_json({header:1})` returns), committed under `server/test/fixtures/`. Keep real workbooks out of the repo: they are business-confidential. Each fixture reproduces the *shape* of a real incident with made-up numbers.
- **Parsers and payload builders are pure**, so roughly 80% of the value needs no database.
- **Sync semantics** (upsert, cleanup, locks, atomicity) need a real MongoDB. Use `mongodb-memory-server` as a devDependency, or a disposable Atlas database. **Never production.**
- **Reconciliation against real workbooks** stays in the `check:*` scripts and runs locally or in CI with a downloaded copy. The two audit probes become `check:production` and `check:dispatch` (FIX_PLAN F-0).
- **Every fix in FIX_PLAN lands with the regression test named in its row.** Write the test first and watch it fail against the current code.

## 2. Priority order (highest value first)

| # | Suite | Type | Needs DB |
|---|---|---|---|
| 1 | Regression tests for the confirmed bugs (§3) | unit | no |
| 2 | Parser contract tests (§4) | unit | no |
| 3 | Calculation tests (§5) | unit (pure builders) | no |
| 4 | Sync semantics (§6) | integration | memory server |
| 5 | Auth / authorization / API validation (§7) | integration (supertest-style via `fetch` on an ephemeral port) | memory server |
| 6 | Reconciliation scripts on real files (§8) | offline check | no |

## 3. Regression tests: one per confirmed defect

| Test | Fixture shape | Assert |
|---|---|---|
| `production: block client cell overrides tab` (DA-01) | L&T tab containing one block labelled `RIL` and one labelled `MHI` | No `L&T MHI` records from the RIL block (or a warning, depending on BR-1) |
| `production: cross-tab identical data is reported` (DA-01) | Same block in two tabs | Sync-level warning names both tabs and the date span |
| `synopsis: Ramboll Domestic ≠ Ramboll Export` (DA-02) | Both rows with the same date | Two distinct departments; `Σ daily == Σ departments` |
| `synopsis: parser never emits a duplicate key` (DA-02) | Two labels folding to one department | Warning, and quantities **summed**, never dropped |
| `synopsis: day column outside the month is rejected` (DA-03) | January header containing `22.06.26` | No record dated June; warning cites the column; `coveredDates` all in January |
| `synopsis: "ZETWERK (Job)" → Job Work` (DA-04) | That label, no Mode column | category `Job Work`, mode `Job Work` |
| `dispatch: Bhilai block tagged BU` (DA-05) | HSD block + "Bhilai – … (AMNS & Utility Bridge)" block | BU records separated; HSD sum excludes them |
| `production: overlapping next-month column` (DA-06) | Jan block with trailing `02-02`, Feb block with a different `02-02` | Exactly one record for 02-02 per BR-5, and a warning when the values differ |
| `manpower: date in two blocks` (DA-08, existing) | Feb block containing 11-Mar | Warning, as today |
| `manpower checker: last-write-wins view` (§7 blind spot) | Same | The checker's day comparison fails for that date |
| `production: suspicious guard spares day one` (DA-12) | First tracked day: cumulative 120, increment 120 | Increment kept |
| `dispatch: Grand/Sub Total rows skipped` (DA-14) | Rows labelled `Grand Total`, `Sub-Total` | No records |
| `dispatch/production: numeric text warned` (DA-14) | `"12.5"` in a date column | Warning (value handling per decision) |
| `today uses IST` (DA-16) | Clock fixed to 2026-09-13T20:00Z (= 14 Sep 01:30 IST) | "today" = 2026-09-14 |

## 4. Parser contract tests

For each of the four parsers:
- **Header discovery:** block moved to another row or column; weekday row present or absent; ≥3 date serials; a data row with three numbers in 40000–60000 is **not** a header (DA-13).
- **Summary rows:** manpower averages table below the daily table (whole-number average `11`), per §7.2 rule 2; synopsis `Total` / `Sub-Total :-` / `Grand-Total` in the Sr. No or Mode column; May's tower `TOTAL` sharing rows.
- **Month-end stride:** the last date of a manpower block keeps Night and 12.30 (§7.2 rule 1).
- **Values:** blank vs `0` (synopsis `recordedDays`); decimals; negatives; `"-"` placeholders; non-integer manpower averages dropped.
- **Unknown labels:** unmatched stage, category or client produce a warning (after the fix), never silence.
- **Empty or structurally broken input** returns `records: []` plus a warning, never throws.
- **Purity:** the same input twice gives deep-equal output (no `Date.now()`).

## 5. Calculation tests (pure builders)

- `weightedHeadcount` semantics: day 10 + night 6 + 12.30 4 → 18. A shift-less record weighs 1.
- Manpower average excludes days with no records.
- Completed production = Σ finalCoat increments; a range straddling a cumulative decrease is unaffected.
- Month boundary: `to=2026-02-28` includes 28 Feb 23:59:59.999Z and excludes 1 Mar.
- `buildSynopsisPayload`:
  - range pro-rating: 10 of 20 covered days → factor 0.5;
  - a month the range does not touch is out of scope;
  - `kpis.dispatched == Σ daily == Σ byDepartment == Σ byMode == Σ byCategory`;
  - `monthlyTrend` equals the KPI for a whole month once records are complete.
- `roundDeep` leaves `Date` alone; rounding happens after summing (0.1 + 0.2 → 0.3).
- Extract the dashboard pipelines into a pure `buildHsdSummaryFromRecords(records, range)` (or test through the memory server) so production and dispatch sums can be asserted without Atlas.

## 6. Sync semantics (memory server)

| Test | Assert |
|---|---|
| Sync the same parse 10× | Document counts unchanged; `updatedAt` only moves when the value changes |
| Row moved (dispatch `sourceRowIndex` +3) | Old doc deleted, one doc remains |
| Stage renamed (production) | Old stage doc removed (after DA-09) |
| Date header corrected (production) | Doc under the wrong date removed |
| Synopsis file removed from folder | Its month is removed or marked orphaned (DA-10) |
| Two files resolve to the same month | Warning; deterministic winner |
| **Concurrent syncs** (start two `runSync` at once) | Second gets "already running"; manpower count unchanged (REL-02) |
| **Interleaving from the manpower race table** (inject a delay between write and cleanup) | No deletion of the other run's writes |
| Insert failure after delete (stub `insertMany` to throw) | Previous month records intact (REL-03) |
| Parse loses 60% of dispatch rows | Cleanup refused, status `partial`, old data kept (REL-09) |
| Manpower step throws | Production, dispatch and synopsis still run (REL-06) |
| Routine notes only | Status `success` (REL-05) |
| Email scheduler: two ticks overlap / two instances | Each email sent exactly once (REL-04); a stale `sending` record is not resent |

## 7. Auth, authorization, API

- **JWT:** no cookie → 401; forged / `alg:none` / tampered / expired → 401. These were verified manually in the audit and should be automated.
- **Role matrix:** a manager token against every admin or email route returns 403. This is the full matrix from SECURITY_REPORT §4, looped.
- **Login:** a non-company `hd` is rejected; `email_verified:false` is rejected (stub `verifyIdToken`); a callback without a matching `state` is rejected.
- **CSRF:** a state-changing POST with a foreign `Origin` returns 403.
- **Validation:** invalid `from`/`to` → 400 (not epoch); malformed ObjectId → 400; **the process is still alive** afterwards (REL-01 regression: request, then `/health`).
- **Body limit:** 20 MB unauthenticated POST to `/api/email/send` is rejected before parsing.
- **Insights:** a stubbed Gemini response missing `insights` is not cached and returns 503.

## 8. Reconciliation (real workbooks, offline)

Run before every deploy that touches `services/parsers/`, `sync.service.js` or a controller:

```bash
npm run check:manpower   -- <live workbook>
npm run check:synopsis   -- <synopsis folder>
npm run check:production -- <live workbook>   # from scripts/audit/reconcileProduction.js
npm run check:dispatch   -- <live workbook>   # from scripts/audit/reconcileDispatch.js
```

**Exit criteria:** zero failures, except source-data issues already listed in AUDIT_REPORT §5, each with an owner.

After deploy, run the read-only DB reconciliation (FIX_PLAN F-0). It compares production MongoDB against a fresh parse of the same workbook and closes the DB and Dashboard columns of the reconciliation table.

## 9. Frontend (manual checklist until needed otherwise)

- Overview with the API down shows an error state, not dashes.
- Expired session returns to /login.
- "Figures as of" matches the sync that produced them.
- The newer-data banner appears after a sync.
- Keyboard-only: open and close a chart modal, focus returns to the card.
- 400 px width: no horizontal page scroll.
