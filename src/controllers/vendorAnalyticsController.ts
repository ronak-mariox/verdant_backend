import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Order, type OrderStatus } from '../models/Order';
import { Product } from '../models/Product';

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
    // 'month' and the unbuilt 'custom' date-range picker both fall back to a
    // trailing 30 days for now.
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

const DELIVERED: OrderStatus = 'delivered';
const CANCELLED_LIKE: OrderStatus[] = ['cancelled', 'rejected'];

async function revenueAndOrders(vendorId: Types.ObjectId, from: Date, to: Date) {
  const [revenueAgg, orderCount, cancelledCount] = await Promise.all([
    Order.aggregate([
      { $match: { vendorId, status: DELIVERED, deliveredAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, revenue: { $sum: '$pricing.grandTotal' } } },
    ]),
    Order.countDocuments({ vendorId, createdAt: { $gte: from, $lte: to } }),
    Order.countDocuments({ vendorId, status: { $in: CANCELLED_LIKE }, createdAt: { $gte: from, $lte: to } }),
  ]);
  return { revenue: revenueAgg[0]?.revenue ?? 0, orders: orderCount, cancelled: cancelledCount };
}

/** Daily-bucketed series for each KPI's own sparkline — revenue is keyed by
 * `deliveredAt` (when the sale actually completed), orders/cancelled by
 * `createdAt` (when they were placed), so the two are computed separately
 * and then merged onto a shared, sorted set of dates. */
async function dailySeries(vendorId: Types.ObjectId, from: Date, to: Date) {
  const [revenueRows, orderRows] = await Promise.all([
    Order.aggregate([
      { $match: { vendorId, status: DELIVERED, deliveredAt: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$deliveredAt' } }, revenue: { $sum: '$pricing.grandTotal' } } },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: { vendorId, createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          orders: { $sum: 1 },
          cancelled: { $sum: { $cond: [{ $in: ['$status', CANCELLED_LIKE] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const dates = Array.from(new Set([...revenueRows.map((r) => r._id), ...orderRows.map((r) => r._id)])).sort();
  const revenueByDate = new Map(revenueRows.map((r) => [r._id, r.revenue as number]));
  const orderByDate = new Map(orderRows.map((r) => [r._id, r as { orders: number; cancelled: number }]));

  const revenueTrend = dates.map((d) => Math.round(revenueByDate.get(d) ?? 0));
  const ordersTrend = dates.map((d) => orderByDate.get(d)?.orders ?? 0);
  const cancelledTrend = dates.map((d) => orderByDate.get(d)?.cancelled ?? 0);
  const avgOrderTrend = dates.map((_d, i) => (ordersTrend[i] > 0 ? Math.round(revenueTrend[i] / ordersTrend[i]) : 0));

  return { dates, revenueTrend, ordersTrend, avgOrderTrend, cancelledTrend };
}

export async function getOverview(req: Request, res: Response) {
  const vendorId = new Types.ObjectId(req.user!.id);
  const { from, to, prevFrom, prevTo } = periodRange(req.query.period as Period | undefined);

  const [current, previous, series] = await Promise.all([
    revenueAndOrders(vendorId, from, to),
    revenueAndOrders(vendorId, prevFrom, prevTo),
    dailySeries(vendorId, from, to),
  ]);

  const avgOrder = current.orders > 0 ? Math.round(current.revenue / current.orders) : 0;
  const prevAvgOrder = previous.orders > 0 ? Math.round(previous.revenue / previous.orders) : 0;

  const kpiStats = [
    { key: 'revenue', label: 'Revenue', value: `₹${current.revenue.toLocaleString('en-IN')}`, sparkline: series.revenueTrend, ...percentChange(current.revenue, previous.revenue) },
    { key: 'orders', label: 'Orders', value: String(current.orders), sparkline: series.ordersTrend, ...percentChange(current.orders, previous.orders) },
    { key: 'avgOrder', label: 'Avg Order', value: `₹${avgOrder}`, sparkline: series.avgOrderTrend, ...percentChange(avgOrder, prevAvgOrder) },
    { key: 'cancelled', label: 'Cancelled', value: String(current.cancelled), sparkline: series.cancelledTrend, ...percentChange(current.cancelled, previous.cancelled) },
  ];

  res.json({ kpiStats, revenueTrend: series.revenueTrend, revenueDates: series.dates });
}

async function productRevenueByPeriod(vendorId: Types.ObjectId, from: Date, to: Date) {
  return Order.aggregate([
    { $match: { vendorId, status: { $ne: 'cancelled' }, createdAt: { $gte: from, $lte: to } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        name: { $first: '$items.name' },
        revenue: { $sum: '$items.subtotal' },
        units: { $sum: '$items.quantity' },
        orders: { $sum: 1 },
      },
    },
  ]);
}

export async function getBestSelling(req: Request, res: Response) {
  const vendorId = new Types.ObjectId(req.user!.id);
  const { from, to, prevFrom, prevTo } = periodRange(req.query.period as Period | undefined);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));

  const [rows, prevRows] = await Promise.all([
    productRevenueByPeriod(vendorId, from, to),
    productRevenueByPeriod(vendorId, prevFrom, prevTo),
  ]);
  const prevRevenueById = new Map(prevRows.map((r) => [String(r._id), r.revenue as number]));

  const sorted = rows.sort((a, b) => b.revenue - a.revenue).slice(0, limit);
  res.json(
    sorted.map((r) => {
      const prevRevenue = prevRevenueById.get(String(r._id)) ?? 0;
      const trend: 'up' | 'down' | 'flat' = r.revenue > prevRevenue ? 'up' : r.revenue < prevRevenue ? 'down' : 'flat';
      return { name: r.name, revenue: Math.round(r.revenue), units: r.units, orders: r.orders, trend };
    }),
  );
}

export async function getLowPerforming(req: Request, res: Response) {
  const vendorId = req.user!.id;
  const { from, to } = periodRange(req.query.period as Period | undefined);

  const [products, sold] = await Promise.all([
    Product.find({ vendorId, status: 'active' }),
    Order.aggregate([
      { $match: { vendorId: new Types.ObjectId(vendorId), status: { $ne: 'cancelled' }, createdAt: { $gte: from, $lte: to } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', units: { $sum: '$items.quantity' }, revenue: { $sum: '$items.subtotal' }, lastSoldAt: { $max: '$createdAt' } } },
    ]),
  ]);

  const soldById = new Map(sold.map((s) => [String(s._id), s]));
  const now = Date.now();

  const rows = products.map((p) => {
    const s = soldById.get(String(p._id));
    const stock = p.variants.reduce((sum, v) => sum + v.stock, 0);
    const unitsSold = s?.units ?? 0;
    const daysSinceLastSale = s?.lastSoldAt ? Math.floor((now - new Date(s.lastSoldAt).getTime()) / (24 * 60 * 60 * 1000)) : null;

    let suggestion: string;
    if (unitsSold === 0 && daysSinceLastSale === null) {
      suggestion = "Never sold — consider featuring it or checking the listing";
    } else if (daysSinceLastSale !== null && daysSinceLastSale > 14) {
      suggestion = `No sales in ${daysSinceLastSale} days — low visibility`;
    } else if (stock > 50 && unitsSold < 5) {
      suggestion = 'High stock, low demand — consider a promotional discount';
    } else {
      suggestion = 'Selling below average — keep an eye on it';
    }

    return {
      name: p.name,
      unitsSold,
      revenue: Math.round(s?.revenue ?? 0),
      daysSinceLastSale,
      stock,
      suggestion,
    };
  });

  rows.sort((a, b) => a.unitsSold - b.unitsSold);
  res.json(rows.slice(0, 10));
}

/**
 * A real (if approximate) inventory-turnover picture computed from data that
 * actually exists — units sold in the period vs. current stock — rather than
 * fabricated numbers. Without a persisted stock-history ledger there's no way
 * to know a product's stock level at any past moment, so this uses *current*
 * stock as a stand-in for "stock over the period", which is the standard
 * simplification when true average inventory isn't tracked.
 */
export async function getInventoryPerformance(req: Request, res: Response) {
  const vendorId = req.user!.id;
  const { from, to } = periodRange(req.query.period as Period | undefined);
  const periodDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));

  const [products, sold, stockoutIncidents] = await Promise.all([
    Product.find({ vendorId, status: 'active' }),
    Order.aggregate([
      { $match: { vendorId: new Types.ObjectId(vendorId), status: { $ne: 'cancelled' }, createdAt: { $gte: from, $lte: to } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', units: { $sum: '$items.quantity' } } },
    ]),
    Order.countDocuments({
      vendorId: new Types.ObjectId(vendorId),
      status: { $in: CANCELLED_LIKE },
      createdAt: { $gte: from, $lte: to },
      cancelReason: { $regex: /stock/i },
    }),
  ]);

  const soldById = new Map(sold.map((s) => [String(s._id), s.units as number]));
  let totalUnitsSold = 0;
  let totalStock = 0;
  let deadStockValue = 0;
  let deadStockCount = 0;

  for (const p of products) {
    const units = soldById.get(String(p._id)) ?? 0;
    const stock = p.variants.reduce((sum, v) => sum + v.stock, 0);
    const price = p.variants[0]?.price ?? 0;
    totalUnitsSold += units;
    totalStock += stock;
    if (units === 0 && stock > 0) {
      deadStockValue += stock * price;
      deadStockCount += 1;
    }
  }

  const turnoverRate = totalStock > 0 ? Math.round((totalUnitsSold / totalStock) * 100) / 100 : 0;
  const avgDaysToSellOut = turnoverRate > 0 ? Math.round(periodDays / turnoverRate) : null;

  res.json({
    turnoverRate,
    avgDaysToSellOut,
    stockoutIncidents,
    deadStockValue: Math.round(deadStockValue),
    deadStockCount,
  });
}

export async function getCancellationReasons(req: Request, res: Response) {
  const vendorId = new Types.ObjectId(req.user!.id);
  const { from, to } = periodRange(req.query.period as Period | undefined);

  const rows = await Order.aggregate([
    { $match: { vendorId, status: { $in: CANCELLED_LIKE }, createdAt: { $gte: from, $lte: to } } },
    { $group: { _id: { $ifNull: ['$cancelReason', 'No reason given'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const total = rows.reduce((sum, r) => sum + r.count, 0);
  res.json(rows.map((r) => ({ reason: r._id, count: r.count, percent: total > 0 ? Math.round((r.count / total) * 100) : 0 })));
}
