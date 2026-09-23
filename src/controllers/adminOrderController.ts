import type { Request, Response } from 'express';
import { Order, type OrderStatus } from '../models/Order';
import { Product } from '../models/Product';
import { HttpError } from '../lib/httpError';
import { toSafeJson } from '../lib/sanitize';
import { canTransition } from '../lib/orderStatus';
import { notifyOrderStatusChange } from '../lib/notify';
import { notifyVendor } from '../lib/vendorNotify';
import { notifyDriverOrderEvent } from '../lib/driverNotify';
import { recordVendorSettlement } from '../lib/commission';

export async function listAllOrders(req: Request, res: Response) {
  const { status, vendorId, customerId, page: pageRaw, limit: limitRaw } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (vendorId) filter.vendorId = vendorId;
  if (customerId) filter.customerId = customerId;

  const page = Math.max(1, Number(pageRaw) || 1);
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 50));

  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ items: items.map((o) => toSafeJson(o, ['deliveryOtpHash'])), page, limit, total, totalPages: Math.ceil(total / limit) });
}

export async function getOrderForAdmin(req: Request, res: Response) {
  const order = await Order.findById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');
  res.json(toSafeJson(order, ['deliveryOtpHash']));
}

export async function updateOrderStatusAsAdmin(req: Request, res: Response) {
  const order = await Order.findById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');

  const nextStatus = req.body.status as OrderStatus;
  if (!canTransition(order.status, nextStatus, 'admin')) {
    throw new HttpError(409, `Cannot move order from "${order.status}" to "${nextStatus}"`);
  }

  if (nextStatus === 'cancelled' || nextStatus === 'rejected') {
    for (const item of order.items) {
      await Product.updateOne({ _id: item.productId, 'variants.id': item.variantId }, { $inc: { 'variants.$.stock': item.quantity } });
    }
  }

  const now = new Date();
  order.status = nextStatus;
  order.statusHistory.push({ status: nextStatus, at: now, note: req.body.note });
  if (nextStatus === 'cancelled') {
    order.cancelledBy = 'admin';
    order.cancelReason = req.body.note;
  }
  if (nextStatus === 'delivered') order.deliveredAt = now;
  await order.save();

  await notifyOrderStatusChange(order.customerId, order._id, order.orderNumber, nextStatus, req.body.note);
  if (nextStatus === 'cancelled') {
    await notifyVendor(
      order.vendorId,
      'order-cancellation',
      `Order #${order.orderNumber} Cancelled`,
      req.body.note ? `Cancelled by Verdant · ${req.body.note}` : 'Cancelled by Verdant',
      { orderId: order._id },
    );
    if (order.driverId) {
      await notifyDriverOrderEvent(order.driverId, 'order-cancelled', order._id, order.orderNumber, req.body.note);
    }
  } else if (nextStatus === 'delivered') {
    await recordVendorSettlement(order);
    await notifyVendor(
      order.vendorId,
      'payment',
      'Payment Received',
      `Order #${order.orderNumber} · ₹${order.pricing.grandTotal}`,
      { orderId: order._id },
    );
  }

  res.json(toSafeJson(order, ['deliveryOtpHash']));
}
