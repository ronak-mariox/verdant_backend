import { Types } from 'mongoose';
import { VendorSettlement } from '../models/VendorSettlement';
import { VendorPayoutBatch } from '../models/VendorPayoutBatch';

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
 * Groups the vendor's real VendorSettlement rows (populated on delivery) into
 * Mon-Sun calendar weeks and creates a VendorPayoutBatch for any week that has
 * settlements but no batch yet. Idempotent — safe to call on every read.
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

  const existingBatches = await VendorPayoutBatch.find({ vendorId }, { periodStart: 1 });
  const existingWeekStarts = new Set(existingBatches.map((b) => b.periodStart.getTime()));

  for (const [weekStartMs, rows] of byWeekStart) {
    if (existingWeekStarts.has(weekStartMs)) continue;

    const grossSales = rows.reduce((sum, r) => sum + r.grossAmount, 0);
    const commission = rows.reduce((sum, r) => sum + r.commissionAmount, 0);
    const gstOnCommission = rows.reduce((sum, r) => sum + r.gstOnCommission, 0);
    const netPayout = rows.reduce((sum, r) => sum + r.netPayout, 0);
    const commissionRate = grossSales > 0 ? commission / grossSales : rows[0].commissionRate;
    const weekStart = new Date(weekStartMs);

    try {
      await VendorPayoutBatch.create({
        vendorId,
        periodStart: weekStart,
        periodEnd: endOfWeek(weekStart),
        grossSales,
        returns: 0,
        netSales: grossSales,
        commissionRate,
        commission,
        gstOnCommission,
        adjustments: 0,
        netPayout,
        status: 'pending',
      });
    } catch (err) {
      // Unique index race (concurrent request created it first) — safe to ignore.
      const code = (err as { code?: number }).code;
      if (code !== 11000) throw err;
    }
  }
}
