import { Schema, model, Types } from 'mongoose';

export type DriverNotificationCategory = 'Orders' | 'Earnings' | 'Account' | 'System';

export interface DriverNotificationDoc {
  _id: unknown;
  driverId: Types.ObjectId;
  category: DriverNotificationCategory;
  title: string;
  subtitle: string;
  isRead: boolean;
  relatedEntityType?: string;
  relatedEntityId?: Types.ObjectId;
  data?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const driverNotificationSchema = new Schema<DriverNotificationDoc>(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    category: { type: String, enum: ['Orders', 'Earnings', 'Account', 'System'], required: true },
    title: { type: String, required: true },
    subtitle: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    relatedEntityType: String,
    relatedEntityId: { type: Schema.Types.ObjectId },
    data: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

driverNotificationSchema.index({ driverId: 1, createdAt: -1 });

export const DriverNotification = model<DriverNotificationDoc>('DriverNotification', driverNotificationSchema);
