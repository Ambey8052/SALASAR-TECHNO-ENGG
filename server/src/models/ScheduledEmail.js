import mongoose from 'mongoose';

const scheduledEmailSchema = new mongoose.Schema(
  {
    from: { type: String, required: true },
    to: { type: [String], required: true },
    cc: { type: [String], default: [] },
    subject: { type: String, required: true },
    bodyHtml: { type: String, required: true },
    sendAt: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed', 'cancelled'], default: 'pending' },
    createdByEmail: { type: String, required: true },
    sentAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

scheduledEmailSchema.index({ status: 1, sendAt: 1 });

export const ScheduledEmail = mongoose.model('ScheduledEmail', scheduledEmailSchema);
