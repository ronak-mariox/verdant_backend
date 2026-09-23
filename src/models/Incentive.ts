import { Schema, model } from 'mongoose';

export type IncentiveStatus = 'active' | 'expired';

export interface IncentiveCondition {
  label: string;
  type: string;
  threshold: number;
}

export interface IncentiveDoc {
  _id: unknown;
  title: string;
  description: string;
  rewardAmount: number;
  targetDeliveries: number;
  startAt: Date;
  expiresAt: Date;
  status: IncentiveStatus;
  conditions: IncentiveCondition[];
  createdAt: Date;
  updatedAt: Date;
}

const incentiveConditionSchema = new Schema<IncentiveCondition>(
  {
    label: { type: String, required: true },
    type: { type: String, required: true },
    threshold: { type: Number, required: true },
  },
  { _id: false },
);

const incentiveSchema = new Schema<IncentiveDoc>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    rewardAmount: { type: Number, required: true },
    targetDeliveries: { type: Number, required: true },
    startAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'expired'], default: 'active' },
    conditions: { type: [incentiveConditionSchema], default: [] },
  },
  { timestamps: true },
);

incentiveSchema.index({ status: 1, expiresAt: 1 });

export const Incentive = model<IncentiveDoc>('Incentive', incentiveSchema);
