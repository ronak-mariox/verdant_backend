import { Schema, model, Types } from 'mongoose';

export type DriverResponseType = 'accepted' | 'rejected';

export interface DriverOrderResponseDoc {
  _id: unknown;
  driverId: Types.ObjectId;
  orderId: Types.ObjectId;
  response: DriverResponseType;
  reasonCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const driverOrderResponseSchema = new Schema<DriverOrderResponseDoc>(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    response: { type: String, enum: ['accepted', 'rejected'], required: true },
    reasonCode: String,
  },
  { timestamps: true },
);

driverOrderResponseSchema.index({ driverId: 1, createdAt: -1 });

export const DriverOrderResponse = model<DriverOrderResponseDoc>('DriverOrderResponse', driverOrderResponseSchema);
