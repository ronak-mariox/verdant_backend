import { Schema, model } from 'mongoose';
import type { Role } from '../lib/jwt';

export interface OtpRequestDoc {
  _id: unknown;
  phone: string;
  role: Role;
  codeHash: string;
  expiresAt: Date;
  consumedAt?: Date | null;
  attempts: number;
  createdAt: Date;
}

const otpRequestSchema = new Schema<OtpRequestDoc>(
  {
    phone: { type: String, required: true },
    role: { type: String, required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

otpRequestSchema.index({ phone: 1, role: 1 });
otpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpRequest = model<OtpRequestDoc>('OtpRequest', otpRequestSchema);
