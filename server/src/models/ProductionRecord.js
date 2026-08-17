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
    dailyIncrementQty: { type: Number, required: true, min: 0 },
    targetQty: { type: Number, default: null },
    unit: { type: String, default: null },
    sourceTab: { type: String, required: true },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

productionRecordSchema.index(
  { date: 1, client: 1, processStage: 1 },
  { unique: true },
);

export const ProductionRecord = mongoose.model('ProductionRecord', productionRecordSchema);
