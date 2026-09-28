import type { Request, Response } from 'express';
import { Order, type OrderStatus } from '../models/Order';
import { HttpError } from '../lib/httpError';
import { objectPagination, toSafeJson } from '../lib/sanitize';
import { applyReassignment, canTransition } from '../lib/orderStatus';
import { releaseOrderResources } from '../lib/orderStock';
import { notifyOrderStatusChange } from '../lib/notify';
import { notifyVendor } from '../lib/vendorNotify';
import { notifyDriverOrderEvent } from '../lib/driverNotify';
import { recordVendorSettlement } from '../lib/commission';

const ADMIN_OMIT = ['deliveryOtpHash', 'deliveryOtp', 'deliveryOtpAttempts'];

export async function listAllOrders(req: Request, res: Response) {
  const { status, vendorId, customerId, driverId } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (vendorId) filter.vendorId = vendorId;
  if (customerId) filter.customerId = customerId;
  if (driverId) filter.driverId = driverId;

  const { page, limit, skip } = objectPagination(req.query as Record<string, unknown>);

  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ items: items.map((o) => toSafeJson(o, ADMIN_OMIT)), page, limit, total, totalPages: Math.ceil(total / limit) });
}

export async function getOrderForAdmin(req: Request, res: Response) {
  const order = await Order.findById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');
  res.json(toSafeJson(order, ADMIN_OMIT));
}

export async function updateOrderStatusAsAdmin(req: Request, res: Response) {
  const order = await Order.findById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');

  const nextStatus = req.body.status as OrderStatus;
  const note = req.body.note as string | undefined;
  if (!canTransition(order.status, nextStatus, 'admin')) {
    throw new HttpError(409, `Cannot move order from "${order.status}" to "${nextStatus}"`);
  }

  const previousDriverId = order.driverId;
  const now = new Date();

  if (nextStatus === 'ready_for_pickup' && order.status === 'out_for_delivery') {
    applyReassignment(order, 'admin', note ?? 'Reassigned by admin');
    await order.save();
    if (previousDriverId) {
      await notifyDriverOrderEvent(previousDriverId, 'order-unassigned', order._id, order.orderNumber, note);
    }
    res.json(toSafeJson(order, ADMIN_OMIT));
    return;
  }

  const isTerminal = nextStatus === 'cancelled' || nextStatus === 'rejected';
  if (isTerminal) await releaseOrderResources(order);

  order.status = nextStatus;
  order.statusHistory.push({ status: nextStatus, at: now, note });
  if (isTerminal) {
    order.cancelledBy = 'admin';
    order.cancelReason = note;
    order.deliveryOtpHash = undefined;
    order.deliveryOtp = undefined;
  }
  if (nextStatus === 'delivered') {
    order.deliveredAt = now;
    order.paymentStatus = 'paid';
    order.deliveryOtpHash = undefined;
    order.deliveryOtp = undefined;
  }
  await order.save();

  await notifyOrderStatusChange(order, nextStatus, note);
  if (isTerminal) {
    await notifyVendor(
      order.vendorId,
      'order-cancellation',
      `Order #${order.orderNumber} ${nextStatus === 'rejected' ? 'Rejected' : 'Cancelled'}`,
      note ? `${nextStatus === 'rejected' ? 'Rejected' : 'Cancelled'} by Verdant · ${note}` : `${nextStatus === 'rejected' ? 'Rejected' : 'Cancelled'} by Verdant`,
      { orderId: order._id, orderNumber: order.orderNumber },
    );
    if (previousDriverId) {
      await notifyDriverOrderEvent(previousDriverId, 'order-cancelled', order._id, order.orderNumber, note);
    }
  } else if (nextStatus === 'delivered') {
    await recordVendorSettlement(order);
    await notifyVendor(
      order.vendorId,
      'payment',
      'Payment Received',
      `Order #${order.orderNumber} · ₹${order.pricing.grandTotal}`,
      { orderId: order._id, orderNumber: order.orderNumber },
    );
  }

  res.json(toSafeJson(order, ADMIN_OMIT));
}
