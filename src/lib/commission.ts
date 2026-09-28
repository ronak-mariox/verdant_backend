import type { OrderDoc } from '../models/Order';
import { VendorSettlement } from '../models/VendorSettlement';
import { round2 } from './pricing';

/** Fraction of the items total the platform keeps; clients display it ×100. */
export const PLATFORM_FEE_RATE = 0.08;
export const GST_ON_FEE_RATE = 0.18;

/** Vendor gets the items total (post-offer, pre-coupon) plus tax, less commission
 * and GST on that commission. Platform coupons, delivery and platform fees are the
 * platform's own money and never touch the vendor's payout. */
export function computeVendorPayout(pricing: Pick<OrderDoc['pricing'], 'itemsTotal' | 'taxTotal'>) {
  const grossAmount = round2(pricing.itemsTotal + pricing.taxTotal);
  const commissionAmount = round2(pricing.itemsTotal * PLATFORM_FEE_RATE);
  const gstOnCommission = round2(commissionAmount * GST_ON_FEE_RATE);
  const netPayout = round2(grossAmount - commissionAmount - gstOnCommission);
  return {
    grossAmount,
    commissionRate: PLATFORM_FEE_RATE,
    commissionAmount,
    gstOnCommission,
    netPayout,
  };
}

/** Upsert-safe: the unique orderId index plus $setOnInsert make a retry a no-op. */
export async function recordVendorSettlement(order: Pick<OrderDoc, '_id' | 'vendorId' | 'orderNumber' | 'pricing'>) {
  const { grossAmount, commissionRate, commissionAmount, gstOnCommission, netPayout } = computeVendorPayout(order.pricing);

  return VendorSettlement.findOneAndUpdate(
    { orderId: order._id as never },
    {
      $setOnInsert: {
        vendorId: order.vendorId,
        orderId: order._id,
        orderNumber: order.orderNumber,
        grossAmount,
        commissionRate,
        commissionAmount,
        gstOnCommission,
        netPayout,
        settledAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );
}
