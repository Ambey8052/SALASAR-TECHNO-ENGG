import mongoose from 'mongoose';

// One document per monthly synopsis workbook. The department plan and the tower synopsis are
// embedded rather than given collections of their own: neither is ever queried on its own,
// both are small and fixed-size, and both are rewritten wholesale whenever their workbook is
// re-read — so keeping them inside the month keeps a re-sync a single atomic replace.
const departmentPlanSchema = new mongoose.Schema(
  {
    department: { type: String, required: true },
    sourceLabel: { type: String, default: null },
    category: { type: String, required: true },
    mode: { type: String, default: 'Inhouse' },
    planned: { type: Number, default: null },
    dispatched: { type: Number, required: true, min: 0 },
    recordedDays: { type: Number, default: 0 },
  },
  { _id: false },
);

const towerSchema = new mongoose.Schema(
  {
    model: { type: String, required: true },
    // A string, not a number: several rows cover more than one height at once ("40/50/60").
    heightM: { type: String, default: null },
    towerNos: { type: Number, default: null },
    cipNos: { type: Number, default: null },
    weightMt: { type: Number, default: null },
    remarks: { type: String, default: null },
  },
  { _id: false },
);

const synopsisMonthSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true }, // 'YYYY-MM'
    plannedTotal: { type: Number, default: 0 },
    dispatchedTotal: { type: Number, default: 0 },
    // Days the workbook actually reports on — the days carrying a real figure, blank or zero.
    // July's columns run to the 30th but its rows stop at the 16th, so a month is only ever
    // averaged over the window it genuinely covers.
    coveredDates: { type: [Date], default: [] },
    departments: { type: [departmentPlanSchema], default: [] },
    towers: { type: [towerSchema], default: [] },
    sourceFile: { type: String, required: true },
    sourceFileId: { type: String, default: null },
    warnings: { type: [String], default: [] },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const SynopsisMonth = mongoose.model('SynopsisMonth', synopsisMonthSchema);
