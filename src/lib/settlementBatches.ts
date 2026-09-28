import { Types } from 'mongoose';
import { VendorSettlement } from '../models/VendorSettlement';
import { VendorPayoutBatch } from '../models/VendorPayoutBatch';
import { PLATFORM_FEE_RATE } from './commission';
import { round2 } from './pricing';

/** Monday 00:00:00 of the week containing `date`. */
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sun ... 6 = Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

function endOfWeek(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 7);
  return d;
}

/**
 * Groups the vendor's VendorSettlement rows into Mon-Sun calendar weeks, creates a
 * VendorPayoutBatch for any week without one, and re-totals every batch that is
 * still `pending` — so deliveries that land after a batch was first created are
 * still paid out. Paid/failed batches are frozen. Idempotent; safe on every read.
 */
export async function ensureBatchesForVendor(vendorId: string | Types.ObjectId): Promise<void> {
  const settlements = await VendorSettlement.find({ vendorId }).sort({ settledAt: 1 });
  if (settlements.length === 0) return;

  const byWeekStart = new Map<number, typeof settlements>();
  for (const settlement of settlements) {
    const weekStart = startOfWeek(settlement.settledAt).getTime();
    const bucket = byWeekStart.get(weekStart);
    if (bucket) bucket.push(settlement);
    else byWeekStart.set(weekStart, [settlement]);
  }

  const existingBatches = await VendorPayoutBatch.find({ vendorId });
  const batchByWeekStart = new Map(existingBatches.map((b) => [b.periodStart.getTime(), b]));

  for (const [weekStartMs, rows] of byWeekStart) {
    const totals = {
      grossSales: round2(rows.reduce((sum, r) => sum + r.grossAmount, 0)),
      commission: round2(rows.reduce((sum, r) => sum + r.commissionAmount, 0)),
      gstOnCommission: round2(rows.reduce((sum, r) => sum + r.gstOnCommission, 0)),
      netPayout: round2(rows.reduce((sum, r) => sum + r.netPayout, 0)),
      settlementIds: rows.map((r) => r._id as Types.ObjectId),
      settlementCount: rows.length,
    };
    const weekStart = new Date(weekStartMs);
    const existing = batchByWeekStart.get(weekStartMs);

    if (!existing) {
      try {
        await VendorPayoutBatch.create({
          vendorId,
          periodStart: weekStart,
          periodEnd: endOfWeek(weekStart),
          ...totals,
          returns: 0,
          netSales: totals.grossSales,
          commissionRate: PLATFORM_FEE_RATE,
          adjustments: 0,
          status: 'pending',
        });
      } catch (err) {
        // Unique index race (concurrent request created it first) — safe to ignore.
        const code = (err as { code?: number }).code;
        if (code !== 11000) throw err;
      }
      continue;
    }

    if (existing.status !== 'pending') continue;
    if (existing.settlementCount === totals.settlementCount && existing.netPayout === totals.netPayout) continue;

    await VendorPayoutBatch.updateOne(
      { _id: existing._id, status: 'pending' },
      { $set: { ...totals, netSales: totals.grossSales, commissionRate: PLATFORM_FEE_RATE } },
    );
  }
}

export async function ensureBatchesForAllVendors(): Promise<void> {
  const vendorIds = await VendorSettlement.distinct('vendorId');
  for (const vendorId of vendorIds) {
    await ensureBatchesForVendor(vendorId as Types.ObjectId);
  }
}
