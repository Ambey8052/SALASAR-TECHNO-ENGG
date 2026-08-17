import mongoose from 'mongoose';

const manpowerRecordSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    businessUnit: { type: String, enum: ['HSD', 'BU'], required: true },
    category: {
      type: String,
      enum: ['fabrication', 'painting', 'civil', 'shed', 'office'],
      required: true,
    },
    shift: { type: String, enum: ['day', 'night', 'mid', null], default: null },
    count: { type: Number, required: true, min: 0 },
    rawLabel: { type: String },
    sourceTab: { type: String, default: 'Manpower' },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

manpowerRecordSchema.index(
  { date: 1, businessUnit: 1, category: 1, shift: 1 },
  { unique: true },
);

export const ManpowerRecord = mongoose.model('ManpowerRecord', manpowerRecordSchema);
