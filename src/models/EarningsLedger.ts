import { Schema, model, Types } from 'mongoose';

export type EarningsLedgerType =
  | 'delivery_fee'
  | 'distance_bonus'
  | 'ontime_bonus'
  | 'incentive_bonus'
  | 'earnings_protection'
  | 'payout';

export type EarningsLedgerStatus = 'pending' | 'settled' | 'paid';

export interface EarningsLedgerDoc {
  _id: unknown;
  driverId: Types.ObjectId;
  orderId?: Types.ObjectId;
  type: EarningsLedgerType;
  amount: number;
  balanceAfter: number;
  status: EarningsLedgerStatus;
  reason: string;
  createdAt: Date;
  updatedAt: Date;
}

const earningsLedgerSchema = new Schema<EarningsLedgerDoc>(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    type: {
      type: String,
      enum: ['delivery_fee', 'distance_bonus', 'ontime_bonus', 'incentive_bonus', 'earnings_protection', 'payout'],
      required: true,
    },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'settled', 'paid'], default: 'pending' },
    reason: { type: String, required: true },
  },
  { timestamps: true },
);

earningsLedgerSchema.index({ driverId: 1, createdAt: -1 });

export const EarningsLedger = model<EarningsLedgerDoc>('EarningsLedger', earningsLedgerSchema);
