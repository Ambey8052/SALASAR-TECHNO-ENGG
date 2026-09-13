# Data Accuracy Report

Part of the [13 Sep 2026 audit](AUDIT_REPORT.md). Every figure here can be reproduced with:

```bash
cd server
npm run check:synopsis -- <folder of monthly xlsx>
npm run check:manpower -- <live workbook.xlsx>
node scripts/audit/reconcileProduction.js <live workbook.xlsx>
node scripts/audit/reconcileDispatch.js   <live workbook.xlsx>
node scripts/audit/simulateSynopsisSync.js <folder of monthly xlsx>
```

**Source snapshot used:** `HSD Projects Progress Sheet-2025.xlsx` (saved 10 Aug 2026) and `Dispach Jan 2026.xlsx` … `Dispatch Aug 2026.xlsx` (downloaded 7–12 Sep 2026), all from `C:\Users\ambey\Downloads`. The production database and the live dashboard were **not** queried. The DB/API columns below are computed by replaying the sync's write rules and the controllers' formulas over the parsed records.

---

## 1. Verdict by data source

| Source | Parser vs sheet | Stored (after key collisions) vs sheet | Verdict |
|---|---|---|---|
| Adani Progress | 36/36 stage-months match `From 1st`; final coat 3,999 = cumulative 3,999 | Same | **Correct** |
| L&T MHI Progress | Parses faithfully, but 7 months of the tab are RIL's data | 1,070 records duplicate RIL; 5 records overwritten | **Wrong: double count (DA-01)** |
| RIL Progress | Mostly faithful; overlapping trailing columns | 10 records overwritten by conflicting values | **Ambiguous (DA-06)** |
| Daily Dispatch | 40/40 rows match `Total Dispatch` | Same | **Correct per row, but includes Bhilai (DA-05)** |
| Manpower | 459/459 day totals match the raw grid | 10 Feb / 11 Mar keep one of two figures | **Correct except the known §9.1 source error** |
| Dispatch Synopsis Apr–Aug | Every department matches its cumulative, balance and achieved-% cells | Same | **Correct** |
| Dispatch Synopsis Jan–Mar | Matches the sheet | 272.7 MT rejected by the unique index; 22 Jun collision | **Wrong: data loss (DA-02, DA-03)** |

---

## 2. Traceability matrix — every number on the dashboard

`UT` = untraceable to a single source cell without the DB. Rows marked ⚠ are affected by a finding.

| Dashboard figure (component) | Workbook → tab → cells | Parser → record field | Collection · identity key | Calculation (controller) | API field |
|---|---|---|---|---|---|
| Manpower today (`StatCard`, Dashboard) | Live · `Manpower` · today's date column × Day/Night/12.30 × HSD/BU category rows (numbered Sr. No rows only) | `manpowerParser` → `count`, `shift` | `ManpowerRecord` · date+businessUnit+category+shift | `Σ count × (shift=mid ? ½ : 1)` over **UTC** today (DA-16) | `manpower.today` |
| Manpower by category (`ManpowerCategoryChart`) | Same | Same | Same | Per category: mean over days *that have records* of the day's weighted sum | `manpower.byCategory[]` |
| Manpower on site trend (`ManpowerTrendChart`) | Same | Same | Same | Weighted sum per date × category | `manpower.trendByCategory[]` |
| ⚠ Completed production till final coat (`StatCard`) | Live · `Adani / L&T MHI / RIL Progress` · `Final Coat` row · the increment column right of each date | `productionParser` → `dailyIncrementQty` | `ProductionRecord` · date+client+processStage | `Σ dailyIncrementQty` where stage=finalCoat, date in range | `production.completedInRange` |
| ⚠ Production by process stage (`ProductionStageChart`) | Same tabs · all six stage rows | Same | Same | `Σ dailyIncrementQty` per stage × client | `production.byStageByClient[]` |
| ⚠ Final-coat completions trend (`ProductionTrendChart`) | Same · Final Coat row | Same | Same | `Σ dailyIncrementQty` per date × client (finalCoat) | `production.trendByClient[]`, `byClient[]` |
| ⚠ Dispatched (last recorded day) (`StatCard`) | Live · `Daily Dispatch` · each project row × date column (MT) | `dispatchParser` → `qty`, `client` via regex on project | `DispatchRecord` · sourceTab+sourceRowIndex+date | Latest date with any record, `Σ qty` (**ignores the selected range**) | `dispatch.lastRecordedDay` |
| ⚠ Dispatched (range) (`StatCard`) | Same | Same | Same | `Σ qty` in range, including unmapped and Bhilai rows | `dispatch.inRange` |
| ⚠ Dispatched by client (`DispatchClientChart`) | Same | Same | Same | `Σ qty` per client, **excluding** client=null | `dispatch.byClient[]` |
| ⚠ Dispatch day by day (`DispatchTrendChart`) | Same | Same | Same | `Σ qty` per date × client (null → "Other") | `dispatch.trendByClient[]` |
| Target vs completed (not rendered; sent to Gemini) | `Target` collection (typed by admin) + latest finalCoat `cumulativeQty` | — | `Target` · client | `completed = latest cumulative` (DA-15) | `targets[]` |
| ⚠ Synopsis Planned (`StatCard`) | Synopsis workbook · department table · `Planned` column (Grand-Total row, else Σ rows) | `synopsisParser` → `plannedTotal` | `SynopsisMonth` · month | Σ month plan × pro-rata factor (range: covered days inside ÷ covered days) | `kpis.planned` |
| ⚠ Synopsis Dispatched (`StatCard`) | Synopsis · department rows × `dd.mm.yy` columns | → `daily[].qty` | `SynopsisDispatchRecord` · date+department+mode | `Σ qty` of stored records in scope | `kpis.dispatched` |
| Plan achieved / Balance / Avg per day / Best day | Derived | — | — | `dispatched ÷ planned`; `planned − dispatched`; `dispatched ÷ covered days`; max daily total | `kpis.*` |
| ⚠ Department table and charts | Synopsis · department rows | → canonical `department` (regex fold) | Month doc (plan) + records (actual) | Plan × factor; actual Σ records | `byDepartment[]` |
| Monthly plan vs actual (`MonthlyPlanChart`) | Synopsis · per month | → `dispatchedTotal` = Σ department rows | `SynopsisMonth` | Read as stored (**not** from records, so it disagrees with the KPI when records were dropped) | `monthlyTrend[]` |
| ⚠ Category share (`CategoryShareChart`) | Department label | → `categoryFor(label)` | Records | Σ qty per category | `byCategory[]` |
| AI insights (`InsightsPanel`) | Whole `/hsd/summary` payload | — | `InsightCache` · from+to+BU+client | Gemini narrative; advisory; cached 24 h | `/hsd/insights` |

**Untraceable today:** No figure above can be traced back to its source cell from the database alone. `ProductionRecord` and `ManpowerRecord` store no row index or source label for the stage/client, and `DispatchRecord.sourceRowIndex` goes stale after the next row insertion. Traceability currently depends on re-parsing the workbook, which is what the audit scripts do. FIX_PLAN F-7 adds `sourceRow`, `sourceCol` and `syncBatchId` to every record.

---

## 3. Confirmed defects (reproduced against real source files)

### DA-01 · P0 · L&T MHI tab carries RIL data for May–Nov 2025: double count

| | |
|---|---|
| **Problem** | The `L&T MHI Progress` tab's blocks for May–Nov 2025 carry `RIL` in their own client cell (header column 2). The block header at row 79 (Dec 2025) is the first one that says `MHI`. Those seven months are identical, record for record, to the `RIL Progress` tab. |
| **Root cause** | `productionParser` takes the client from the tab (`PROGRESS_TABS` in `sync.service.js`) and never reads the block's own client cell. The key `date+client+processStage` then treats the same figures as two clients. |
| **Example** | 2025-11-01 cutting: cumulative 2321, increment 12 in both tabs. 1,070 records identical; final coat 2,427 MT counted under both L&T MHI and RIL. |
| **Impact** | "Completed production till final coat" for any range touching May–Nov 2025 is inflated by L&T MHI's copy of RIL. All-time: API **11,439 MT** vs expected **9,012 MT** (+26.9%). Every stage bar and the L&T MHI trend line are wrong for those months. Gemini is fed the inflated figures. CLAUDE.md's "L&T MHI cumulative reset" is this switchover. With the duplicate removed, L&T MHI reconciles exactly (2,934 − 2,427 = 507 = sheet cumulative). |
| **Fix** | Read the block's client cell. Record the client it names and warn when it disagrees with the tab, **or** skip blocks whose client does not match the tab. Which one depends on BR-1. Add a cross-tab duplicate check to the sync warnings. |
| **Risk of fix** | Medium. Historical totals will drop, and managers will notice, so announce it. |

### DA-02 · P0 · "Ramboll Domestic" folded into "Ramboll Export": rows rejected by the unique index

| | |
|---|---|
| **Problem** | `DEPARTMENT_PATTERNS` maps anything containing `ramboll` to `Ramboll Export`, and `CATEGORY_PATTERNS` does the same for the category. Jan, Feb and Mar carry both `Ramboll Domestic` and `Ramboll Export` rows. On days both dispatched, two records share `date+department+mode`. |
| **Root cause** | A canonicalisation rule written for April–August, when only Export existed. `insertMany(ordered:false)` inserts the first row and rejects the second with E11000. The exception is caught per file and logged as an issue, but `SynopsisMonth` was already written with the full total. |
| **Example** | `check:synopsis` flags 14 collisions: Jan 5, Feb 6, Mar 3. The replay drops **103.36 + 124.543 + 44.826 = 272.729 MT**. |
| **Impact** | Dispatch Synopsis "Dispatched" (All months) shows **18,641 MT**, while the Monthly plan-vs-actual chart on the same page shows **19,000 MT**. Month views: Jan 3,095 vs 3,198; Feb 2,364 vs 2,488; Mar 2,255 vs 2,300. The Domestic tonnage is also labelled *Export*. |
| **Fix** | Add a `Ramboll Domestic` department ahead of the generic rule, plus a category (BR-2). Make the parser **refuse** to emit two records with one key: warn and sum, never drop. Make the sync verify `Σ records == dispatchedTotal` per month before committing. |
| **Risk** | Low. |

### DA-03 · P1 · Source header `22.06.26` inside January's workbook

| | |
|---|---|
| **Problem** | Column 31 of the January department table reads `22.06.26`; it should read `22.01.26`. |
| **Root cause** | Source typo. The parser accepts any valid `dd.mm.yy` date and only uses the majority month to *name* the workbook. It never rejects a day column outside that month. |
| **Impact** | (a) 120.211 MT of January dispatch is stored as 22 **June**. (b) January's `coveredDates` includes 22 Jun, so any June date range pulls January in and pro-rates 1/31 of its plan: June planned shows **4,359 MT** instead of **4,230**, with "2 months in scope". (c) Four records collide with June's real 22-Jun records, and whichever file syncs second loses its rows (75.7 or 86.1 MT). (d) The cumulative-pace series counts 22 Jun twice (+306.616 MT; the chart is currently switched off). (e) 22 Jan shows no dispatch. |
| **Fix** | Source: correct the cell. Code: reject day columns outside the workbook's resolved month, with a warning naming the cell. |
| **Risk** | Low. |

### DA-04 · P1 · "ZETWERK (Job)" misclassified

`check:synopsis`: *department "ZETWERK (Job)" fell through every category rule*. Stored as category **Other**, mode **Inhouse**, and as a separate department from `Job Work (Zetwerk)` (Apr/May). January's job-work tonnage therefore sits in "Other" and in the In-house mode total. **Fix:** the pattern `/zetwerk/i` → `Job Work (Zetwerk)`; `inferMode` / `categoryFor` should also match `\(job\)`. Confirm first (BR-3). Risk: low.

### DA-05 · P1 · Bhilai dispatch counted as HSD

| | |
|---|---|
| **Problem** | `Daily Dispatch` interleaves blocks titled "Bhilai – <Month> Dispatch Summary (AMNS & Utility Bridge)" with the HSD blocks (rows 10–15, 27–32, 45–50 in the snapshot). |
| **Root cause** | `dispatchParser` has no business-unit concept, and `buildHsdSummaryData` returns all dispatch for HSD. |
| **Impact** | **197 MT** (AMNS 79, Utility Bridge 118) in HSD "Dispatched" totals and trend. AMNS appears as an HSD client bar; Utility Bridge appears as "Other". Meanwhile Bhilai's own view says dispatch "isn't connected". |
| **Fix** | Detect the block title (the nearest long text row above the header). Tag records `businessUnit`, add it to the key and the queries, and serve BU dispatch in the Bhilai view (BR-4). |
| **Risk** | Medium: changes the HSD totals. |

### DA-06 · P1 · Production blocks overlap the next month: silent last-write-wins

| | |
|---|---|
| **Problem** | Each monthly block also carries columns for the first one to three days of the next month. Those dates are parsed twice, once from each block. |
| **Root cause** | The parser emits every date column; the upsert keeps whichever block is written last. There is no duplicate-key detection in `parseProgressSheet` (unlike manpower's). |
| **Example** | RIL 2026-02-02 cutting: Jan block `4121/12` overwritten by Feb block `4136/15`. RIL 2026-02-03: `4136/15` overwritten by `4136/0`. The Jan block skips 1 Feb and labels its trailing columns 02-02 and 02-03, and the sheet's own Jan total (671) counts them in January. L&T 2025-12-01: `3011/17` (RIL history) overwritten by `97/0`. 15 records in total. |
| **Impact** | Small tonnage (tens of MT), but month totals that can never agree with the sheet's own, and the chosen value depends on block order. |
| **Fix** | Treat a date as belonging to the block whose majority month it is. Ignore or warn on out-of-month trailing columns; always warn on conflicting duplicates (BR-5). |
| **Risk** | Low. |

### DA-07 · P2 · SOURCE DATA ISSUE · stale `From 1st to till now` cells

For **Nov 2025** in both L&T MHI and RIL, the `From 1st` cell disagrees with the row's own increments. The sheet's per-day-average cell × 30 agrees with the increments exactly (cutting 685, fit-up 318, welding 296, blasting 364, final coat 368 vs `From 1st` 418/204/196/151/164). The parser is right and the cell formula is stale.

RIL Jan–Mar 2026 differ by 2–79 MT, and the per-day average agrees with neither side. These are partly explained by DA-06. The residual (e.g. RIL Mar blasting: stored 277, `From 1st` 275, avg × days 306.7) is **UNTRACEABLE** from the snapshot and needs the sheet owner.

### DA-08 · P1 · SOURCE DATA ISSUE · manpower headers (known, §9.1)

Still present in the 10 Aug copy. There are 24 duplicate keys on 10 Feb and 11 Mar; MongoDB keeps one figure of each pair, and 11 Feb / 10 Mar are empty. The sync warns every run. See §7 for a blind spot in the checker.

---

## 4. Parser audit — checklist

✅ handled · ⚠ partial · ❌ not handled · (L) latent: no occurrence in the current data

| Requirement | Manpower | Production | Dispatch | Synopsis |
|---|---|---|---|---|
| No hard-coded rows | ✅ | ✅ | ✅ | ✅ |
| No hard-coded columns | ✅ | ⚠ increment = cumulative + 1 by position | ✅ | ✅ |
| Header detection | ✅ ≥3 serials | ✅ | ✅ | ✅ text labels |
| False header from data (L, DA-13) | ⚠ | ⚠ any 3 numbers in 40000–60000 | ⚠ | n/a |
| Data-row detection | ✅ label regex + Sr. No | ⚠ first string in row must be a stage | ⚠ first string in row = project | ✅ department column |
| Summary / total rows skipped | ✅ Sr. No rule | ✅ (no stage label) | ⚠ only `^total` (misses `Grand Total`, `Sub Total`; DA-14 L) | ✅ Total / Sub-Total / Grand-Total |
| Blank rows | ✅ | ✅ | ✅ | ✅ two-blank rule |
| Merged cells | ⚠ xlsx puts the value in the top-left cell only; the Mode column relies on carry-forward ✅ | ⚠ | ⚠ | ✅ Mode carry-forward |
| Excel serial dates | ✅ UTC | ✅ | ✅ | n/a |
| Text dates | ❌ dropped silently at block level (2025 blocks, accepted §9.2) | ❌ | ❌ | ✅ `dd.mm.yy` only |
| Dates outside the block's month | ⚠ cross-block warning only | ❌ DA-06 | n/a | ❌ DA-03 |
| Formulas | ✅ cached values read | ✅ | ✅ | ✅ |
| Numeric strings (`"12.5"`) | ❌ silent | ❌ silent | ❌ silent | ❌ silent |
| Decimals | ⚠ non-integers **silently dropped** (intentional for averages, but real fractional entries vanish too) | ✅ | ✅ | ✅ |
| Negative values | ⚠ stored (validation off) | ⚠ stored | ⚠ silently skipped | ⚠ silently skipped |
| Missing values | ✅ skipped | ⚠ blank increment → 0 (DA-11) | ✅ | ✅ blank ≠ 0 distinction |
| Unexpected stage / category / client | ❌ unmatched rows skipped silently | ❌ silent | ⚠ client → null / "Other", no warning | ⚠ category "Other" (checker catches it; sync doesn't) |
| Same key twice in one parse | ⚠ date-level warning only | ❌ silent overwrite | n/a | ❌ rejected at insert (DA-02) |
| Warnings instead of silent drops | ⚠ | ❌ only the suspicious-increment guard | ⚠ vehicle blocks only | ✅ strongest |
| Never "success" on an empty parse | ⚠ "No date header rows" warns; a partial parse is not detected | ⚠ | ⚠ | ✅ |

**Suspicious-increment guard (DA-12, latent).** `productionParser.js:40` zeroes any increment ≥ 90% of cumulative (cumulative ≥ 50). That is exactly the shape of a genuine first tracking day, or the first day after a true reset. It produced 0 warnings on the snapshot, but a new client tab would lose its first day. Better: skip the guard when the previous cumulative is blank, 0, or higher than the current one.

**Schema validation (DA-19).** Mongoose 8.24.3 `castBulkWrite.js` runs `$validate()` for `insertOne` and `replaceOne` only. `updateOne` upserts are cast, not validated, so `enum`, `min: 0` and `required` are **not enforced** for Manpower, Production or Dispatch. A new stage alias or a negative figure would be stored without complaint. Fix: `runValidators: true` on each op, or validate in the parser.

---

## 5. Calculation audit

| Metric | Formula (as implemented) | Source fields | Expected | Status |
|---|---|---|---|---|
| Daily production (per stage) | `dailyIncrementQty` as typed | Increment column | Same | ✅ matches the sheet where the source is clean (Adani 36/36) |
| Cumulative production | Not used for totals, correctly. Stages are process states, so **stages are never summed across** | — | — | ✅ No code adds stages together. The stage chart stacks *clients* within a stage, which is valid. |
| Completed production | `Σ dailyIncrementQty`, stage = finalCoat, date in range | Final Coat increment | Same, once per physical tonne | ❌ DA-01 double count; ⚠ DA-06 |
| Stage production | `Σ dailyIncrementQty` per stage | — | — | ❌ DA-01 |
| Client / project production | Per tab = per client | Tab name | Per the block's own client cell | ❌ DA-01 |
| Monthly / partial month | Date-range filter on UTC-midnight dates; `from` 00:00:00Z, `to` 23:59:59.999Z | — | — | ✅ Boundaries are correct for dates written as UTC midnight. |
| Cumulative reset | Summing increments is immune to resets | — | — | ✅ Correct approach. The L&T "reset" is actually DA-01; RIL has two genuine decreases (2025-06-16 blasting, 2025-06-29 welding). |
| Opening balance | A first-day increment that is blank counts as 0 | — | **BUSINESS RULE REQUIRES CONFIRMATION** (BR-6) | ⚠ DA-11: L&T MHI 1 Dec 2025 cutting cumulative 97, increment blank → 97 MT never counted. RIL final coat Σ increments 4,506 vs cumulative 4,564. |
| Target "completed" | Latest `cumulativeQty` (finalCoat) | Cumulative column | **BR-7** | ⚠ DA-15. A different definition from every other "completed"; not displayed; sent to Gemini. |
| Dispatch (range) | `Σ qty` | Project × date cells | HSD only | ❌ DA-05 (+197 MT) |
| Dispatch "last recorded day" | Latest date overall | — | — | ⚠ Ignores the selected range; the label carries the date, so it is defensible |
| Manpower headcount | `day + night + ½ × 12.30` per day | Shift cells | As documented (§7.2) | ✅ 122,340 raw → 120,955 weighted over 258 half-shift entries; checker verified |
| Manpower average | Mean of daily weighted totals over days that **have** records | — | — | ✅ Days without data are excluded, not counted as zero. Confirm this is intended. |
| "Today" | `new Date()` with UTC day bounds | — | IST calendar day | ❌ DA-16. Wrong 00:00–05:30 IST every day; the default range end is also UTC |
| Synopsis planned (range) | Month plan × (covered days in range ÷ covered days) | `Planned` | **BR** (the pro-rating is an invention, documented and labelled in the UI) | ⚠ Honest and labelled, but corrupted by DA-03 |
| Synopsis dispatched | `Σ stored records` | Day cells | `Σ` department rows | ❌ DA-02 / DA-03 |
| Monthly trend dispatched | `SynopsisMonth.dispatchedTotal` | Department rows | Same | ✅, but that means it **disagrees with the KPI** whenever records were dropped |
| Achieved % / balance | Derived | — | — | ✅ formula; inherits the inputs' errors |
| Rounding | `round3` at the controller boundary; client shows 1 dp | — | — | ✅ Once, at the end, never before summing. `Number.EPSILON` nudge is fine. |
| Units | MT everywhere except headcount | — | — | ✅ No conversion anywhere, so none to get wrong |

---

## 6. Source-to-dashboard reconciliation table

"Source" is the figure the workbook itself states or implies. "Parser" is the parse output. "Stored" is the replay of the sync write rules. "API" is the controller formula over stored records. The **DB** and **Dashboard** columns are *not measured* (no production access was used). F-0 in the fix plan measures them.

| # | Metric | Source expected | Parser | Stored (sim.) | API (sim.) | DB | Dashboard | Diff (API − source) | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Adani final coat, all-time | 3,999 (cumulative) | 3,999 | 3,999 | 3,999 | n/m | n/m | 0 | ✅ |
| 2 | Adani stage-months vs `From 1st` | 36 | 36 match | 36 | — | n/m | n/m | 0 | ✅ |
| 3 | L&T MHI final coat, all-time | 507 (cumulative, MHI blocks) | 2,934 | 2,934 | 2,934 | n/m | n/m | **+2,427** | ❌ DA-01 |
| 4 | RIL final coat, all-time | 4,564 (cumulative) | 4,506 | 4,506 | 4,506 | n/m | n/m | −58 | ⚠ UNTRACEABLE / BR-6 |
| 5 | Completed production, all clients, all-time | 9,012 (Σ increments, de-duplicated) | 11,439 | 11,439 | 11,439 | n/m | n/m | **+2,427 (+26.9%)** | ❌ |
| 6 | Production records overwritten by conflicting values | 0 | — | 15 | — | n/m | — | 15 | ❌ DA-06 |
| 7 | Dispatch rows vs `Total Dispatch` | 40 rows | 40 match | 40 | — | n/m | — | 0 | ✅ |
| 8 | HSD dispatch Feb–Aug 2026 | 5,505.786 (HSD blocks) | 5,702.786 | 5,702.786 | 5,702.786 | n/m | n/m | **+197.000** | ❌ DA-05 |
| 9 | Manpower day totals vs raw grid | 459 days | 459 match | 457 + 2 days holding one of two blocks | — | n/m | n/m | 2 days | ❌ DA-08 (source) |
| 10 | Manpower weighted total | 120,955 | 120,955 | ≤ 120,955 (10 Feb / 11 Mar collapsed) | — | n/m | n/m | — | ⚠ |
| 11 | Synopsis dispatched, all months | 19,000.251 | 19,000.251 | 18,641.4 – 18,651.8 | kpis 18,641.4 – 18,651.8 · monthlyTrend 19,000.251 | n/m | n/m | **−348 to −359** | ❌ DA-02/03 |
| 12 | Synopsis Jan 2026 | 3,198.407 | 3,198.407 | 3,019.3 – 3,095.0 | same | n/m | n/m | −103 to −179 | ❌ |
| 13 | Synopsis Feb 2026 | 2,488.370 | 2,488.370 | 2,363.827 | same | n/m | n/m | −124.543 | ❌ |
| 14 | Synopsis Mar 2026 | 2,300.070 | 2,300.070 | 2,255.244 | same | n/m | n/m | −44.826 | ❌ |
| 15 | Synopsis Jun 2026 (month view) | 3,242.812 | 3,242.812 | 3,156.7 – 3,242.8 | same | n/m | n/m | 0 to −86.1 (sync order) | ❌ DA-03 |
| 16 | Synopsis planned, range 1–30 Jun | 4,230 | — | — | 4,359.032 | n/m | n/m | +129.0 | ❌ DA-03 |
| 17 | Synopsis cumulative-pace end, all months | 19,000.251 | — | — | 19,306.867 | n/m | (chart off) | +306.616 | ❌ DA-03 |
| 18 | Synopsis Apr, May, Jul, Aug | per month | match | match | match | n/m | n/m | 0 | ✅ |
| 19 | Synopsis dept cumulative / balance / achieved-% cells | per row | all match | — | — | — | — | 0 | ✅ |

Every mismatch above has an identified cause. None is explained by rounding.

---

## 7. The existing checkers — what they prove and what they miss

**`check:synopsis`** re-adds each department's day columns against the sheet's cumulative, balance and achieved-% cells. It catches category fall-through and `date+department+mode` collisions, and checks the payload's internal sums.
- **It fails today for real reasons** (DA-02, DA-03, DA-04). These are not checker bugs.
- **Gap:** it runs the payload builder over the *parsed* records, not over what the unique index would keep. So it reports the collision but not its effect on the numbers. `simulateSynopsisSync.js` closes that gap.
- **Gap:** it has no check that a day column lies inside its workbook's month. The cumulative-series failure is the only symptom it shows.

**`check:manpower`** re-adds every numeric integer cell per date block and compares both raw and weighted totals. It catches duplicate record keys and dates that appear in two blocks.
- **It fails today only on the known §9.1 source error.**
- **Blind spot:** its day-by-day comparison sums *both* blocks' figures for 10 Feb and 11 Mar on the sheet side and on the parser side. So it prints "459/459 days match", while MongoDB will hold only one of each. The failure is caught only by the separate duplicate-key check. It should compare against a last-write-wins map, like the production probe does.
- **Gap:** it shares the parser's own label and shift helpers (`normalizeManpowerLabel`, `detectShiftLabel`), so a wrong alias would fool both sides equally.

**No checker exists for production or dispatch.** These two carried the largest error found (DA-01) and a 197 MT misattribution (DA-05). The two new audit scripts should become `check:production` and `check:dispatch` (F-0).

---

## 8. Business rules requiring confirmation

| ID | Question | Why it matters | Blocks |
|---|---|---|---|
| BR-1 | Are the May–Nov 2025 blocks in the L&T MHI tab RIL-only, a combined "L&T MHI & RIL" line, or L&T MHI? | Decides whether they are dropped, reassigned to RIL, or kept as a combined client | DA-01 |
| BR-2 | Is "Ramboll Domestic" a separate department from "Ramboll Export"? Which category does it belong to? | Stops 272.7 MT being dropped and mislabelled | DA-02 |
| BR-3 | Is "ZETWERK (Job)" the same line as "Job Work (Zetwerk)" (mode Job Work)? | Mode and category totals | DA-04 |
| BR-4 | Should Bhilai (AMNS, Utility Bridge) dispatch be excluded from HSD and shown under Bhilai? | HSD dispatch totals | DA-05 |
| BR-5 | Which block owns a date that appears in two blocks (a month's trailing columns vs the next month's own)? | Production month totals | DA-06 |
| BR-6 | Is a first-day cumulative with a blank increment an opening balance (exclude) or that day's production (include)? | Up to ~100 MT per stage per client start | DA-11 |
| BR-7 | For targets, is "completed" the latest cumulative or the sum of recorded increments? | The two differ by thousands of MT for L&T MHI today | DA-15 |
| BR-8 | Is the reporting day the IST calendar day? | "Today" figures | DA-16 |
| BR-9 | Should AFCONS, AMNS-Bhilai and Utility Bridge-Bhilai progress tabs be synced? | Bhilai production shows "not connected" while the tabs exist | DA-21 |
| BR-10 | Are the 90% / 50 MT thresholds of the suspicious-increment guard approved? | They can drop real data | DA-12 |
| BR-11 | Manpower 10 Feb / 11 Mar: which figures belong where? (open since §9.1) | Two days of headcount | DA-08 |
| BR-12 | Who may sign in: `@salasartechno.com` only, or a named list? | Security | SEC-01 |
