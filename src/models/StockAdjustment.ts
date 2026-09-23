import { Schema, model, Types } from 'mongoose';

export type StockEventType = 'purchase' | 'sale' | 'adjustment' | 'return' | 'damage' | 'bulk' | 'correction';

export interface StockAdjustmentDoc {
  _id: unknown;
  vendorId: Types.ObjectId;
  productId: Types.ObjectId;
  productName: string;
  type: StockEventType;
  delta: number;
  afterStock: number;
  reason: string;
  reference?: string;
  actor: 'You' | 'System';
  createdAt: Date;
  updatedAt: Date;
}

const stockAdjustmentSchema = new Schema<StockAdjustmentDoc>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    type: {
      type: String,
      enum: ['purchase', 'sale', 'adjustment', 'return', 'damage', 'bulk', 'correction'],
      required: true,
    },
    delta: { type: Number, required: true },
    afterStock: { type: Number, required: true },
    reason: { type: String, required: true },
    reference: String,
    actor: { type: String, enum: ['You', 'System'], default: 'You' },
  },
  { timestamps: true },
);

stockAdjustmentSchema.index({ vendorId: 1, createdAt: -1 });
stockAdjustmentSchema.index({ vendorId: 1, productId: 1, createdAt: -1 });

export const StockAdjustment = model<StockAdjustmentDoc>('StockAdjustment', stockAdjustmentSchema);
