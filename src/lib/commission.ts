import { OrderDoc } from '../models/Order';
import { VendorSettlement } from '../models/VendorSettlement';

export const PLATFORM_FEE_RATE = 0.08;
export const GST_ON_FEE_RATE = 0.18;

export function computeVendorPayout(grandTotal: number) {
  const commissionAmount = grandTotal * PLATFORM_FEE_RATE;
  const gstOnCommission = commissionAmount * GST_ON_FEE_RATE;
  const netPayout = grandTotal - commissionAmount - gstOnCommission;
  return {
    commissionRate: PLATFORM_FEE_RATE,
    commissionAmount,
    gstOnCommission,
    netPayout,
  };
}

export async function recordVendorSettlement(order: OrderDoc) {
  const existing = await VendorSettlement.findOne({ orderId: order._id as never });
  if (existing) return existing;

  const grossAmount = order.pricing.grandTotal;
  const { commissionRate, commissionAmount, gstOnCommission, netPayout } = computeVendorPayout(grossAmount);

  return VendorSettlement.create({
    vendorId: order.vendorId as never,
    orderId: order._id as never,
    orderNumber: order.orderNumber,
    grossAmount,
    commissionRate,
    commissionAmount,
    gstOnCommission,
    netPayout,
    settledAt: new Date(),
  });
}
