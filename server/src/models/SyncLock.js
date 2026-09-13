import mongoose from 'mongoose';

// A single lease document that says a sync is running. It lives in the database, not in memory,
// because the sync can be started from more than one process at once — the cron on Render, a
// manual "Sync now", a deploy that briefly overlaps the old instance, or a laptop running
// `npm run dev` against the same database. Two overlapping syncs are not merely wasteful: one
// run's manpower cleanup can delete every record the other just wrote (RELIABILITY_REPORT REL-02).
const syncLockSchema = new mongoose.Schema({
  _id: { type: String },
  holder: { type: String, required: true },
  lockedUntil: { type: Date, required: true },
});

export const SyncLock = mongoose.model('SyncLock', syncLockSchema);
