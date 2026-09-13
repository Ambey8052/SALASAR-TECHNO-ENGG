import mongoose from 'mongoose';

const productionRecordSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    client: { type: String, required: true },
    processStage: {
      type: String,
      enum: ['cutting', 'fitUp', 'welding', 'visual', 'blasting', 'finalCoat'],
      required: true,
    },
    cumulativeQty: { type: Number, required: true, min: 0 },
    // No lower bound: the sheet records corrections as negative increments (RIL, June 2025:
    // welding −87 and blasting −95, matching the running total falling by the same amounts).
    // They are real, and totals built from increments are only right if they are counted.
    // This constraint went unnoticed while bulkWrite skipped validation; enforcing it would have
    // thrown those corrections away.
    dailyIncrementQty: { type: Number, required: true },
    targetQty: { type: Number, default: null },
    unit: { type: String, default: null },
    sourceTab: { type: String, required: true },
    // The cumulative cell this record was read from, so any figure traces back to the sheet.
    sourceRowIndex: { type: Number, default: null },
    sourceCol: { type: Number, default: null },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

productionRecordSchema.index(
  { date: 1, client: 1, processStage: 1 },
  { unique: true },
);

export const ProductionRecord = mongoose.model('ProductionRecord', productionRecordSchema);
