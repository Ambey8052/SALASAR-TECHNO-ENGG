import mongoose from 'mongoose';

const scheduledEmailSchema = new mongoose.Schema(
  {
    from: { type: String, required: true },
    to: { type: [String], required: true },
    cc: { type: [String], default: [] },
    subject: { type: String, required: true },
    bodyHtml: { type: String, required: true },
    sendAt: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'cancelled', 'unknown'], default: 'pending' },
    createdByEmail: { type: String, required: true },
    // Set when a scheduler tick claims the email, before it is handed to Gmail. A claim that
    // never reaches 'sent' or 'failed' means the process died mid-send — it becomes 'unknown'
    // for a person to check rather than being sent again (see jobs/emailScheduler.js).
    claimedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

scheduledEmailSchema.index({ status: 1, sendAt: 1 });

export const ScheduledEmail = mongoose.model('ScheduledEmail', scheduledEmailSchema);
