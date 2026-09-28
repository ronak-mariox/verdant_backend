import type { Request, Response } from 'express';
import type { HydratedDocument } from 'mongoose';
import { Order } from '../models/Order';
import { Customer } from '../models/Customer';
import { HttpError } from '../lib/httpError';
import { arrayPagination, toSafeJson } from '../lib/sanitize';
import { canTransition } from '../lib/orderStatus';
import { releaseOrderResources } from '../lib/orderStock';
import { notifyOrderStatusChange } from '../lib/notify';
import { notifyDriverOrderEvent } from '../lib/driverNotify';
import type { OrderStatus, OrderDoc } from '../models/Order';

/** The vendor app's order UI expects the customer's name/phone inline on each
 * order — Order only stores customerId, so batch-join Customer here rather
 * than duplicating name/phone onto every order document. */
async function withCustomerInfo(orders: HydratedDocument<OrderDoc>[]) {
  const customerIds = [...new Set(orders.map((o) => String(o.customerId)))];
  const customers = await Customer.find({ _id: { $in: customerIds } });
  const byId = new Map(customers.map((c) => [String(c._id), c]));

  return orders.map((o) => {
    const customer = byId.get(String(o.customerId));
    return {
      ...toSafeJson(o, ['deliveryOtpHash', 'deliveryOtp', 'deliveryOtpAttempts']),
      customerName: customer?.name ?? 'Customer',
      customerPhone: customer?.phone,
    };
  });
}

export async function listMyOrders(req: Request, res: Response) {
  const { status } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = { vendorId: req.user!.id };
  if (status) filter.status = status;
  const { skip, limit } = arrayPagination(req.query as Record<string, unknown>);
  const orders = await Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
  res.json(await withCustomerInfo(orders));
}

export async function getMyOrder(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, vendorId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  const [withInfo] = await withCustomerInfo([order]);
  res.json(withInfo);
}

export async function updateOrderStatus(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, vendorId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');

  const nextStatus = req.body.status as OrderStatus;
  if (!canTransition(order.status, nextStatus, 'vendor')) {
    throw new HttpError(409, `Cannot move order from "${order.status}" to "${nextStatus}"`);
  }

  const isTerminal = nextStatus === 'rejected' || nextStatus === 'cancelled';
  if (isTerminal) await releaseOrderResources(order);

  const now = new Date();
  order.status = nextStatus;
  order.statusHistory.push({ status: nextStatus, at: now, note: req.body.note });
  if (isTerminal) {
    order.cancelledBy = 'vendor';
    order.cancelReason = req.body.note;
  }
  await order.save();

  await notifyOrderStatusChange(order, nextStatus, req.body.note);
  if (nextStatus === 'cancelled' && order.driverId) {
    await notifyDriverOrderEvent(order.driverId, 'order-cancelled', order._id, order.orderNumber, req.body.note);
  }

  const [withInfo] = await withCustomerInfo([order]);
  res.json(withInfo);
}
