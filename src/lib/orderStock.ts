import type { OrderDoc } from '../models/Order';
import { Product } from '../models/Product';
import { Coupon } from '../models/Coupon';

/** Puts every line's quantity back on its product variant after a cancel/reject. */
export async function restoreOrderStock(order: Pick<OrderDoc, 'items'>): Promise<void> {
  for (const item of order.items) {
    await Product.updateOne({ _id: item.productId, 'variants.id': item.variantId }, { $inc: { 'variants.$.stock': item.quantity } });
  }
}

/** Gives the customer their coupon use back when the order never completed. */
export async function releaseCouponUse(order: Pick<OrderDoc, 'couponCode'>): Promise<void> {
  if (!order.couponCode) return;
  await Coupon.updateOne({ code: order.couponCode, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
}

export async function releaseOrderResources(order: Pick<OrderDoc, 'items' | 'couponCode'>): Promise<void> {
  await restoreOrderStock(order);
  await releaseCouponUse(order);
}
