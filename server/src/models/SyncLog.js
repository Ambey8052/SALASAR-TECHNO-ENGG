import mongoose from 'mongoose';

const syncLogSchema = new mongoose.Schema(
  {
    startedAt: { type: Date, required: true, default: Date.now },
    finishedAt: { type: Date },
    status: { type: String, enum: ['running', 'success', 'partial', 'failed'], default: 'running' },
    trigger: { type: String, enum: ['cron', 'manual'], required: true },
    tabsProcessed: [{ type: String }],
    rowsUpserted: { type: Number, default: 0 },
    issues: [{ tab: String, message: String }],
  },
  { timestamps: true },
);

export const SyncLog = mongoose.model('SyncLog', syncLogSchema);
