import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    name: { type: String, required: true },
    picture: { type: String },
    role: { type: String, enum: ['admin', 'manager'], default: 'manager' },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', userSchema);
