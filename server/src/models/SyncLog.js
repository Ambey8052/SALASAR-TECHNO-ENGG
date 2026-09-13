import mongoose from 'mongoose';

// severity: 'error' — a source could not be synced, or its data was deliberately kept back;
//           'warning' — synced, but the source itself has a problem someone should fix;
//           'info' — routine and expected (stale rows cleaned up, vehicle blocks skipped).
// Only errors affect the run's status. Before severities existed, every routine note made every
// run 'partial', so 'partial' carried no signal at all.
const issueSchema = new mongoose.Schema(
  {
    tab: String,
    message: String,
    severity: { type: String, enum: ['error', 'warning', 'info'], default: 'warning' },
  },
  { _id: false },
);

// One entry per source read in the run, so "what did this sync actually do" can be answered from
// the log alone: which file, which version of it, and how many rows went in, changed or went out.
const sourceSchema = new mongoose.Schema(
  {
    name: String,
    fileId: { type: String, default: null },
    modifiedTime: { type: Date, default: null },
    parsed: { type: Number, default: 0 },
    inserted: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    unchanged: { type: Number, default: 0 },
    deleted: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    ok: { type: Boolean, default: true },
  },
  { _id: false },
);

const syncLogSchema = new mongoose.Schema(
  {
    startedAt: { type: Date, required: true, default: Date.now },
    finishedAt: { type: Date },
    status: { type: String, enum: ['running', 'success', 'partial', 'failed'], default: 'running' },
    trigger: { type: String, enum: ['cron', 'manual'], required: true },
    tabsProcessed: [{ type: String }],
    rowsUpserted: { type: Number, default: 0 },
    issues: [issueSchema],
    sources: [sourceSchema],
  },
  { timestamps: true },
);

// The badge asks for the latest run from every open tab once a minute.
syncLogSchema.index({ startedAt: -1 });
// A run every 10 minutes is ~144 logs a day; keep six months of history.
syncLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export const SyncLog = mongoose.model('SyncLog', syncLogSchema);
