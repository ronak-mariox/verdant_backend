import { Schema, model, Types } from 'mongoose';

export interface VendorSettlementDoc {
  _id: unknown;
  vendorId: Types.ObjectId;
  orderId: Types.ObjectId;
  orderNumber: string;
  grossAmount: number;
  commissionRate: number;
  commissionAmount: number;
  gstOnCommission: number;
  netPayout: number;
  settledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const vendorSettlementSchema = new Schema<VendorSettlementDoc>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    orderNumber: { type: String, required: true },
    grossAmount: { type: Number, required: true },
    commissionRate: { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    gstOnCommission: { type: Number, required: true },
    netPayout: { type: Number, required: true },
    settledAt: { type: Date, required: true },
  },
  { timestamps: true },
);

vendorSettlementSchema.index({ vendorId: 1, createdAt: -1 });

export const VendorSettlement = model<VendorSettlementDoc>('VendorSettlement', vendorSettlementSchema);
