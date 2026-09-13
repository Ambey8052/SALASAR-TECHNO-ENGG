import mongoose from 'mongoose';

const insightCacheSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    generatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

// Entries are only ever read for a day (insights.controller.js); without a TTL the collection
// grows by one document per filter combination, forever.
insightCacheSchema.index({ generatedAt: 1 }, { expireAfterSeconds: 2 * 24 * 60 * 60 });

export const InsightCache = mongoose.model('InsightCache', insightCacheSchema);
