import { Schema, model, Types } from 'mongoose';

export type NotificationKind = 'order' | 'offer' | 'delivered' | 'reorder' | 'refund' | 'security';

export interface NotificationDoc {
  _id: unknown;
  customerId: Types.ObjectId;
  kind: NotificationKind;
  title: string;
  body: string;
  orderId?: Types.ObjectId;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    kind: { type: String, enum: ['order', 'offer', 'delivered', 'reorder', 'refund', 'security'], required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);

notificationSchema.index({ customerId: 1, createdAt: -1 });

export const Notification = model<NotificationDoc>('Notification', notificationSchema);
