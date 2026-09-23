import type { Request, Response } from 'express';
import type { HydratedDocument } from 'mongoose';
import { Order, type OrderStatus, type OrderDoc } from '../models/Order';
import { Vendor } from '../models/Vendor';
import { Driver } from '../models/Driver';
import { DriverOrderResponse } from '../models/DriverOrderResponse';
import { DeliveryIssue, type DeliveryIssueType } from '../models/DeliveryIssue';
import { EarningsLedger } from '../models/EarningsLedger';
import { HttpError } from '../lib/httpError';
import { toSafeJson } from '../lib/sanitize';
import { canTransition } from '../lib/orderStatus';
import { notifyOrderStatusChange } from '../lib/notify';
import { createDeliveryOtp, compareDeliveryOtp } from '../lib/otp';
import { computeDeliveryEarnings, getDriverBalance } from '../lib/driverEarnings';
import { updateIncentiveProgress } from '../lib/incentives';
import { recordVendorSettlement } from '../lib/commission';
import { createTicketFromDeliveryIssue } from '../lib/supportTickets';
import { haversineKm } from '../lib/geo';
import { env } from '../lib/env';

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
      ...toSafeJson(o, ['deliveryOtpHash']),
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
  const orders = await Order.find({ status: 'ready_for_pickup', driverId: null }).sort({ placedAt: 1 });
  const withInfo = await withPickupInfo(orders);

  const driver = await Driver.findById(req.user!.id);
  const from = driver?.currentLocation;
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
  const order = await Order.findById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');

  await DriverOrderResponse.create({
    driverId: req.user!.id,
    orderId: order._id as never,
    response: 'rejected',
    reasonCode: req.body.reasonCode,
  });

  res.status(204).send();
}

export async function confirmPickup(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, driverId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  if (!canTransition(order.status, 'out_for_delivery', 'driver')) {
    throw new HttpError(409, `Cannot confirm pickup from status "${order.status}"`);
  }

  const now = new Date();
  const { hash, devOtp } = await createDeliveryOtp();

  order.pickupConfirmedAt = now;
  order.deliveryOtpHash = hash;
  order.status = 'out_for_delivery';
  order.statusHistory.push({ status: 'out_for_delivery', at: now });
  await order.save();

  await notifyOrderStatusChange(order.customerId, order._id, order.orderNumber, 'out_for_delivery');

  const [withInfo] = await withPickupInfo([order]);
  res.json(env.isProd ? withInfo : { ...withInfo, devOtp });
}

export async function verifyDeliveryOtp(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, driverId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.status !== 'out_for_delivery' || !order.deliveryOtpHash) {
    throw new HttpError(409, 'This order is not awaiting delivery confirmation');
  }

  const { otp } = req.body as { otp: string };
  const matches = await compareDeliveryOtp(otp, order.deliveryOtpHash);
  if (!matches) throw new HttpError(422, 'Incorrect OTP');

  if (!canTransition(order.status, 'delivered', 'driver')) {
    throw new HttpError(409, `Cannot mark delivered from status "${order.status}"`);
  }

  const now = new Date();
  const breakdown = await computeDeliveryEarnings(order);

  for (const [type, amount] of [
    ['delivery_fee', breakdown.base],
    ['distance_bonus', breakdown.distance],
    ['ontime_bonus', breakdown.onTimeBonus],
  ] as const) {
    if (amount <= 0) continue;
    const balanceAfter = (await getDriverBalance(req.user!.id)) + amount;
    await EarningsLedger.create({
      driverId: req.user!.id as never,
      orderId: order._id as never,
      type,
      amount,
      balanceAfter,
      status: 'pending',
      reason: `Order #${order.orderNumber}`,
    });
  }

  const incentiveBonus = await updateIncentiveProgress(req.user!.id, order);

  order.status = 'delivered';
  order.deliveredAt = now;
  order.statusHistory.push({ status: 'delivered', at: now });
  order.deliveryOtpHash = undefined;
  order.driverEarnings = {
    base: breakdown.base,
    distance: breakdown.distance,
    onTimeBonus: breakdown.onTimeBonus,
    incentiveBonus,
    total: breakdown.total + incentiveBonus,
  };
  await order.save();
  await recordVendorSettlement(order);

  await notifyOrderStatusChange(order.customerId, order._id, order.orderNumber, 'delivered');

  const [withInfo] = await withPickupInfo([order]);
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
    order.status = 'cancelled';
    order.cancelledBy = 'driver';
    order.cancelReason = description ?? type;
    order.statusHistory.push({ status: 'cancelled', at: now, note: description });
    order.driverId = undefined;
    await order.save();
    await notifyOrderStatusChange(order.customerId, order._id, order.orderNumber, 'cancelled', description);
  } else if (UNASSIGN_ISSUE_TYPES.includes(type)) {
    order.driverId = undefined;
    order.status = 'ready_for_pickup';
    order.statusHistory.push({ status: 'ready_for_pickup', at: now, note: `Reassigned after driver reported ${type}` });
    await order.save();
  }

  res.status(201).json({ issue: toSafeJson(issue), order: toSafeJson(order, ['deliveryOtpHash']) });
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
  const orders = await Order.find({ driverId: req.user!.id, status: { $in: statuses } }).sort({ createdAt: -1 });
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
