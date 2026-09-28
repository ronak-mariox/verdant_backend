import type { Request, Response } from 'express';
import type { HydratedDocument } from 'mongoose';
import { Order, type OrderStatus, type OrderDoc } from '../models/Order';
import { Vendor } from '../models/Vendor';
import { Driver } from '../models/Driver';
import { DriverOrderResponse } from '../models/DriverOrderResponse';
import { DeliveryIssue, type DeliveryIssueType } from '../models/DeliveryIssue';
import { EarningsLedger } from '../models/EarningsLedger';
import { HttpError } from '../lib/httpError';
import { arrayPagination, toSafeJson } from '../lib/sanitize';
import { applyReassignment, canTransition } from '../lib/orderStatus';
import { releaseOrderResources } from '../lib/orderStock';
import { notifyOrderStatusChange } from '../lib/notify';
import { notifyVendor } from '../lib/vendorNotify';
import { createDeliveryOtp, compareDeliveryOtp } from '../lib/otp';
import { computeDeliveryEarnings, getDriverBalance } from '../lib/driverEarnings';
import { updateIncentiveProgress } from '../lib/incentives';
import { recordVendorSettlement } from '../lib/commission';
import { createTicketFromDeliveryIssue } from '../lib/supportTickets';
import { publicUrlFor } from '../lib/upload';
import { haversineKm } from '../lib/geo';
import { env } from '../lib/env';

const DRIVER_OMIT = ['deliveryOtpHash', 'deliveryOtp', 'deliveryOtpAttempts'];
const MAX_DELIVERY_OTP_ATTEMPTS = 5;

/** Pending/unapproved riders can register and look around, but never touch orders. */
async function requireActiveDriver(driverId: string, opts: { online?: boolean } = {}) {
  const driver = await Driver.findById(driverId);
  if (!driver) throw new HttpError(404, 'Driver not found');
  if (driver.status !== 'active') {
    throw new HttpError(403, 'Your rider account must be approved before you can take orders', { reason: 'driver_not_active', status: driver.status });
  }
  if (opts.online && !driver.isOnline) {
    throw new HttpError(403, 'Go online to accept orders', { reason: 'driver_offline' });
  }
  return driver;
}

/** The driver app's order UI expects the pickup store's name/address/phone/location
 * inline on each order — Order only stores vendorId, so batch-join Vendor here rather
 * than duplicating that onto every order document. */
async function withPickupInfo(orders: HydratedDocument<OrderDoc>[]) {
  const vendorIds = [...new Set(orders.map((o) => String(o.vendorId)))];
  const vendors = await Vendor.find({ _id: { $in: vendorIds } });
  const byId = new Map(vendors.map((v) => [String(v._id), v]));

  return orders.map((o) => {
    const vendor = byId.get(String(o.vendorId));
    const addr = vendor?.storeSetupAddress;
    const pickupAddress = addr
      ? [addr.buildingShopNo, addr.street, addr.landmark, addr.area, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ')
      : undefined;

    return {
      ...toSafeJson(o, DRIVER_OMIT),
      pickup: {
        name: vendor?.storeProfile?.storeName ?? vendor?.businessInfo?.displayName ?? 'Store',
        phone: addr?.contactNumber ?? vendor?.phone,
        address: pickupAddress,
        latitude: addr?.location?.latitude,
        longitude: addr?.location?.longitude,
      },
    };
  });
}

export async function listAvailableOrders(req: Request, res: Response) {
  const driver = await requireActiveDriver(req.user!.id);
  const rejectedOrderIds = await DriverOrderResponse.distinct('orderId', { driverId: driver._id as never, response: 'rejected' });
  const orders = await Order.find({ status: 'ready_for_pickup', driverId: null, _id: { $nin: rejectedOrderIds } }).sort({ placedAt: 1 });
  const withInfo = await withPickupInfo(orders);

  const from = driver.currentLocation;
  if (from) {
    withInfo.sort((a, b) => {
      const pa = (a as { pickup: { latitude?: number; longitude?: number } }).pickup;
      const pb = (b as { pickup: { latitude?: number; longitude?: number } }).pickup;
      const da = pa.latitude != null && pa.longitude != null ? haversineKm(from, { lat: pa.latitude, lng: pa.longitude }) : Infinity;
      const db = pb.latitude != null && pb.longitude != null ? haversineKm(from, { lat: pb.latitude, lng: pb.longitude }) : Infinity;
      return da - db;
    });
  }

  res.json(withInfo);
}

export async function acceptOrder(req: Request, res: Response) {
  await requireActiveDriver(req.user!.id, { online: true });
  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, status: 'ready_for_pickup', driverId: null },
    { $set: { driverId: req.user!.id } },
    { new: true },
  );
  if (!order) throw new HttpError(409, 'This order is no longer available');

  await DriverOrderResponse.create({ driverId: req.user!.id, orderId: order._id as never, response: 'accepted' });

  const [withInfo] = await withPickupInfo([order]);
  res.status(200).json(withInfo);
}

export async function rejectOrder(req: Request, res: Response) {
  await requireActiveDriver(req.user!.id);
  const order = await Order.findById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.status !== 'ready_for_pickup' || order.driverId) {
    throw new HttpError(409, 'This order is no longer available to reject');
  }

  await DriverOrderResponse.create({
    driverId: req.user!.id,
    orderId: order._id as never,
    response: 'rejected',
    reasonCode: req.body.reasonCode,
  });

  res.status(204).send();
}

export async function confirmPickup(req: Request, res: Response) {
  await requireActiveDriver(req.user!.id);
  const order = await Order.findOne({ _id: req.params.id, driverId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  if (!canTransition(order.status, 'out_for_delivery', 'driver')) {
    throw new HttpError(409, `Cannot confirm pickup from status "${order.status}"`);
  }

  const now = new Date();
  const { code, hash, devOtp } = await createDeliveryOtp();

  order.pickupConfirmedAt = now;
  order.deliveryOtpHash = hash;
  // Dummy OTP flow (no SMS provider): the plaintext is kept so the customer app
  // can display it for the rider to check against.
  order.deliveryOtp = code;
  order.deliveryOtpAttempts = 0;
  order.status = 'out_for_delivery';
  order.statusHistory.push({ status: 'out_for_delivery', at: now });
  await order.save();

  await notifyOrderStatusChange(order, 'out_for_delivery');

  const [withInfo] = await withPickupInfo([order]);
  res.json(env.isProd ? withInfo : { ...withInfo, devOtp });
}

export async function verifyDeliveryOtp(req: Request, res: Response) {
  await requireActiveDriver(req.user!.id);
  const order = await Order.findOne({ _id: req.params.id, driverId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.status !== 'out_for_delivery' || !order.deliveryOtpHash) {
    throw new HttpError(409, 'This order is not awaiting delivery confirmation');
  }
  if ((order.deliveryOtpAttempts ?? 0) >= MAX_DELIVERY_OTP_ATTEMPTS) {
    throw new HttpError(429, 'Too many incorrect OTP attempts — contact support to complete this delivery', {
      reason: 'otp_attempts_exceeded',
    });
  }

  const { otp } = req.body as { otp: string };
  const matches = await compareDeliveryOtp(otp, order.deliveryOtpHash);
  if (!matches) {
    await Order.updateOne({ _id: order._id }, { $inc: { deliveryOtpAttempts: 1 } });
    const remaining = MAX_DELIVERY_OTP_ATTEMPTS - (order.deliveryOtpAttempts ?? 0) - 1;
    throw new HttpError(422, 'Incorrect OTP', { attemptsRemaining: Math.max(remaining, 0) });
  }

  const now = new Date();
  const breakdown = await computeDeliveryEarnings(order);

  // Mark delivered first and atomically — if two requests race, only one gets
  // past this point and writes the money rows.
  const delivered = await Order.findOneAndUpdate(
    { _id: order._id, driverId: req.user!.id, status: 'out_for_delivery' },
    {
      $set: {
        status: 'delivered',
        deliveredAt: now,
        paymentStatus: 'paid',
        driverEarnings: { base: breakdown.base, distance: breakdown.distance, onTimeBonus: breakdown.onTimeBonus, incentiveBonus: 0, total: breakdown.total },
      },
      $unset: { deliveryOtpHash: 1, deliveryOtp: 1 },
      $push: { statusHistory: { status: 'delivered', at: now } },
    },
    { new: true },
  );
  if (!delivered) throw new HttpError(409, 'This order was already completed');

  const alreadyLedgered = await EarningsLedger.exists({ driverId: req.user!.id, orderId: delivered._id as never, type: 'delivery_fee' });
  let incentiveBonus = 0;
  if (!alreadyLedgered) {
    for (const [type, amount] of [
      ['delivery_fee', breakdown.base],
      ['distance_bonus', breakdown.distance],
      ['ontime_bonus', breakdown.onTimeBonus],
    ] as const) {
      if (amount <= 0) continue;
      const balanceAfter = (await getDriverBalance(req.user!.id)) + amount;
      await EarningsLedger.create({
        driverId: req.user!.id as never,
        orderId: delivered._id as never,
        type,
        amount,
        balanceAfter,
        status: 'pending',
        reason: `Order #${delivered.orderNumber}`,
      });
    }

    incentiveBonus = await updateIncentiveProgress(req.user!.id, delivered);
    if (incentiveBonus > 0) {
      delivered.driverEarnings = { ...delivered.driverEarnings!, incentiveBonus, total: breakdown.total + incentiveBonus };
      await Order.updateOne({ _id: delivered._id }, { $set: { driverEarnings: delivered.driverEarnings } });
    }
  }

  await recordVendorSettlement(delivered);
  await notifyOrderStatusChange(delivered, 'delivered');
  await notifyVendor(
    delivered.vendorId,
    'payment',
    'Payment Received',
    `Order #${delivered.orderNumber} · ₹${delivered.pricing.grandTotal}`,
    { orderId: delivered._id, orderNumber: delivered.orderNumber },
  );

  const [withInfo] = await withPickupInfo([delivered]);
  res.json(withInfo);
}

const UNASSIGN_ISSUE_TYPES: DeliveryIssueType[] = ['vehicle_problem', 'road_blockage', 'safety_concern'];
const CANCEL_ISSUE_TYPES: DeliveryIssueType[] = ['delivery_failed'];

export async function reportIssue(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, driverId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');

  const { type, description, evidenceUrls } = req.body as {
    type: DeliveryIssueType;
    description?: string;
    evidenceUrls?: string[];
  };

  const issue = await DeliveryIssue.create({
    driverId: req.user!.id,
    orderId: order._id as never,
    type,
    description,
    evidenceUrls,
  });

  const driver = await Driver.findById(req.user!.id);
  await createTicketFromDeliveryIssue(issue, driver, order);

  const now = new Date();
  if (CANCEL_ISSUE_TYPES.includes(type) && canTransition(order.status, 'cancelled', 'driver')) {
    await releaseOrderResources(order);
    order.status = 'cancelled';
    order.cancelledBy = 'driver';
    order.cancelReason = description ?? type;
    order.statusHistory.push({ status: 'cancelled', at: now, note: description });
    order.deliveryOtpHash = undefined;
    order.deliveryOtp = undefined;
    await order.save();
    await notifyOrderStatusChange(order, 'cancelled', description);
    await notifyVendor(
      order.vendorId,
      'order-cancellation',
      `Order #${order.orderNumber} Cancelled`,
      description ? `Delivery failed · ${description}` : 'Delivery failed',
      { orderId: order._id, orderNumber: order.orderNumber },
    );
  } else if (UNASSIGN_ISSUE_TYPES.includes(type)) {
    applyReassignment(order, 'driver', `Reassigned after driver reported ${type}`);
    await order.save();
  }

  res.status(201).json({ issue: toSafeJson(issue), order: toSafeJson(order, DRIVER_OMIT) });
}

export async function uploadEvidence(req: Request, res: Response) {
  if (!req.file) throw new HttpError(400, 'No file uploaded — field name must be "file"');
  res.status(201).json({ url: publicUrlFor(req.file.filename) });
}

export async function listActiveOrders(req: Request, res: Response) {
  const orders = await Order.find({
    driverId: req.user!.id,
    status: { $in: ['ready_for_pickup', 'out_for_delivery'] },
  }).sort({ createdAt: -1 });
  res.json(await withPickupInfo(orders));
}

const HISTORY_TABS: Record<string, OrderStatus[]> = {
  completed: ['delivered'],
  cancelled: ['cancelled'],
  all: ['delivered', 'cancelled'],
};

export async function listOrderHistory(req: Request, res: Response) {
  const tab = (req.query.tab as string) || 'all';
  const statuses = HISTORY_TABS[tab] ?? HISTORY_TABS.all;
  const { skip, limit } = arrayPagination(req.query as Record<string, unknown>);
  const orders = await Order.find({ driverId: req.user!.id, status: { $in: statuses } }).sort({ createdAt: -1 }).skip(skip).limit(limit);
  res.json(await withPickupInfo(orders));
}

export async function getOrderById(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, driverId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  const [withInfo] = await withPickupInfo([order]);
  res.json(withInfo);
}

export async function getOrderTimeline(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, driverId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  res.json(order.statusHistory);
}
