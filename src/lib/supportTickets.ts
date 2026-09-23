import type { HydratedDocument } from 'mongoose';
import { SupportTicket } from '../models/SupportTicket';
import type { DeliveryIssueDoc, DeliveryIssueType } from '../models/DeliveryIssue';
import type { DriverDoc } from '../models/Driver';
import type { OrderDoc } from '../models/Order';

const ISSUE_META: Record<DeliveryIssueType, { category: string; priority: 'low' | 'medium' | 'high' | 'urgent' }> = {
  safety_concern: { category: 'Safety concern', priority: 'urgent' },
  vehicle_problem: { category: 'Vehicle problem', priority: 'high' },
  package_damage: { category: 'Package damage', priority: 'high' },
  wrong_address: { category: 'Wrong address', priority: 'medium' },
  road_blockage: { category: 'Road blockage', priority: 'medium' },
  delivery_failed: { category: 'Delivery failed', priority: 'medium' },
};

/** A driver reporting a delivery issue is the only real dispute-raising flow that
 * exists today, so it doubles as the source for the admin Support Tickets inbox —
 * mirrors the lib/vendorNotify.ts pattern of triggering off a real event rather than
 * inventing data. */
export async function createTicketFromDeliveryIssue(
  issue: HydratedDocument<DeliveryIssueDoc>,
  driver: HydratedDocument<DriverDoc> | null,
  order: HydratedDocument<OrderDoc>,
) {
  const { category, priority } = ISSUE_META[issue.type];
  return SupportTicket.create({
    raisedByType: 'driver',
    raisedById: (driver?._id ?? issue.driverId) as never,
    raisedByName: driver?.fullName || driver?.phone || 'Unknown driver',
    subject: `${category} — Order #${order.orderNumber}`,
    description: issue.description,
    category,
    priority,
    status: 'open',
    orderId: order._id as never,
  });
}
