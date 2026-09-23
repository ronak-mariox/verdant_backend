import { Schema, model, Types } from 'mongoose';

export interface CartItem {
  productId: Types.ObjectId;
  variantId: string;
  quantity: number;
}

export interface CartDoc {
  _id: unknown;
  customerId: Types.ObjectId;
  items: CartItem[];
  couponCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const cartItemSchema = new Schema<CartItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const cartSchema = new Schema<CartDoc>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, unique: true },
    items: { type: [cartItemSchema], default: [] },
    couponCode: String,
  },
  { timestamps: true },
);

export const Cart = model<CartDoc>('Cart', cartSchema);
