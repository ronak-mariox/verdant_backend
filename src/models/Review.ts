import { Schema, model, Types } from 'mongoose';

export interface ReviewDoc {
  _id: unknown;
  productId: Types.ObjectId;
  customerName: string;
  rating: number;
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<ReviewDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    customerName: { type: String, required: true, trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true },
  },
  { timestamps: true },
);

reviewSchema.index({ productId: 1, createdAt: -1 });

export const Review = model<ReviewDoc>('Review', reviewSchema);
