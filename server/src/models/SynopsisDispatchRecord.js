import mongoose from 'mongoose';

// One row per department per day that actually dispatched something. Days with no dispatch
// are not stored — the reporting window lives on SynopsisMonth.coveredDates, so a zero day
// and a day the report hasn't reached yet stay distinguishable without a row for either.
const synopsisDispatchRecordSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    month: { type: String, required: true }, // 'YYYY-MM', matches SynopsisMonth.month
    department: { type: String, required: true },
    // The department exactly as the workbook spelled it, kept alongside the canonical name so
    // a figure can always be traced back to the cell it came from.
    sourceLabel: { type: String, default: null },
    category: { type: String, required: true },
    mode: { type: String, default: 'Inhouse' },
    qty: { type: Number, required: true, min: 0 },
    sourceFile: { type: String, required: true },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// A department can appear twice in one month under different modes (June onwards tracks
// Adani and RIL as both an in-house and a buyout line), so the mode is part of the key.
synopsisDispatchRecordSchema.index({ date: 1, department: 1, mode: 1 }, { unique: true });
synopsisDispatchRecordSchema.index({ month: 1 });

export const SynopsisDispatchRecord = mongoose.model('SynopsisDispatchRecord', synopsisDispatchRecordSchema);
