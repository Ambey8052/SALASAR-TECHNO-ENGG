import mongoose from 'mongoose';

const insightCacheSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    generatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

export const InsightCache = mongoose.model('InsightCache', insightCacheSchema);
