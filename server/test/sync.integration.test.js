import './helpers/env.js';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { runSync, SyncInProgressError } from '../src/services/sync.service.js';
import { runDueScheduledEmails } from '../src/jobs/emailScheduler.js';
import { ManpowerRecord } from '../src/models/ManpowerRecord.js';
import { ProductionRecord } from '../src/models/ProductionRecord.js';
import { DispatchRecord } from '../src/models/DispatchRecord.js';
import { SynopsisMonth } from '../src/models/SynopsisMonth.js';
import { SynopsisDispatchRecord } from '../src/models/SynopsisDispatchRecord.js';
import { SyncLog } from '../src/models/SyncLog.js';
import { ScheduledEmail } from '../src/models/ScheduledEmail.js';
import { progressBlock, dispatchBlock, manpowerBlock, synopsisTable, day } from './helpers/sheets.js';

// A real MongoDB (in memory, single-node replica set so transactions work) — never the database
// in server/.env, which test/helpers/env.js points at an address nothing listens on.
let replSet;
before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'sync-tests' });
  await mongoose.connection.syncIndexes();
});
after(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

// --- sources ------------------------------------------------------------------------------

const NOV = ['2025-11-28', '2025-11-29', '2025-11-30'];
const rilBlock = () => progressBlock('RIL', NOV, [
  { label: 'Cutting', pairs: [[100, 10], [120, 20], [125, 5]] },
  { label: 'Final Coat', pairs: [[50, 5], [60, 10], [62, 2]] },
]);

function liveTabs(overrides = {}) {
  return {
    Manpower: manpowerBlock(['2026-08-29', '2026-08-30', '2026-08-31'], [
      [1, 'HSD Fab. MNP', 10, 5, 4, 11, 6, 2, 12, 7, 8],
      [2, 'HSD Paint MNP', 3, 1, 0, 3, 1, 0, 4, 2, 1],
    ]),
    'Adani Progress': progressBlock('ADANI', ['2026-08-01', '2026-08-02', '2026-08-03'], [
      { label: 'Cutting', pairs: [[10, 1], [12, 2], [15, 3]] },
      { label: 'Final Coat', pairs: [[5, 1], [6, 1], [8, 2]] },
    ]),
    // May–Nov 2025 shape: the L&T MHI tab holds a copy of RIL's block, headed "RIL".
    'L&T MHI Progress': [
      ...rilBlock(),
      ...progressBlock('MHI', ['2025-12-01', '2025-12-02', '2025-12-03'], [{ label: 'Final Coat', pairs: [[0, 0], [7, 7], [9, 2]] }]),
    ],
    'RIL Progress': rilBlock(),
    'Daily Dispatch': [
      ...dispatchBlock('HSD - August Month Dispatch Summary (RIL and MHI & ADANI)', ['2026-08-03', '2026-08-04', '2026-08-05'], [
        ['Reliance (Bridge 1B)', 10, 20, 30],
        ['ADANI', 5, 6, 7],
        ['MHI PROJECT', 1, 2, 3],
      ]),
      ...dispatchBlock('Bhilai - August Month Dispatch Summary (AMNS & Utility Bridge)', ['2026-08-03', '2026-08-04', '2026-08-05'], [['AMNS', 21, '-', '-']]),
    ],
    ...overrides,
  };
}

const JAN = synopsisTable(['01.01.26', '02.01.26', '03.01.26'], [
  ['Solar', 500, 100, 110, 120],
  ['Ramboll Domestic', 200, 40, 0, 30],
  ['Ramboll Export', 100, 20, 25, null],
]);
const FEB = synopsisTable(['01.02.26', '02.02.26', '03.02.26'], [['Solar', 500, 90, 95, 99]]);

function sources({ tabs = liveTabs(), files = { jan: JAN, feb: FEB }, failing = [] } = {}) {
  return {
    openLiveWorkbook: async () => ({
      fileId: 'live-file',
      modifiedTime: new Date('2026-09-10T08:00:00Z'),
      getSheetValues: (title) => {
        if (tabs[title] instanceof Error) throw tabs[title];
        return tabs[title] ?? [];
      },
    }),
    listFolderWorkbooks: async () =>
      Object.keys(files).map((id) => ({ id, name: `${id}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', modifiedTime: '2026-09-12T08:00:00Z' })),
    getWorkbookRows: async (id) => {
      if (failing.includes(id)) throw new Error(`download of ${id} failed`);
      return files[id];
    },
  };
}

const counts = async () => ({
  manpower: await ManpowerRecord.countDocuments(),
  production: await ProductionRecord.countDocuments(),
  dispatch: await DispatchRecord.countDocuments(),
  months: await SynopsisMonth.countDocuments(),
  synopsis: await SynopsisDispatchRecord.countDocuments(),
});
const errors = (log) => log.issues.filter((i) => i.severity === 'error');

// --- sync ---------------------------------------------------------------------------------

describe('sync', () => {
  test('syncing unchanged sources ten times stores exactly the same documents', async () => {
    const first = await runSync('manual', sources());
    assert.equal(first.status, 'success', JSON.stringify(errors(first)));
    const baseline = await counts();
    assert.deepEqual(baseline, { manpower: 18, production: 6 + 6 + 3, dispatch: 10, months: 2, synopsis: 10 });
    for (let i = 0; i < 9; i += 1) await runSync('cron', sources());
    assert.deepEqual(await counts(), baseline);
  });

  // DA-01
  test('RIL-headed blocks in the L&T MHI tab are stored once, under RIL', async () => {
    await runSync('manual', sources());
    const nov = { date: { $gte: day('2025-11-01'), $lte: day('2025-11-30') } };
    assert.equal(await ProductionRecord.countDocuments({ ...nov, client: 'L&T MHI' }), 0);
    assert.equal(await ProductionRecord.countDocuments({ ...nov, client: 'RIL' }), 6);
    const finalCoat = await ProductionRecord.aggregate([{ $match: { processStage: 'finalCoat', client: 'RIL' } }, { $group: { _id: null, t: { $sum: '$dailyIncrementQty' } } }]);
    assert.equal(finalCoat[0].t, 17, 'counted once, not twice');
  });

  // DA-09: production had no cleanup at all.
  test("a production record the sheet no longer contains is removed, inside the parsed span only", async () => {
    await ProductionRecord.create([
      { date: day('2025-11-29'), client: 'L&T MHI', processStage: 'finalCoat', cumulativeQty: 60, dailyIncrementQty: 10, sourceTab: 'L&T MHI Progress', syncedAt: new Date('2026-01-01') },
      { date: day('2020-01-01'), client: 'Adani', processStage: 'cutting', cumulativeQty: 1, dailyIncrementQty: 1, sourceTab: 'Adani Progress', syncedAt: new Date('2020-01-02') },
    ]);
    const log = await runSync('manual', sources());
    assert.equal(await ProductionRecord.countDocuments({ client: 'L&T MHI', date: day('2025-11-29') }), 0);
    assert.equal(await ProductionRecord.countDocuments({ date: day('2020-01-01') }), 1, 'history outside the sheet is left alone');
    assert.ok(log.issues.some((i) => /Removed 1 production record/.test(i.message)));
  });

  // DA-05
  test('Bhilai dispatch is stored as BU, not HSD', async () => {
    await runSync('manual', sources());
    assert.equal(await DispatchRecord.countDocuments({ businessUnit: 'BU' }), 1);
    const hsd = await DispatchRecord.aggregate([{ $match: { businessUnit: { $ne: 'BU' } } }, { $group: { _id: null, t: { $sum: '$qty' } } }]);
    assert.equal(hsd[0].t, 84);
  });

  // REL-02
  test('two syncs at once: one runs, the other is refused, nothing is lost', async () => {
    await runSync('manual', sources());
    const results = await Promise.allSettled([runSync('cron', sources()), runSync('manual', sources())]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok(results.find((r) => r.status === 'rejected').reason instanceof SyncInProgressError);
    assert.equal(await ManpowerRecord.countDocuments(), 18);
    // The lock is released afterwards.
    assert.equal((await runSync('manual', sources())).status, 'success');
  });

  // REL-09
  test('a parse that lost most of the dispatch tab does not delete what was stored', async () => {
    await runSync('manual', sources());
    const shrunk = liveTabs({ 'Daily Dispatch': dispatchBlock('HSD - August', ['2026-08-03', '2026-08-04', '2026-08-05'], [['ADANI', 5, '-', '-']]) });
    const log = await runSync('manual', sources({ tabs: shrunk }));
    assert.equal(log.status, 'partial');
    assert.ok(errors(log).some((i) => /too large a drop/.test(i.message)));
    // Every record from the good run is still there (plus the one row the shrunk parse wrote).
    assert.ok((await DispatchRecord.countDocuments()) >= 10);
  });

  test('an ordinary row move still cleans up the old position', async () => {
    await runSync('manual', sources());
    const moved = liveTabs();
    moved['Daily Dispatch'] = [[null], ...moved['Daily Dispatch']];
    await runSync('manual', sources({ tabs: moved }));
    assert.equal(await DispatchRecord.countDocuments(), 10);
  });

  // REL-06
  test('a failing Manpower step does not stop the other sources', async () => {
    const log = await runSync('manual', sources({ tabs: liveTabs({ Manpower: new Error('tab exploded') }) }));
    assert.equal(log.status, 'partial');
    assert.ok(errors(log).some((i) => i.tab === 'Manpower'));
    const c = await counts();
    assert.equal(c.production, 15);
    assert.equal(c.dispatch, 10);
    assert.equal(c.months, 2);
  });

  test('an unreadable live workbook still lets the synopsis folder sync', async () => {
    const src = sources();
    src.openLiveWorkbook = async () => { throw new Error('Drive unavailable'); };
    const log = await runSync('manual', src);
    assert.equal(log.status, 'partial');
    assert.equal(await SynopsisMonth.countDocuments(), 2);
  });

  test('a run whose process died is closed by the next one', async () => {
    const dead = await SyncLog.create({ trigger: 'cron', status: 'running', startedAt: new Date('2026-09-01') });
    await runSync('manual', sources());
    const after = await SyncLog.findById(dead._id).lean();
    assert.equal(after.status, 'failed');
    assert.match(after.issues[0].message, /Abandoned/);
  });
});

describe('synopsis sync', () => {
  // DA-02
  test('every tonne of the workbook is stored, and the month total matches its records', async () => {
    await runSync('manual', sources());
    const jan = await SynopsisMonth.findOne({ month: '2026-01' }).lean();
    const records = await SynopsisDispatchRecord.find({ month: '2026-01' }).lean();
    const stored = records.reduce((s, r) => s + r.qty, 0);
    assert.equal(jan.dispatchedTotal, 445);
    assert.equal(stored, 445);
    assert.deepEqual(new Set(records.map((r) => r.department)), new Set(['Solar', 'Ramboll Domestic', 'Ramboll Export']));
  });

  // DA-10
  test('a month whose workbook left the folder is removed', async () => {
    await runSync('manual', sources());
    await runSync('manual', sources({ files: { jan: JAN } }));
    assert.equal(await SynopsisMonth.countDocuments({ month: '2026-02' }), 0);
    assert.equal(await SynopsisDispatchRecord.countDocuments({ month: '2026-02' }), 0);
  });

  test('…but never after a run in which a workbook failed to download', async () => {
    await runSync('manual', sources());
    const log = await runSync('manual', sources({ files: { jan: JAN, feb: FEB }, failing: ['feb'] }));
    assert.equal(log.status, 'partial');
    assert.equal(await SynopsisMonth.countDocuments({ month: '2026-02' }), 1);
  });

  test('two workbooks for one month: the newer is used and the clash reported', async () => {
    const src = sources({ files: { jan: JAN, janCopy: synopsisTable(['01.01.26', '02.01.26', '03.01.26'], [['Solar', 500, 1, 1, 1]]) } });
    const list = src.listFolderWorkbooks;
    src.listFolderWorkbooks = async () => (await list()).map((f) => ({ ...f, modifiedTime: f.id === 'jan' ? '2026-09-12T09:00:00Z' : '2026-09-01T09:00:00Z' }));
    const log = await runSync('manual', src);
    assert.equal((await SynopsisMonth.findOne({ month: '2026-01' }).lean()).sourceFile, 'jan.xlsx');
    assert.ok(log.issues.some((i) => /both report on 2026-01/.test(i.message)));
  });

  test('a month that would lose more than half its tonnage is kept', async () => {
    await runSync('manual', sources());
    const tiny = synopsisTable(['01.01.26', '02.01.26', '03.01.26'], [['Solar', 500, 1, 1, 1]]);
    const log = await runSync('manual', sources({ files: { jan: tiny, feb: FEB } }));
    assert.equal((await SynopsisMonth.findOne({ month: '2026-01' }).lean()).dispatchedTotal, 445);
    assert.ok(errors(log).some((i) => /too large a drop/.test(i.message)));
  });
});

// --- email scheduler ---------------------------------------------------------------------

describe('email scheduler', () => {
  const email = (subject, extra = {}) => ({
    from: 'pc.hsd@salasartechno.com', to: ['client@example.com'], subject, bodyHtml: '<p>x</p>',
    sendAt: new Date(Date.now() - 1000), createdByEmail: 'pc.hsd@salasartechno.com', ...extra,
  });

  // REL-04
  test('overlapping ticks send each due email exactly once', async () => {
    await ScheduledEmail.create([email('a'), email('b'), email('c')]);
    const sent = [];
    const slowSend = async (mail) => {
      await new Promise((r) => setTimeout(r, 30));
      sent.push(mail.subject);
    };
    await Promise.all([runDueScheduledEmails(slowSend), runDueScheduledEmails(slowSend), runDueScheduledEmails(slowSend)]);
    assert.deepEqual(sent.sort(), ['a', 'b', 'c']);
    assert.equal(await ScheduledEmail.countDocuments({ status: 'sent' }), 3);
  });

  test('a Gmail refusal is retried later; a dropped connection is not retried', async () => {
    const [refused, dropped] = await ScheduledEmail.create([email('refused'), email('dropped', { sendAt: new Date(Date.now() - 500) })]);
    await runDueScheduledEmails(async (mail) => {
      if (mail.subject === 'refused') throw Object.assign(new Error('backend error'), { response: { status: 503 } });
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    });
    await runDueScheduledEmails(async () => { throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); });
    assert.equal((await ScheduledEmail.findById(refused._id)).status, 'failed', 'retried once, then the dropped connection ended it');
    assert.equal((await ScheduledEmail.findById(refused._id)).attempts, 2);
    assert.equal((await ScheduledEmail.findById(dropped._id)).attempts, 1);
    assert.equal((await ScheduledEmail.findById(dropped._id)).status, 'failed');
  });

  test('a claim left by a process that died becomes "unknown" and is not resent', async () => {
    await ScheduledEmail.create(email('orphan', { status: 'sending', claimedAt: new Date(Date.now() - 60 * 60 * 1000) }));
    let calls = 0;
    await runDueScheduledEmails(async () => { calls += 1; });
    assert.equal(calls, 0);
    assert.equal((await ScheduledEmail.findOne({ subject: 'orphan' })).status, 'unknown');
  });
});
