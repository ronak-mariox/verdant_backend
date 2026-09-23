import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Order } from '../models/Order';
import { DriverOrderResponse } from '../models/DriverOrderResponse';
import { Rating } from '../models/Rating';

const ON_TIME_WINDOW_MINUTES = 45;

async function acceptanceRate(driverId: Types.ObjectId) {
  const rows = await DriverOrderResponse.aggregate([
    { $match: { driverId } },
    { $group: { _id: '$response', count: { $sum: 1 } } },
  ]);
  const byResponse = Object.fromEntries(rows.map((r) => [r._id, r.count as number]));
  const accepted = byResponse.accepted ?? 0;
  const rejected = byResponse.rejected ?? 0;
  const total = accepted + rejected;
  return { accepted, rejected, total, rate: total === 0 ? 0 : Math.round((accepted / total) * 100) };
}

async function completionRate(driverId: Types.ObjectId) {
  const [delivered, cancelled] = await Promise.all([
    Order.countDocuments({ driverId, status: 'delivered' }),
    Order.countDocuments({ driverId, status: 'cancelled', cancelledBy: 'driver' }),
  ]);
  const total = delivered + cancelled;
  return { delivered, cancelled, total, rate: total === 0 ? 0 : Math.round((delivered / total) * 100) };
}

async function onTimeRate(driverId: Types.ObjectId) {
  const delivered = await Order.find({ driverId, status: 'delivered', pickupConfirmedAt: { $ne: null }, deliveredAt: { $ne: null } })
    .select('pickupConfirmedAt deliveredAt')
    .lean();

  if (delivered.length === 0) return { onTime: 0, total: 0, rate: 0 };

  const onTime = delivered.filter((o) => {
    const minutes = (new Date(o.deliveredAt!).getTime() - new Date(o.pickupConfirmedAt!).getTime()) / 60000;
    return minutes <= ON_TIME_WINDOW_MINUTES;
  }).length;

  return { onTime, total: delivered.length, rate: Math.round((onTime / delivered.length) * 100) };
}

async function ratingSummary(driverId: Types.ObjectId) {
  const rows = await Rating.aggregate([
    { $match: { driverId } },
    { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } },
  ]);
  return { average: rows[0] ? Math.round(rows[0].avg * 10) / 10 : null, count: rows[0]?.count ?? 0 };
}

async function rankAmongDrivers(driverId: Types.ObjectId) {
  const totals = await Order.aggregate([
    { $match: { status: 'delivered', driverId: { $ne: null } } },
    { $group: { _id: '$driverId', delivered: { $sum: 1 } } },
    { $sort: { delivered: -1 } },
  ]);

  const totalDrivers = totals.length;
  const index = totals.findIndex((t) => String(t._id) === String(driverId));
  return { rank: index === -1 ? totalDrivers + 1 : index + 1, totalDrivers: totalDrivers || 1 };
}

export async function getSummary(req: Request, res: Response) {
  const driverId = new Types.ObjectId(req.user!.id);
  const [acceptance, completion, onTime, rating, rank] = await Promise.all([
    acceptanceRate(driverId),
    completionRate(driverId),
    onTimeRate(driverId),
    ratingSummary(driverId),
    rankAmongDrivers(driverId),
  ]);

  res.json({
    acceptanceRate: acceptance.rate,
    completionRate: completion.rate,
    onTimeRate: onTime.rate,
    rating: rating.average,
    ratingCount: rating.count,
    totalDeliveries: completion.delivered,
    rank: rank.rank,
    totalDrivers: rank.totalDrivers,
  });
}

export async function getAcceptanceRate(req: Request, res: Response) {
  res.json(await acceptanceRate(new Types.ObjectId(req.user!.id)));
}

export async function getCompletionRate(req: Request, res: Response) {
  res.json(await completionRate(new Types.ObjectId(req.user!.id)));
}

export async function getRating(req: Request, res: Response) {
  const driverId = new Types.ObjectId(req.user!.id);
  const [summary, reviews] = await Promise.all([
    ratingSummary(driverId),
    Rating.find({ driverId }).sort({ createdAt: -1 }).limit(20).select('stars reviewText createdAt'),
  ]);
  res.json({ ...summary, reviews });
}

const MILESTONES = [10, 50, 100, 250, 500, 1000, 2500, 5000];

export async function getMilestones(req: Request, res: Response) {
  const totalDeliveries = await Order.countDocuments({ driverId: req.user!.id, status: 'delivered' });
  const milestones = MILESTONES.map((target) => ({
    target,
    achieved: totalDeliveries >= target,
    progress: Math.min(totalDeliveries, target),
  }));
  res.json({ totalDeliveries, milestones });
}
