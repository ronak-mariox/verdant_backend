import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Order } from '../models/Order';
import { EarningsLedger } from '../models/EarningsLedger';
import { HttpError } from '../lib/httpError';
import { toSafeJson } from '../lib/sanitize';

type Period = 'today' | 'week' | 'month' | 'custom';

function periodRange(period: string | undefined) {
  const to = new Date();
  let from: Date;
  if (period === 'today') {
    from = new Date(to);
    from.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  const durationMs = to.getTime() - from.getTime();
  const prevTo = from;
  const prevFrom = new Date(from.getTime() - durationMs);
  return { from, to, prevFrom, prevTo };
}

function percentChange(current: number, previous: number): { changeLabel: string; direction: 'up' | 'down' | 'flat' } {
  if (previous === 0) {
    if (current === 0) return { changeLabel: 'No change', direction: 'flat' };
    return { changeLabel: 'New activity', direction: 'up' };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { changeLabel: 'No change vs previous period', direction: 'flat' };
  const direction = pct > 0 ? 'up' : 'down';
  return { changeLabel: `${direction === 'up' ? '↑' : '↓'} ${Math.abs(pct)}% vs previous period`, direction };
}

async function totalsByType(driverId: Types.ObjectId, from: Date, to: Date) {
  const rows = await EarningsLedger.aggregate([
    { $match: { driverId, createdAt: { $gte: from, $lte: to } } },
    { $group: { _id: '$type', total: { $sum: '$amount' } } },
  ]);
  const byType = Object.fromEntries(rows.map((r) => [r._id, r.total as number]));
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  return { total, byType };
}

export async function getSummary(req: Request, res: Response) {
  const driverId = new Types.ObjectId(req.user!.id);
  const { from, to, prevFrom, prevTo } = periodRange(req.query.period as Period | undefined);

  const [current, previous, deliveries] = await Promise.all([
    totalsByType(driverId, from, to),
    totalsByType(driverId, prevFrom, prevTo),
    Order.countDocuments({ driverId, status: 'delivered', deliveredAt: { $gte: from, $lte: to } }),
  ]);

  res.json({
    totalEarnings: Math.round(current.total),
    deliveries,
    breakdown: {
      deliveryFee: Math.round(current.byType.delivery_fee ?? 0),
      distanceBonus: Math.round(current.byType.distance_bonus ?? 0),
      onTimeBonus: Math.round(current.byType.ontime_bonus ?? 0),
      incentiveBonus: Math.round(current.byType.incentive_bonus ?? 0),
    },
    ...percentChange(current.total, previous.total),
  });
}

export async function getHistory(req: Request, res: Response) {
  const driverId = req.user!.id;
  const { page: pageRaw, limit: limitRaw } = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(pageRaw) || 1);
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 30));

  const [items, total] = await Promise.all([
    EarningsLedger.find({ driverId }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    EarningsLedger.countDocuments({ driverId }),
  ]);

  res.json({ items: items.map((i) => toSafeJson(i)), page, limit, total, totalPages: Math.ceil(total / limit) });
}

export async function getBreakdown(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.orderId, driverId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');

  const ledgerRows = await EarningsLedger.find({ driverId: req.user!.id, orderId: order._id as never }).sort({ createdAt: 1 });

  res.json({
    orderNumber: order.orderNumber,
    driverEarnings: order.driverEarnings ?? null,
    ledger: ledgerRows.map((r) => toSafeJson(r)),
  });
}

const PAYOUT_CYCLE_DAYS = 7;

export async function getPayoutStatus(req: Request, res: Response) {
  const driverId = new Types.ObjectId(req.user!.id);

  const [pendingAgg, settledAgg] = await Promise.all([
    EarningsLedger.aggregate([
      { $match: { driverId, status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    EarningsLedger.aggregate([
      { $match: { driverId, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilPayout = (PAYOUT_CYCLE_DAYS - dayOfWeek) % PAYOUT_CYCLE_DAYS || PAYOUT_CYCLE_DAYS;
  const nextPayoutDate = new Date(now.getTime() + daysUntilPayout * 24 * 60 * 60 * 1000);
  nextPayoutDate.setHours(0, 0, 0, 0);

  res.json({
    pendingAmount: Math.round(pendingAgg[0]?.total ?? 0),
    lifetimePaid: Math.round(settledAgg[0]?.total ?? 0),
    nextPayoutDate,
  });
}
