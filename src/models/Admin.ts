import { Schema, model } from 'mongoose';

export interface AdminDoc {
  _id: unknown;
  name: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'super_admin';
  createdAt: Date;
  updatedAt: Date;
}

const adminSchema = new Schema<AdminDoc>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'super_admin'], default: 'admin' },
  },
  { timestamps: true },
);

export const Admin = model<AdminDoc>('Admin', adminSchema);
