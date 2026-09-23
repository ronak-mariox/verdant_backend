import type { HydratedDocument } from 'mongoose';
import type { OrderDoc } from '../models/Order';
import { Vendor } from '../models/Vendor';
import { EarningsLedger } from '../models/EarningsLedger';
import { haversineKm } from './geo';

/** The driver's running balance is the `balanceAfter` on their most recent ledger
 * entry — avoids re-summing the whole ledger on every earning event. */
export async function getDriverBalance(driverId: unknown): Promise<number> {
  const latest = await EarningsLedger.findOne({ driverId: driverId as never }).sort({ createdAt: -1 });
  return latest?.balanceAfter ?? 0;
}

export interface DeliveryEarningsBreakdown {
  base: number;
  distance: number;
  onTimeBonus: number;
  total: number;
}

const PER_KM_RATE = 5;
const ON_TIME_BONUS = 10;
/** Deliveries confirmed within this window of being marked out-for-delivery count as on-time. */
const ON_TIME_WINDOW_MINUTES = 45;

/** Computes what a driver earns for completing this delivery: the order's delivery
 * fee as a base, a per-km bonus from vendor->customer haversine distance (when both
 * have coordinates on file), and a flat on-time bonus if delivered promptly. */
export async function computeDeliveryEarnings(order: HydratedDocument<OrderDoc>): Promise<DeliveryEarningsBreakdown> {
  const base = order.pricing.deliveryFee ?? 0;

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
