import mongoose from 'mongoose';

const dispatchRecordSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    // Read from each block's own title ("HSD - …" / "Bhilai - …"); see dispatchParser.js.
    businessUnit: { type: String, enum: ['HSD', 'BU'], default: 'HSD' },
    client: { type: String, default: null },
    project: { type: String, default: null },
    description: { type: String, default: null },
    qty: { type: Number, required: true, min: 0 },
    unit: { type: String, default: null },
    vehicleNo: { type: String, default: null },
    sourceTab: { type: String, required: true },
    sourceRowIndex: { type: Number, required: true },
    raw: { type: mongoose.Schema.Types.Mixed },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

dispatchRecordSchema.index(
  { sourceTab: 1, sourceRowIndex: 1, date: 1 },
  { unique: true },
);

// Every dashboard query filters on a date range; the unique key above cannot serve that.
dispatchRecordSchema.index({ businessUnit: 1, date: 1 });

export const DispatchRecord = mongoose.model('DispatchRecord', dispatchRecordSchema);
