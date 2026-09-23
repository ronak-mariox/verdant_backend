import type { ProductDoc, ProductVariant } from '../models/Product';
import type { CouponDoc } from '../models/Coupon';
import type { OrderPricing } from '../models/Order';

// Mirrors Verdant's src/data/cart.ts constants so totals shown pre- and
// post-backend-integration line up.
export const MIN_ORDER_VALUE = 99;
export const DELIVERY_FEE = 30;
export const PLATFORM_FEE = 5;

export function findVariant(product: Pick<ProductDoc, 'variants'>, variantId: string): ProductVariant | undefined {
  return product.variants.find((v) => v.id === variantId);
}

export interface AppliedOffer {
  id: string;
  discountType: 'percentage' | 'flat';
  discountValue: number;
}

export interface PricedLine {
  product: ProductDoc;
  variant: ProductVariant;
  quantity: number;
  subtotal: number;
  tax: number;
  offerId?: string;
  originalSubtotal?: number;
}

export function priceLine(
  product: ProductDoc,
  variant: ProductVariant,
  quantity: number,
  appliedOffer?: AppliedOffer,
): PricedLine {
  const originalSubtotal = round2(variant.price * quantity);
  let subtotal = originalSubtotal;
  let offerId: string | undefined;

  if (appliedOffer) {
    const discountedUnitPrice =
      appliedOffer.discountType === 'percentage'
        ? variant.price * (1 - appliedOffer.discountValue / 100)
        : variant.price - appliedOffer.discountValue;
    subtotal = round2(Math.max(discountedUnitPrice, 0) * quantity);
    offerId = appliedOffer.id;
  }

  const tax = round2((subtotal * (product.taxRate || 0)) / 100);
  return { product, variant, quantity, subtotal, tax, offerId, originalSubtotal: offerId ? originalSubtotal : undefined };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Validates a coupon against the current items total and returns the discount
 * amount — 0 (with a reason) if it doesn't apply. Does NOT mutate usedCount;
 * that only happens once an order is actually placed.
 */
export function evaluateCoupon(
  coupon: CouponDoc | null,
  itemsTotal: number,
): { discount: number; reason?: string } {
  if (!coupon) return { discount: 0 };
  if (!coupon.isActive) return { discount: 0, reason: 'This coupon is no longer active' };
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
    return { discount: 0, reason: 'This coupon has expired' };
  }
  if (coupon.usageLimit !== undefined && coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    return { discount: 0, reason: 'This coupon has reached its usage limit' };
  }
  if (itemsTotal < coupon.minOrderValue) {
    return { discount: 0, reason: `Add items worth ₹${coupon.minOrderValue - itemsTotal} more to use this coupon` };
  }

  let discount = coupon.discountType === 'flat' ? coupon.value : round2((itemsTotal * coupon.value) / 100);
  if (coupon.maxDiscount !== undefined && coupon.maxDiscount !== null) {
    discount = Math.min(discount, coupon.maxDiscount);
  }
  return { discount: round2(Math.min(discount, itemsTotal)) };
}

export function computeOrderPricing(lines: PricedLine[], discount: number): OrderPricing {
  const itemsTotal = round2(lines.reduce((sum, l) => sum + l.subtotal, 0));
  const taxTotal = round2(lines.reduce((sum, l) => sum + l.tax, 0));
  const deliveryFee = itemsTotal >= MIN_ORDER_VALUE ? 0 : DELIVERY_FEE;
  const platformFee = lines.length > 0 ? PLATFORM_FEE : 0;
  const grandTotal = round2(itemsTotal + taxTotal + deliveryFee + platformFee - discount);
  return { itemsTotal, taxTotal, deliveryFee, platformFee, discount, grandTotal };
}
