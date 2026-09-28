import type { HydratedDocument } from 'mongoose';
import type { OrderDoc, OrderStatus } from '../models/Order';
import { HttpError } from './httpError';

/**
 * Who may move an order into each next status, and from which statuses.
 * Enforced server-side so a status can never jump (e.g. delivered -> preparing)
 * regardless of what a client sends.
 */
export type OrderActor = 'vendor' | 'customer' | 'admin' | 'driver';

export const ORDER_TRANSITIONS: Record<OrderStatus, { to: OrderStatus; by: OrderActor[] }[]> = {
  placed: [
    { to: 'accepted', by: ['vendor', 'admin'] },
    { to: 'rejected', by: ['vendor', 'admin'] },
    { to: 'cancelled', by: ['customer', 'admin'] },
  ],
  accepted: [
    { to: 'preparing', by: ['vendor', 'admin'] },
    { to: 'cancelled', by: ['customer', 'vendor', 'admin'] },
  ],
  preparing: [
    { to: 'ready_for_pickup', by: ['vendor', 'admin'] },
    { to: 'cancelled', by: ['vendor', 'admin'] },
  ],
  ready_for_pickup: [
    { to: 'out_for_delivery', by: ['driver', 'admin'] },
    { to: 'cancelled', by: ['vendor', 'admin'] },
  ],
  out_for_delivery: [
    { to: 'delivered', by: ['driver', 'admin'] },
    { to: 'ready_for_pickup', by: ['driver', 'admin'] },
    { to: 'cancelled', by: ['driver', 'admin'] },
  ],
  delivered: [],
  cancelled: [],
  rejected: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, by: OrderActor): boolean {
  return ORDER_TRANSITIONS[from].some((t) => t.to === to && t.by.includes(by));
}

export const CANCELLABLE_STATUSES: OrderStatus[] = ['placed', 'accepted'];

/**
 * Takes an assigned order away from its driver and puts it back in the pickup
 * pool. Every reassignment path (driver issue, emergency, admin) goes through
 * here so the previous driver's OTP/pickup state can never leak to the next one.
 * Mutates the document; the caller saves it.
 */
export function applyReassignment(order: HydratedDocument<OrderDoc>, by: OrderActor, note: string): void {
  if (order.status === 'out_for_delivery') {
    if (!canTransition(order.status, 'ready_for_pickup', by)) {
      throw new HttpError(409, `Cannot reassign an order from status "${order.status}"`);
    }
  } else if (order.status !== 'ready_for_pickup') {
    throw new HttpError(409, `Cannot reassign an order from status "${order.status}"`);
  }

  order.driverId = undefined;
  order.pickupConfirmedAt = undefined;
  order.deliveryOtpHash = undefined;
  order.deliveryOtp = undefined;
  order.deliveryOtpAttempts = 0;
  order.status = 'ready_for_pickup';
  order.statusHistory.push({ status: 'ready_for_pickup', at: new Date(), note });
}
