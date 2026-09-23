import { Schema, model, Types } from 'mongoose';

export type DeliveryIssueType =
  | 'wrong_address'
  | 'package_damage'
  | 'vehicle_problem'
  | 'road_blockage'
  | 'safety_concern'
  | 'delivery_failed';

export interface DeliveryIssueDoc {
  _id: unknown;
  driverId: Types.ObjectId;
  orderId: Types.ObjectId;
  type: DeliveryIssueType;
  description?: string;
  evidenceUrls: string[];
  resolvedAction?: string;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryIssueSchema = new Schema<DeliveryIssueDoc>(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    type: {
      type: String,
      enum: ['wrong_address', 'package_damage', 'vehicle_problem', 'road_blockage', 'safety_concern', 'delivery_failed'],
      required: true,
    },
    description: String,
    evidenceUrls: { type: [String], default: [] },
    resolvedAction: String,
  },
  { timestamps: true },
);

deliveryIssueSchema.index({ driverId: 1, createdAt: -1 });
deliveryIssueSchema.index({ orderId: 1 });

export const DeliveryIssue = model<DeliveryIssueDoc>('DeliveryIssue', deliveryIssueSchema);
