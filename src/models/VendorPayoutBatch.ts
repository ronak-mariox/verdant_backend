import { Schema, model, Types } from 'mongoose';

export type VendorPayoutBatchStatus = 'pending' | 'paid' | 'failed';

export interface VendorPayoutBatchDoc {
  _id: unknown;
  vendorId: Types.ObjectId;
  periodStart: Date;
  periodEnd: Date;
  grossSales: number;
  returns: number;
  netSales: number;
  commissionRate: number;
  commission: number;
  gstOnCommission: number;
  adjustments: number;
  netPayout: number;
  settlementIds: Types.ObjectId[];
  settlementCount: number;
  status: VendorPayoutBatchStatus;
  bankAccountLabel?: string;
  transactionRef?: string;
  transactionDate?: Date;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const vendorPayoutBatchSchema = new Schema<VendorPayoutBatchDoc>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    grossSales: { type: Number, required: true },
    returns: { type: Number, required: true, default: 0 },
    netSales: { type: Number, required: true },
    commissionRate: { type: Number, required: true },
    commission: { type: Number, required: true },
    gstOnCommission: { type: Number, required: true },
    adjustments: { type: Number, required: true, default: 0 },
    netPayout: { type: Number, required: true },
    settlementIds: { type: [Schema.Types.ObjectId], ref: 'VendorSettlement', default: [] },
    settlementCount: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    bankAccountLabel: { type: String },
    transactionRef: { type: String },
    transactionDate: { type: Date },
    failureReason: { type: String },
  },
  { timestamps: true },
);

vendorPayoutBatchSchema.index({ vendorId: 1, periodStart: -1 });
vendorPayoutBatchSchema.index({ vendorId: 1, periodStart: 1 }, { unique: true });

export const VendorPayoutBatch = model<VendorPayoutBatchDoc>('VendorPayoutBatch', vendorPayoutBatchSchema);
