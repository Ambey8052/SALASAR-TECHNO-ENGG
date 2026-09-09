import { getSheetValues, listFolderWorkbooks, getWorkbookRows } from './googleSheets.service.js';
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
import { env } from '../config/env.js';

const PROGRESS_TABS = [
  { title: 'Adani Progress', client: 'Adani' },
  { title: 'L&T MHI Progress', client: 'L&T MHI' },
  { title: 'RIL Progress', client: 'RIL' },
];

const DISPATCH_TABS = ['Daily Dispatch'];

async function syncManpowerTab(log) {
  const rows = await getSheetValues('Manpower');
  const { records, warnings } = parseManpowerSheet(rows);
  warnings.forEach((w) => log.issues.push({ tab: 'Manpower', message: w }));

  if (records.length === 0) {
    log.tabsProcessed.push('Manpower');
    return;
  }

  // One timestamp for the whole run, so "not touched by this parse" is a simple comparison
  // below rather than a per-record bookkeeping exercise.
  const syncedAt = new Date();

  const ops = records.map((rec) => ({
    updateOne: {
      filter: { date: rec.date, businessUnit: rec.businessUnit, category: rec.category, shift: rec.shift },
      update: { $set: { ...rec, syncedAt } },
      upsert: true,
    },
  }));

  const result = await ManpowerRecord.bulkWrite(ops, { ordered: false });
  log.rowsUpserted += (result.upsertedCount || 0) + (result.modifiedCount || 0);

  // The uniqueness key includes `shift`, so a day re-read under a different shift layout does
  // not overwrite what was stored before — it lands beside it. The last day of every month
  // used to be recorded once with no shift at all; it is now correctly split into day/night/
  // 12.30, and without this the old shift-less record would survive and be summed on top of
  // the new ones, counting that day roughly twice. The same applies whenever a category is
  // renamed or dropped from the sheet.
  //
  // Only the days this parse actually covered are touched, so history the sheet no longer
  // reaches back to is left alone.
  const parsedDates = [...new Set(records.map((rec) => rec.date.getTime()))].map((t) => new Date(t));
  const stale = await ManpowerRecord.deleteMany({ date: { $in: parsedDates }, syncedAt: { $lt: syncedAt } });
  if (stale.deletedCount > 0) {
    log.issues.push({
      tab: 'Manpower',
      message: `Removed ${stale.deletedCount} stale record(s) that the current sheet no longer accounts for — most likely a day whose shift columns changed shape since a previous sync.`,
    });
  }

  log.tabsProcessed.push('Manpower');
}

async function syncProgressTab(tabTitle, client, log) {
  try {
    const rows = await getSheetValues(tabTitle);
    const { records, warnings } = parseProgressSheet(rows, client, tabTitle);
    warnings.forEach((w) => log.issues.push({ tab: tabTitle, message: w }));

    if (records.length > 0) {
      const ops = records.map((rec) => ({
        updateOne: {
          filter: { date: rec.date, client: rec.client, processStage: rec.processStage },
          update: { $set: { ...rec, syncedAt: new Date() } },
          upsert: true,
        },
      }));
      const result = await ProductionRecord.bulkWrite(ops, { ordered: false });
      log.rowsUpserted += (result.upsertedCount || 0) + (result.modifiedCount || 0);
    }
    log.tabsProcessed.push(tabTitle);
  } catch (err) {
    log.issues.push({ tab: tabTitle, message: err.message });
  }
}

async function syncDispatchTab(tabTitle, log) {
  try {
    const rows = await getSheetValues(tabTitle);
    const { records, warnings } = parseDispatchSheet(rows, tabTitle);
    warnings.forEach((w) => log.issues.push({ tab: tabTitle, message: w }));

    if (records.length > 0) {
      const ops = records.map((rec) => ({
        updateOne: {
          filter: { sourceTab: rec.sourceTab, sourceRowIndex: rec.sourceRowIndex, date: rec.date },
          update: { $set: { ...rec, syncedAt: new Date() } },
          upsert: true,
        },
      }));
      const result = await DispatchRecord.bulkWrite(ops, { ordered: false });
      log.rowsUpserted += (result.upsertedCount || 0) + (result.modifiedCount || 0);

      // Unlike Manpower/Production (keyed by date+category, which self-heals every sync no
      // matter where in the sheet that data now sits), this collection's uniqueness key
      // includes sourceRowIndex — and the sheet's row layout shifts as it's live-edited (a
      // project's row moves down when rows are inserted above it). A sync only ever upserts
      // the rows it currently sees, so it can't tell "this row moved" from "this is new" —
      // the record at the row's old position is left behind, silently double-counted in every
      // total forever. Deleting anything for this tab that the current parse didn't just
      // touch keeps the DB an exact mirror of the sheet, closing that gap for good.
      const currentPairs = records.map((rec) => ({ sourceRowIndex: rec.sourceRowIndex, date: rec.date }));
      const deleteResult = await DispatchRecord.deleteMany({
        sourceTab: tabTitle,
        $nor: currentPairs,
      });
      if (deleteResult.deletedCount > 0) {
        log.issues.push({
          tab: tabTitle,
          message: `Removed ${deleteResult.deletedCount} stale record(s) left behind by a row position that shifted since a previous sync.`,
        });
      }
    }
    log.tabsProcessed.push(tabTitle);
  } catch (err) {
    log.issues.push({ tab: tabTitle, message: err.message });
  }
}

// Each monthly workbook is replaced wholesale rather than upserted row by row. A month's
// figures are only ever restated as a whole (a correction to the 3rd is typed into the same
// file days later), and rewriting the month is the only thing that also removes a day that
// was deleted from the sheet — an upsert-only pass would leave it behind for good.
async function syncSynopsisMonth(file, log) {
  const rows = await getWorkbookRows(file.id, file.mimeType);
  const parsed = parseSynopsisSheet(rows, file.name);
  parsed.warnings.forEach((w) => log.issues.push({ tab: `Synopsis/${file.name}`, message: w }));

  if (!parsed.month) {
    log.issues.push({ tab: `Synopsis/${file.name}`, message: 'Could not determine which month this workbook reports on — skipped.' });
    return;
  }

  const dispatchedTotal = parsed.departments.reduce((sum, d) => sum + d.dispatched, 0);

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
        syncedAt: new Date(),
      },
    },
    { upsert: true },
  );

  await SynopsisDispatchRecord.deleteMany({ month: parsed.month });
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
        syncedAt: new Date(),
      })),
      { ordered: false },
    );
  }

  log.rowsUpserted += parsed.daily.length;
  log.tabsProcessed.push(`Synopsis/${parsed.month}`);
}

async function syncSynopsisFolder(log) {
  // Never return silently. A sync that skips this step without saying so reports plain
  // "success" while the Dispatch Synopsis view stays empty, and there is then nothing
  // anywhere — badge, log or database — explaining why.
  if (!env.synopsisFolderId) {
    log.issues.push({ tab: 'Synopsis', message: 'SYNOPSIS_FOLDER_ID is empty, so the monthly synopsis workbooks were skipped.' });
    return;
  }

  let files;
  try {
    files = await listFolderWorkbooks(env.synopsisFolderId);
  } catch (err) {
    log.issues.push({
      tab: 'Synopsis',
      message: `Could not list the synopsis folder ${env.synopsisFolderId}: ${err.message}. Check the account connected for Drive sync can open that folder.`,
    });
    return;
  }

  if (files.length === 0) {
    log.issues.push({
      tab: 'Synopsis',
      message: `The synopsis Drive folder ${env.synopsisFolderId} returned no files — it is empty, or not shared with the account connected for Drive sync.`,
    });
    return;
  }

  // One bad workbook must not cost the others their sync, so each is caught on its own.
  for (const file of files) {
    try {
      await syncSynopsisMonth(file, log);
    } catch (err) {
      log.issues.push({ tab: `Synopsis/${file.name}`, message: err.message });
    }
  }
}

export async function runSync(trigger = 'manual') {
  const log = new SyncLog({ trigger, tabsProcessed: [], issues: [], status: 'running' });
  await log.save();

  try {
    await syncManpowerTab(log);
    for (const tab of PROGRESS_TABS) {
      await syncProgressTab(tab.title, tab.client, log);
    }
    for (const tab of DISPATCH_TABS) {
      await syncDispatchTab(tab, log);
    }
    await syncSynopsisFolder(log);

    log.status = log.issues.length > 0 ? 'partial' : 'success';
  } catch (err) {
    log.status = 'failed';
    log.issues.push({ tab: 'sync', message: err.message });
  }

  log.finishedAt = new Date();
  await log.save();
  return log;
}
