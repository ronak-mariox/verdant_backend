import { Schema, model } from 'mongoose';
import type { Role } from '../lib/jwt';

export interface RefreshTokenDoc {
  _id: unknown;
  tokenHash: string;
  userId: string;
  role: Role;
  expiresAt: Date;
  revokedAt?: Date | null;
  replacedBy?: string | null;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDoc>(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    role: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

refreshTokenSchema.index({ userId: 1, role: 1 });

export const RefreshToken = model<RefreshTokenDoc>('RefreshToken', refreshTokenSchema);
