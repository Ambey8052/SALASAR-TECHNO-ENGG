import mongoose from 'mongoose';

const targetSchema = new mongoose.Schema(
  {
    client: { type: String, required: true },
    qty: { type: Number, required: true, min: 0 },
    setByEmail: { type: String, required: true },
  },
  { timestamps: true },
);

targetSchema.index({ client: 1 }, { unique: true });

export const Target = mongoose.model('Target', targetSchema);
