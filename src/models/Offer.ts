import { Schema, model, Types } from 'mongoose';

export type OfferScope = 'selected-products' | 'entire-store';
export type OfferDiscountType = 'percentage' | 'flat';
export type OfferCustomerEligibility = 'all' | 'new-only';

export interface OfferDoc {
  _id: unknown;
  vendorId: Types.ObjectId;
  title: string;
  discountType: OfferDiscountType;
  discountValue: number;
  scope: OfferScope;
  categoryIds: Types.ObjectId[];
  minOrderValueEnabled: boolean;
  minOrderValue: number;
  customerEligibility: OfferCustomerEligibility;
  startDate: Date;
  endDate: Date;
  isPaused: boolean;
  usesCount: number;
  revenueGenerated: number;
  createdAt: Date;
  updatedAt: Date;
}

const offerSchema = new Schema<OfferDoc>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    title: { type: String, required: true, trim: true },
    discountType: { type: String, enum: ['percentage', 'flat'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    scope: { type: String, enum: ['selected-products', 'entire-store'], required: true },
    categoryIds: { type: [Schema.Types.ObjectId], ref: 'Category', default: [] },
    minOrderValueEnabled: { type: Boolean, default: false },
    minOrderValue: { type: Number, default: 0 },
    customerEligibility: { type: String, enum: ['all', 'new-only'], default: 'all' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isPaused: { type: Boolean, default: false },
    usesCount: { type: Number, default: 0 },
    revenueGenerated: { type: Number, default: 0 },
  },
  { timestamps: true },
);

offerSchema.index({ vendorId: 1, createdAt: -1 });
offerSchema.index({ vendorId: 1, startDate: 1, endDate: 1 });

export const Offer = model<OfferDoc>('Offer', offerSchema);
