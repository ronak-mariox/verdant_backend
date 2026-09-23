import { Schema, model, Types } from 'mongoose';

export type DriverIncentiveProgressStatus = 'in_progress' | 'completed' | 'expired' | 'partial';

export interface DriverIncentiveProgressDoc {
  _id: unknown;
  driverId: Types.ObjectId;
  incentiveId: Types.ObjectId;
  currentProgress: number;
  status: DriverIncentiveProgressStatus;
  completedAt?: Date;
  payoutAmount?: number;
  createdAt: Date;
  updatedAt: Date;
}

const driverIncentiveProgressSchema = new Schema<DriverIncentiveProgressDoc>(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    incentiveId: { type: Schema.Types.ObjectId, ref: 'Incentive', required: true },
    currentProgress: { type: Number, default: 0 },
    status: { type: String, enum: ['in_progress', 'completed', 'expired', 'partial'], default: 'in_progress' },
    completedAt: Date,
    payoutAmount: Number,
  },
  { timestamps: true },
);

driverIncentiveProgressSchema.index({ driverId: 1, incentiveId: 1 }, { unique: true });

export const DriverIncentiveProgress = model<DriverIncentiveProgressDoc>(
  'DriverIncentiveProgress',
  driverIncentiveProgressSchema,
);
