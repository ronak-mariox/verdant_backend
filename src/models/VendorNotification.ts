import { Schema, model, Types } from 'mongoose';

export type VendorNotificationCategory =
  | 'new-order'
  | 'order-cancellation'
  | 'low-stock'
  | 'out-of-stock'
  | 'payment'
  | 'settlement'
  | 'product-approval'
  | 'kyc-status'
  | 'store-status'
  | 'system-alert'
  | 'announcement';

export interface VendorNotificationDoc {
  _id: unknown;
  vendorId: Types.ObjectId;
  category: VendorNotificationCategory;
  title: string;
  subtitle: string;
  isRead: boolean;
  orderId?: Types.ObjectId;
  productId?: Types.ObjectId;
  productName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const vendorNotificationSchema = new Schema<VendorNotificationDoc>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    category: {
      type: String,
      enum: [
        'new-order',
        'order-cancellation',
        'low-stock',
        'out-of-stock',
        'payment',
        'settlement',
        'product-approval',
        'kyc-status',
        'store-status',
        'system-alert',
        'announcement',
      ],
      required: true,
    },
    title: { type: String, required: true },
    subtitle: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    productName: String,
  },
  { timestamps: true },
);

vendorNotificationSchema.index({ vendorId: 1, createdAt: -1 });

export const VendorNotification = model<VendorNotificationDoc>('VendorNotification', vendorNotificationSchema);
