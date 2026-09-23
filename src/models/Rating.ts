import { Schema, model, Types } from 'mongoose';

export interface RatingDoc {
  _id: unknown;
  orderId: Types.ObjectId;
  driverId: Types.ObjectId;
  customerId: Types.ObjectId;
  stars: number;
  reviewText?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ratingSchema = new Schema<RatingDoc>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    stars: { type: Number, required: true, min: 1, max: 5 },
    reviewText: String,
  },
  { timestamps: true },
);

ratingSchema.index({ driverId: 1, createdAt: -1 });

export const Rating = model<RatingDoc>('Rating', ratingSchema);
