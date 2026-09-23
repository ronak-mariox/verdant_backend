import { Schema, model, Types } from 'mongoose';

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'rejected';

export interface OrderItemSnapshot {
  productId: Types.ObjectId;
  variantId: string;
  name: string;
  variantLabel: string;
  imageUrl?: string;
  price: number;
  mrp: number;
  quantity: number;
  subtotal: number;
  offerId?: Types.ObjectId;
  originalSubtotal?: number;
}

export interface OrderAddressSnapshot {
  contactName?: string;
  contactPhone?: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
}

export interface OrderPricing {
  itemsTotal: number;
  taxTotal: number;
  deliveryFee: number;
  platformFee: number;
  discount: number;
  grandTotal: number;
}

export interface OrderStatusEvent {
  status: OrderStatus;
  at: Date;
  note?: string;
}

export interface OrderDoc {
  _id: unknown;
  orderNumber: string;
  customerId: Types.ObjectId;
  vendorId: Types.ObjectId;
  driverId?: Types.ObjectId;
  items: OrderItemSnapshot[];
  address: OrderAddressSnapshot;
  pricing: OrderPricing;
  couponCode?: string;
  paymentMethod: 'cod' | 'online';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  status: OrderStatus;
  statusHistory: OrderStatusEvent[];
  specialInstructions?: string;
  cancelReason?: string;
  cancelledBy?: 'customer' | 'vendor' | 'admin' | 'driver';
  placedAt: Date;
  deliveredAt?: Date;
  deliveryOtpHash?: string;
  pickupConfirmedAt?: Date;
  deliveryProofUrl?: string;
  driverEarnings?: {
    base: number;
    distance: number;
    onTimeBonus: number;
    incentiveBonus: number;
    total: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<OrderItemSnapshot>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: String, required: true },
    name: { type: String, required: true },
    variantLabel: { type: String, required: true },
    imageUrl: String,
    price: { type: Number, required: true },
    mrp: { type: Number, required: true },
    quantity: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer' },
    originalSubtotal: Number,
  },
  { _id: false },
);

const orderStatusEventSchema = new Schema<OrderStatusEvent>(
  {
    status: { type: String, required: true },
    at: { type: Date, required: true },
    note: String,
  },
  { _id: false },
);

const orderSchema = new Schema<OrderDoc>(
  {
    orderNumber: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
    items: { type: [orderItemSchema], required: true },
    address: { type: Schema.Types.Mixed, required: true },
    pricing: { type: Schema.Types.Mixed, required: true },
    couponCode: String,
    paymentMethod: { type: String, enum: ['cod', 'online'], required: true },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
    status: {
      type: String,
      enum: ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled', 'rejected'],
      default: 'placed',
    },
    statusHistory: { type: [orderStatusEventSchema], default: [] },
    specialInstructions: String,
    cancelReason: String,
    cancelledBy: { type: String, enum: ['customer', 'vendor', 'admin', 'driver'] },
    placedAt: { type: Date, required: true },
    deliveredAt: Date,
    deliveryOtpHash: String,
    pickupConfirmedAt: Date,
    deliveryProofUrl: String,
    driverEarnings: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ vendorId: 1, createdAt: -1 });
orderSchema.index({ driverId: 1, createdAt: -1 });
orderSchema.index({ status: 1 });

export const Order = model<OrderDoc>('Order', orderSchema);
