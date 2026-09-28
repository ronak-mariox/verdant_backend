import { Types, type HydratedDocument } from 'mongoose';
import type { OrderDoc } from '../models/Order';
import { Vendor } from '../models/Vendor';
import { EarningsLedger } from '../models/EarningsLedger';
import { haversineKm } from './geo';

/** Flat amount (₹) a driver earns per completed delivery, regardless of what the
 * customer was charged for delivery (which is often ₹0 above the minimum order). */
export const DRIVER_BASE_PAY = 30;
const PER_KM_RATE = 5;
const ON_TIME_BONUS = 10;
/** Deliveries confirmed within this window of being marked out-for-delivery count as on-time. */
const ON_TIME_WINDOW_MINUTES = 45;

export async function getDriverBalance(driverId: unknown): Promise<number> {
  const rows = await EarningsLedger.aggregate([
    { $match: { driverId: new Types.ObjectId(String(driverId)) } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return rows[0]?.total ?? 0;
}

export interface DeliveryEarningsBreakdown {
  base: number;
  distance: number;
  onTimeBonus: number;
  total: number;
}

/** Base pay + a per-km bonus from vendor->customer haversine distance (when both
 * have coordinates on file) + a flat on-time bonus if delivered promptly. */
export async function computeDeliveryEarnings(order: HydratedDocument<OrderDoc>): Promise<DeliveryEarningsBreakdown> {
  const base = DRIVER_BASE_PAY;

  let distance = 0;
  const vendor = await Vendor.findById(order.vendorId);
  const vendorLocation = vendor?.storeSetupAddress?.location;
  if (vendorLocation?.latitude && vendorLocation?.longitude && order.address.latitude && order.address.longitude) {
    const km = haversineKm(
      { lat: vendorLocation.latitude, lng: vendorLocation.longitude },
      { lat: order.address.latitude, lng: order.address.longitude },
    );
    distance = Math.round(km * PER_KM_RATE);
  }

  let onTimeBonus = 0;
  if (order.pickupConfirmedAt) {
    const minutesTaken = (Date.now() - order.pickupConfirmedAt.getTime()) / 60000;
    if (minutesTaken <= ON_TIME_WINDOW_MINUTES) onTimeBonus = ON_TIME_BONUS;
  }

  return { base, distance, onTimeBonus, total: base + distance + onTimeBonus };
}
