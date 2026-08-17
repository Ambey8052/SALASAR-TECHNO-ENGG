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
