import { getSheetValues } from './googleSheets.service.js';
import { parseManpowerSheet } from './parsers/manpowerParser.js';
import { parseProgressSheet } from './parsers/productionParser.js';
import { parseDispatchSheet } from './parsers/dispatchParser.js';
import { ManpowerRecord } from '../models/ManpowerRecord.js';
import { ProductionRecord } from '../models/ProductionRecord.js';
import { DispatchRecord } from '../models/DispatchRecord.js';
import { SyncLog } from '../models/SyncLog.js';

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

  const ops = records.map((rec) => ({
    updateOne: {
      filter: { date: rec.date, businessUnit: rec.businessUnit, category: rec.category, shift: rec.shift },
      update: { $set: { ...rec, syncedAt: new Date() } },
      upsert: true,
    },
  }));

  const result = await ManpowerRecord.bulkWrite(ops, { ordered: false });
  log.rowsUpserted += (result.upsertedCount || 0) + (result.modifiedCount || 0);
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

    log.status = log.issues.length > 0 ? 'partial' : 'success';
  } catch (err) {
    log.status = 'failed';
    log.issues.push({ tab: 'sync', message: err.message });
  }

  log.finishedAt = new Date();
  await log.save();
  return log;
}
