import crypto from 'node:crypto';
import mongoose from 'mongoose';
import * as drive from './googleSheets.service.js';
import { parseManpowerSheet } from './parsers/manpowerParser.js';
import { parseProgressSheet } from './parsers/productionParser.js';
import { parseDispatchSheet } from './parsers/dispatchParser.js';
import { parseSynopsisSheet } from './parsers/synopsisParser.js';
import { ManpowerRecord } from '../models/ManpowerRecord.js';
import { ProductionRecord } from '../models/ProductionRecord.js';
import { DispatchRecord } from '../models/DispatchRecord.js';
import { SynopsisMonth } from '../models/SynopsisMonth.js';
import { SynopsisDispatchRecord } from '../models/SynopsisDispatchRecord.js';
import { SyncLog } from '../models/SyncLog.js';
import { SyncLock } from '../models/SyncLock.js';
import { env } from '../config/env.js';

const PROGRESS_TABS = [
  { title: 'Adani Progress', client: 'Adani' },
  { title: 'L&T MHI Progress', client: 'L&T MHI' },
  { title: 'RIL Progress', client: 'RIL' },
];

const DISPATCH_TABS = ['Daily Dispatch'];

// A cleanup step only runs when the new parse is at least this large a share of what it would
// replace. The live workbook is edited all day, and a sync that lands while someone has a
// header row half-deleted parses a fraction of the sheet; before this gate, the cleanup that
// followed deleted everything that fraction did not contain. Row moves and new days do not
// shrink a parse, so they are unaffected.
const MIN_KEPT_SHARE = 0.7;
// A synopsis month is only replaced by a workbook reporting at least half the tonnage already
// stored for it. Corrections are routine; a month losing half its dispatch is not.
const MIN_SYNOPSIS_SHARE = 0.5;

export class SyncInProgressError extends Error {
  constructor() {
    super('A sync is already running. Try again when it finishes.');
    this.name = 'SyncInProgressError';
  }
}

// ---------------------------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------------------------

const LOCK_ID = 'hsd-sync';
// Longer than any healthy sync (every Drive call now times out at 60 s), so a lease held by a
// process that died mid-run frees itself without anyone intervening.
const LOCK_TTL_MS = 30 * 60 * 1000;

async function acquireLock(holder) {
  const now = new Date();
  try {
    const lock = await SyncLock.findOneAndUpdate(
      { _id: LOCK_ID, lockedUntil: { $lt: now } },
      { $set: { holder, lockedUntil: new Date(now.getTime() + LOCK_TTL_MS) } },
      { upsert: true, returnDocument: 'after' },
    );
    return lock?.holder === holder;
  } catch (err) {
    // The lease exists and has not expired: the upsert tried to insert a second document with
    // the same _id.
    if (err?.code === 11000) return false;
    throw err;
  }
}

async function releaseLock(holder) {
  await SyncLock.updateOne({ _id: LOCK_ID, holder }, { $set: { lockedUntil: new Date(0) } });
}

// ---------------------------------------------------------------------------------------------
// Log helpers
// ---------------------------------------------------------------------------------------------

function note(log, tab, message, severity) {
  log.issues.push({ tab, message, severity });
}

function writeStats(result) {
  const inserted = result?.upsertedCount || 0;
  const updated = result?.modifiedCount || 0;
  const unchanged = Math.max((result?.matchedCount || 0) - updated, 0);
  return { inserted, updated, unchanged };
}

// Mongoose's bulkWrite casts updateOne operations but never validates them, so the schemas'
// enum and min constraints were not being applied to Manpower, Production or Dispatch at all.
// Each record is validated here instead. A record that fails is not stored, and the run says
// so as an error rather than letting a negative count or an unknown stage into the totals.
function validateRecords(Model, records, log, tab) {
  const valid = [];
  const problems = [];
  for (const record of records) {
    const error = new Model(record).validateSync();
    if (error) problems.push(error.message);
    else valid.push(record);
  }
  if (problems.length > 0) {
    note(log, tab, `${problems.length} record(s) failed validation and were not stored — first: ${problems[0]}`, 'error');
  }
  return valid;
}

// ---------------------------------------------------------------------------------------------
// Live workbook sources
// ---------------------------------------------------------------------------------------------

async function syncManpowerTab(workbook, log) {
  const started = Date.now();
  const tab = 'Manpower';
  const { records, warnings } = parseManpowerSheet(workbook.getSheetValues(tab));
  warnings.forEach((w) => note(log, tab, w, 'warning'));
  const valid = validateRecords(ManpowerRecord, records, log, tab);

  // Never return silently: an empty parse keeps the existing data, and says so.
  if (valid.length === 0) {
    note(log, tab, 'No manpower figures could be read from the sheet this run — the figures already stored were kept.', 'error');
    log.sources.push({ name: tab, fileId: workbook.fileId, modifiedTime: workbook.modifiedTime, durationMs: Date.now() - started, ok: false });
    return;
  }

  const parsedDates = [...new Set(valid.map((rec) => rec.date.getTime()))].map((t) => new Date(t));
  const storedBefore = await ManpowerRecord.countDocuments({ date: { $in: parsedDates } });

  // One timestamp for the whole run, so "not touched by this parse" is a simple comparison
  // below rather than a per-record bookkeeping exercise. (Safe because the sync lock guarantees
  // no other run is writing at the same time.)
  const syncedAt = new Date();
  const ops = valid.map((rec) => ({
    updateOne: {
      filter: { date: rec.date, businessUnit: rec.businessUnit, category: rec.category, shift: rec.shift },
      update: { $set: { ...rec, syncedAt } },
      upsert: true,
    },
  }));
  const stats = writeStats(await ManpowerRecord.bulkWrite(ops, { ordered: false }));
  log.rowsUpserted += stats.inserted + stats.updated;

  // The uniqueness key includes `shift`, so a day re-read under a different shift layout does
  // not overwrite what was stored before — it lands beside it. The last day of every month
  // used to be recorded once with no shift at all; it is now correctly split into day/night/
  // 12.30, and without this the old shift-less record would survive and be summed on top of
  // the new ones, counting that day roughly twice. The same applies whenever a category is
  // renamed or dropped from the sheet.
  //
  // Only the days this parse actually covered are touched, so history the sheet no longer
  // reaches back to is left alone.
  let deleted = 0;
  if (valid.length < storedBefore * MIN_KEPT_SHARE) {
    note(
      log,
      tab,
      `This run read ${valid.length} manpower figures for days that already held ${storedBefore}. That is too large a drop to trust, so nothing was removed — if the sheet was mid-edit, the next sync will tidy up.`,
      'error',
    );
  } else {
    const stale = await ManpowerRecord.deleteMany({ date: { $in: parsedDates }, syncedAt: { $lt: syncedAt } });
    deleted = stale.deletedCount;
    if (deleted > 0) {
      note(log, tab, `Removed ${deleted} stale record(s) that the current sheet no longer accounts for — most likely a day whose shift columns changed shape since a previous sync.`, 'info');
    }
  }

  log.sources.push({ name: tab, fileId: workbook.fileId, modifiedTime: workbook.modifiedTime, parsed: valid.length, ...stats, deleted, durationMs: Date.now() - started });
  log.tabsProcessed.push(tab);
}

async function syncProductionTabs(workbook, log) {
  const started = Date.now();
  const byKey = new Map();
  let everyTabRead = true;

  for (const tab of PROGRESS_TABS) {
    try {
      const { records, warnings } = parseProgressSheet(workbook.getSheetValues(tab.title), tab.client, tab.title);
      warnings.forEach((w) => note(log, tab.title, w, 'warning'));
      if (records.length === 0) everyTabRead = false;

      // A block can now be recorded under a client other than its tab's (L&T MHI's tab holds
      // blocks headed "RIL" for May–Nov 2025), so two tabs can produce the same
      // date + client + stage key. Where they agree — the case today, since those blocks are
      // copies of the RIL tab — one record is stored. Where they disagree, the figure from the
      // client's own tab is kept and the disagreement reported.
      for (const record of records) {
        const key = `${record.date.toISOString()}|${record.client}|${record.processStage}`;
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, record);
          continue;
        }
        const differs = existing.cumulativeQty !== record.cumulativeQty || existing.dailyIncrementQty !== record.dailyIncrementQty;
        const recordIsHome = PROGRESS_TABS.find((t) => t.title === record.sourceTab)?.client === record.client;
        const kept = recordIsHome ? record : existing;
        if (differs) {
          const other = kept === record ? existing : record;
          note(
            log,
            'Production',
            `${record.date.toISOString().slice(0, 10)} ${record.client} ${record.processStage}: "${kept.sourceTab}" says ${kept.cumulativeQty}/${kept.dailyIncrementQty} but "${other.sourceTab}" says ${other.cumulativeQty}/${other.dailyIncrementQty} — using "${kept.sourceTab}".`,
            'warning',
          );
        }
        byKey.set(key, kept);
      }
      log.tabsProcessed.push(tab.title);
    } catch (err) {
      everyTabRead = false;
      note(log, tab.title, err.message, 'error');
    }
  }

  const valid = validateRecords(ProductionRecord, [...byKey.values()], log, 'Production');
  if (valid.length === 0) {
    note(log, 'Production', 'No production figures could be read this run — the figures already stored were kept.', 'error');
    log.sources.push({ name: 'Production', fileId: workbook.fileId, modifiedTime: workbook.modifiedTime, durationMs: Date.now() - started, ok: false });
    return;
  }

  const times = valid.map((r) => r.date.getTime());
  const span = { $gte: new Date(Math.min(...times)), $lte: new Date(Math.max(...times)) };
  const storedBefore = await ProductionRecord.countDocuments({ date: span });

  const syncedAt = new Date();
  const ops = valid.map((rec) => ({
    updateOne: {
      filter: { date: rec.date, client: rec.client, processStage: rec.processStage },
      update: { $set: { ...rec, syncedAt } },
      upsert: true,
    },
  }));
  const stats = writeStats(await ProductionRecord.bulkWrite(ops, { ordered: false }));
  log.rowsUpserted += stats.inserted + stats.updated;

  // Production had no cleanup at all. Its key is layout-independent, but a date header typed
  // wrong and then corrected, a stage renamed, or a block re-attributed to its real client
  // (the RIL-headed blocks above) all leave the old document behind — summed into every total
  // forever. Anything in the span this parse covers that the parse did not write is removed,
  // but only when every tab was read and the parse is not suspiciously smaller than what it
  // replaces.
  let deleted = 0;
  if (!everyTabRead) {
    note(log, 'Production', 'Not every progress tab could be read this run, so no old production records were removed.', 'warning');
  } else if (valid.length < storedBefore * MIN_KEPT_SHARE) {
    note(
      log,
      'Production',
      `This run read ${valid.length} production records for a span that already held ${storedBefore}. That is too large a drop to trust, so nothing was removed.`,
      'error',
    );
  } else {
    const stale = await ProductionRecord.deleteMany({ date: span, syncedAt: { $lt: syncedAt } });
    deleted = stale.deletedCount;
    if (deleted > 0) {
      note(log, 'Production', `Removed ${deleted} production record(s) the current sheet no longer contains (a corrected date, a renamed stage, or a block now recorded under its own client).`, 'info');
    }
  }

  log.sources.push({ name: 'Production', fileId: workbook.fileId, modifiedTime: workbook.modifiedTime, parsed: valid.length, ...stats, deleted, durationMs: Date.now() - started });
}

async function syncDispatchTab(workbook, tabTitle, log) {
  const started = Date.now();
  const { records, warnings, notes } = parseDispatchSheet(workbook.getSheetValues(tabTitle), tabTitle);
  warnings.forEach((w) => note(log, tabTitle, w, 'warning'));
  notes.forEach((n) => note(log, tabTitle, n, 'info'));
  const valid = validateRecords(DispatchRecord, records, log, tabTitle);

  if (valid.length === 0) {
    note(log, tabTitle, 'No dispatch figures could be read this run — the figures already stored were kept.', 'error');
    log.sources.push({ name: tabTitle, fileId: workbook.fileId, modifiedTime: workbook.modifiedTime, durationMs: Date.now() - started, ok: false });
    return;
  }

  const storedBefore = await DispatchRecord.countDocuments({ sourceTab: tabTitle });
  const syncedAt = new Date();
  const ops = valid.map((rec) => ({
    updateOne: {
      filter: { sourceTab: rec.sourceTab, sourceRowIndex: rec.sourceRowIndex, date: rec.date },
      update: { $set: { ...rec, syncedAt } },
      upsert: true,
    },
  }));
  const stats = writeStats(await DispatchRecord.bulkWrite(ops, { ordered: false }));
  log.rowsUpserted += stats.inserted + stats.updated;

  // Unlike Manpower/Production (keyed by date+category, which self-heals every sync no
  // matter where in the sheet that data now sits), this collection's uniqueness key
  // includes sourceRowIndex — and the sheet's row layout shifts as it's live-edited (a
  // project's row moves down when rows are inserted above it). A sync only ever upserts
  // the rows it currently sees, so it can't tell "this row moved" from "this is new" —
  // the record at the row's old position is left behind, silently double-counted in every
  // total forever. Deleting anything for this tab that the current parse didn't just
  // touch keeps the DB an exact mirror of the sheet, closing that gap for good.
  //
  // A moved row keeps the parse the same size, so the gate below does not get in its way; a
  // parse that has lost a third of the tab has not moved rows, it has failed to read them.
  let deleted = 0;
  if (valid.length < storedBefore * MIN_KEPT_SHARE) {
    note(
      log,
      tabTitle,
      `This run read ${valid.length} dispatch records where ${storedBefore} were stored. That is too large a drop to trust, so nothing was removed — if the sheet was mid-edit, the next sync will tidy up.`,
      'error',
    );
  } else {
    const deleteResult = await DispatchRecord.deleteMany({ sourceTab: tabTitle, syncedAt: { $lt: syncedAt } });
    deleted = deleteResult.deletedCount;
    if (deleted > 0) {
      note(log, tabTitle, `Removed ${deleted} stale record(s) left behind by a row position that shifted since a previous sync.`, 'info');
    }
  }

  log.sources.push({ name: tabTitle, fileId: workbook.fileId, modifiedTime: workbook.modifiedTime, parsed: valid.length, ...stats, deleted, durationMs: Date.now() - started });
  log.tabsProcessed.push(tabTitle);
}

// ---------------------------------------------------------------------------------------------
// Monthly synopsis folder
// ---------------------------------------------------------------------------------------------

function isTransactionUnsupported(err) {
  return err?.code === 20 || /replica set|Transaction numbers/i.test(err?.message || '');
}

// Runs the writes in a transaction where the server supports one (Atlas always does). A local
// standalone mongod does not, so there the same writes run in order without one — the parse
// has already been checked, so the only thing lost is protection against a crash mid-write.
async function runAtomically(work) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => work(session));
  } catch (err) {
    if (!isTransactionUnsupported(err)) throw err;
    await work(undefined);
  } finally {
    await session.endSession();
  }
}

// Each monthly workbook is replaced wholesale rather than upserted row by row. A month's
// figures are only ever restated as a whole (a correction to the 3rd is typed into the same
// file days later), and rewriting the month is the only thing that also removes a day that
// was deleted from the sheet — an upsert-only pass would leave it behind for good.
//
// The three writes used to be independent: a failure after the delete (a duplicate-key
// rejection, a dropped connection, a crash) left the month with a total and no daily records.
// They now commit together or not at all.
async function writeSynopsisMonth(file, parsed, log) {
  const tab = `Synopsis/${file.name}`;
  const dispatchedTotal = parsed.departments.reduce((sum, d) => sum + d.dispatched, 0);
  const dailyTotal = parsed.daily.reduce((sum, d) => sum + d.qty, 0);
  if (Math.abs(dailyTotal - dispatchedTotal) > 0.01) {
    note(log, tab, `Parsed daily records (${dailyTotal.toFixed(3)} MT) do not add up to the month's total (${dispatchedTotal.toFixed(3)} MT) — the month was not updated.`, 'error');
    return false;
  }

  const existing = await SynopsisMonth.findOne({ month: parsed.month }).select('dispatchedTotal').lean();
  if (existing?.dispatchedTotal > 0 && dispatchedTotal < existing.dispatchedTotal * MIN_SYNOPSIS_SHARE) {
    note(
      log,
      tab,
      `${parsed.month} would drop from ${existing.dispatchedTotal.toFixed(3)} MT to ${dispatchedTotal.toFixed(3)} MT. That is too large a drop to trust, so the stored month was kept — if the workbook really was corrected this far, it will need a manual check.`,
      'error',
    );
    return false;
  }

  const syncedAt = new Date();
  await runAtomically(async (session) => {
    await SynopsisMonth.findOneAndUpdate(
      { month: parsed.month },
      {
        $set: {
          month: parsed.month,
          plannedTotal: parsed.plannedTotal,
          dispatchedTotal,
          coveredDates: parsed.coveredDates,
          departments: parsed.departments.map((d) => ({
            department: d.department,
            sourceLabel: d.sourceLabel,
            category: d.category,
            mode: d.mode,
            planned: d.planned,
            dispatched: d.dispatched,
            recordedDays: d.recordedDays,
          })),
          towers: parsed.towers.map((t) => ({
            model: t.model,
            heightM: t.heightM,
            towerNos: t.towerNos,
            cipNos: t.cipNos,
            weightMt: t.weightMt,
            remarks: t.remarks,
          })),
          sourceFile: file.name,
          sourceFileId: file.id,
          warnings: parsed.warnings,
          syncedAt,
        },
      },
      { upsert: true, session },
    );
    await SynopsisDispatchRecord.deleteMany({ month: parsed.month }, { session });
    if (parsed.daily.length > 0) {
      await SynopsisDispatchRecord.insertMany(
        parsed.daily.map((d) => ({
          date: d.date,
          month: d.month,
          department: d.department,
          sourceLabel: d.sourceLabel,
          category: d.category,
          mode: d.mode,
          qty: d.qty,
          sourceFile: d.sourceFile,
          syncedAt,
        })),
        { ordered: true, session },
      );
    }
  });

  log.rowsUpserted += parsed.daily.length;
  log.tabsProcessed.push(`Synopsis/${parsed.month}`);
  return true;
}

async function syncSynopsisFolder(log, sources) {
  const started = Date.now();
  // Never return silently. A sync that skips this step without saying so reports plain
  // "success" while the Dispatch Synopsis view stays empty, and there is then nothing
  // anywhere — badge, log or database — explaining why.
  if (!env.synopsisFolderId) {
    note(log, 'Synopsis', 'SYNOPSIS_FOLDER_ID is empty, so the monthly synopsis workbooks were skipped.', 'error');
    return;
  }

  let files;
  try {
    files = await sources.listFolderWorkbooks(env.synopsisFolderId);
  } catch (err) {
    note(log, 'Synopsis', `Could not list the synopsis folder ${env.synopsisFolderId}: ${err.message}. Check the account connected for Drive sync can open that folder.`, 'error');
    return;
  }

  if (files.length === 0) {
    note(log, 'Synopsis', `The synopsis Drive folder ${env.synopsisFolderId} returned no files — it is empty, or not shared with the account connected for Drive sync.`, 'error');
    return;
  }

  // Every workbook is read before anything is written, so the month each one reports on is
  // known up front. One bad workbook must not cost the others their sync, so each is caught on
  // its own.
  const parsedFiles = [];
  let everyFileRead = true;
  for (const file of files) {
    const tab = `Synopsis/${file.name}`;
    try {
      const parsed = parseSynopsisSheet(await sources.getWorkbookRows(file.id, file.mimeType), file.name);
      parsed.warnings.forEach((w) => note(log, tab, w, 'warning'));
      if (!parsed.month) {
        everyFileRead = false;
        note(log, tab, 'Could not determine which month this workbook reports on — skipped.', 'error');
        continue;
      }
      parsedFiles.push({ file, parsed });
    } catch (err) {
      everyFileRead = false;
      note(log, tab, err.message, 'error');
    }
  }

  // Two workbooks resolving to the same month (a re-uploaded copy, "april (1).xlsx") used to
  // overwrite each other in whatever order Drive listed them, so the month could flip between
  // syncs. The most recently modified one is used, and the other is named.
  const byMonth = new Map();
  for (const entry of parsedFiles) {
    const current = byMonth.get(entry.parsed.month);
    if (!current) {
      byMonth.set(entry.parsed.month, entry);
      continue;
    }
    const newer = new Date(entry.file.modifiedTime) > new Date(current.file.modifiedTime) ? entry : current;
    const older = newer === entry ? current : entry;
    note(log, 'Synopsis', `"${newer.file.name}" and "${older.file.name}" both report on ${entry.parsed.month}; using "${newer.file.name}", the more recently modified. Remove the other from the folder.`, 'warning');
    byMonth.set(entry.parsed.month, newer);
  }

  let written = 0;
  for (const { file, parsed } of byMonth.values()) {
    try {
      if (await writeSynopsisMonth(file, parsed, log)) written += 1;
    } catch (err) {
      note(log, `Synopsis/${file.name}`, err.message, 'error');
    }
  }

  // A month whose workbook has left the folder used to stay on the dashboard forever. It is
  // removed once every workbook in the folder has been read successfully — never after a run
  // in which any file failed, because a month missing from a failed run is not gone.
  let removedMonths = 0;
  if (everyFileRead) {
    const orphans = await SynopsisMonth.find({ month: { $nin: [...byMonth.keys()] } }).select('month sourceFile').lean();
    if (orphans.length > 0) {
      const months = orphans.map((o) => o.month);
      await SynopsisDispatchRecord.deleteMany({ month: { $in: months } });
      await SynopsisMonth.deleteMany({ month: { $in: months } });
      removedMonths = orphans.length;
      note(log, 'Synopsis', `Removed ${orphans.map((o) => `${o.month} (${o.sourceFile})`).join(', ')} — no workbook in the folder reports on ${orphans.length === 1 ? 'that month' : 'those months'} any more.`, 'info');
    }
  }

  log.sources.push({ name: 'Synopsis', parsed: parsedFiles.length, inserted: written, deleted: removedMonths, durationMs: Date.now() - started, ok: written > 0 });
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

async function step(log, name, work) {
  try {
    await work();
  } catch (err) {
    note(log, name, err.message, 'error');
    log.sources.push({ name, ok: false });
  }
}

// Where the sheets come from. Always Google Drive in the app; the tests pass in-memory
// workbooks so the whole sync — lock, writes, cleanup, gates — runs against a real MongoDB
// without touching Drive.
const driveSources = {
  openLiveWorkbook: drive.openLiveWorkbook,
  listFolderWorkbooks: drive.listFolderWorkbooks,
  getWorkbookRows: drive.getWorkbookRows,
};

export async function runSync(trigger = 'manual', sources = driveSources) {
  const holder = `${process.pid}-${crypto.randomUUID()}`;
  if (!(await acquireLock(holder))) throw new SyncInProgressError();

  const log = new SyncLog({ trigger, tabsProcessed: [], issues: [], sources: [], status: 'running' });
  try {
    await log.save();
    // A run whose process died stays 'running' forever and the badge reads "Awaiting first
    // sync". Nothing else can be running while this run holds the lock, so any such log is
    // abandoned.
    await SyncLog.updateMany(
      { status: 'running', _id: { $ne: log._id } },
      {
        $set: { status: 'failed', finishedAt: new Date() },
        $push: { issues: { tab: 'sync', message: 'Abandoned — the server stopped before this run finished.', severity: 'error' } },
      },
    );

    // Each source is isolated: one failing costs only itself. The Manpower step used to have
    // no guard, so its failure skipped production, dispatch and the separate synopsis folder.
    let workbook = null;
    try {
      workbook = await sources.openLiveWorkbook();
    } catch (err) {
      note(log, 'Live workbook', `Could not download the live workbook: ${err.message}`, 'error');
    }
    if (workbook) {
      await step(log, 'Manpower', () => syncManpowerTab(workbook, log));
      await step(log, 'Production', () => syncProductionTabs(workbook, log));
      for (const tab of DISPATCH_TABS) {
        await step(log, tab, () => syncDispatchTab(workbook, tab, log));
      }
    }
    await step(log, 'Synopsis', () => syncSynopsisFolder(log, sources));

    const hasErrors = log.issues.some((i) => i.severity === 'error');
    const anySourceOk = log.sources.some((s) => s.ok);
    log.status = !hasErrors ? 'success' : anySourceOk ? 'partial' : 'failed';
  } catch (err) {
    log.status = 'failed';
    note(log, 'sync', err.message, 'error');
  } finally {
    log.finishedAt = new Date();
    try {
      await log.save();
    } finally {
      await releaseLock(holder);
    }
  }
  return log;
}
