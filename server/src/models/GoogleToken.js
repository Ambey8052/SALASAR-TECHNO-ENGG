import mongoose from 'mongoose';

const googleTokenSchema = new mongoose.Schema(
  {
    purpose: { type: String, required: true, unique: true, default: 'drive-sync' },
    encryptedRefreshToken: { type: String, required: true },
    scope: { type: String },
    connectedByEmail: { type: String },
    connectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const GoogleToken = mongoose.model('GoogleToken', googleTokenSchema);
