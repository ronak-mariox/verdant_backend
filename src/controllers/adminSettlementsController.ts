import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { VendorSettlement } from '../models/VendorSettlement';
import { VendorPayoutBatch } from '../models/VendorPayoutBatch';
import { Vendor, type VendorDoc } from '../models/Vendor';
import { Driver } from '../models/Driver';
import { EarningsLedger } from '../models/EarningsLedger';
import { objectPagination, toSafeJson } from '../lib/sanitize';
import { HttpError } from '../lib/httpError';
import { ensureBatchesForAllVendors } from '../lib/settlementBatches';

function vendorDisplayName(v: Pick<VendorDoc, 'storeProfile' | 'businessInfo' | 'fullName' | 'phone'>): string {
  return v.storeProfile?.storeName || v.businessInfo?.displayName || v.fullName || v.phone;
}

/** Real per-order commission ledger across all vendors — no "paid/pending" status
 * exists on the backend (bank transfers to vendors aren't tracked in-app), so this
 * is a flat, honest listing rather than the old mock's fabricated weekly runs. */
export async function listVendorSettlements(req: Request, res: Response) {
  const { page: pageRaw, limit: limitRaw } = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(pageRaw) || 1);
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 50));

  const [items, total] = await Promise.all([
    VendorSettlement.find().sort({ settledAt: -1 }).skip((page - 1) * limit).limit(limit),
    VendorSettlement.countDocuments(),
  ]);

  const vendorIds = [...new Set(items.map((s) => String(s.vendorId)))];
  const vendors = await Vendor.find({ _id: { $in: vendorIds } });
  const nameById = new Map(vendors.map((v) => [String(v._id), vendorDisplayName(v)]));

  res.json({
    items: items.map((s) => ({
      ...toSafeJson(s),
      vendorName: nameById.get(String(s.vendorId)) ?? 'Unknown vendor',
    })),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
}

/** Aggregates each driver's real EarningsLedger entries into one summary row —
 * status is derived from the actual pending/settled/paid buckets, never fabricated. */
export async function listDriverPayouts(_req: Request, res: Response) {
  const rows = await EarningsLedger.aggregate([
    {
      $group: {
        _id: '$driverId',
        pendingAmount: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } },
        settledAmount: { $sum: { $cond: [{ $eq: ['$status', 'settled'] }, '$amount', 0] } },
        paidAmount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
        deliveries: { $sum: { $cond: [{ $eq: ['$type', 'delivery_fee'] }, 1, 0] } },
        updatedAt: { $max: '$updatedAt' },
      },
    },
  ]);

  const driverIds = rows.map((r) => r._id as Types.ObjectId);
  const drivers = await Driver.find({ _id: { $in: driverIds } });
  const driverById = new Map(drivers.map((d) => [String(d._id), d]));

  const summaries = rows.map((r) => {
    const driver = driverById.get(String(r._id));
    const status = r.pendingAmount > 0 ? 'pending' : r.settledAmount > 0 ? 'processing' : 'paid';
    return {
      driverId: String(r._id),
      driverName: driver ? driver.fullName || driver.phone : 'Unknown driver',
      deliveries: r.deliveries,
      pendingAmount: Math.round(r.pendingAmount),
      settledAmount: Math.round(r.settledAmount),
      paidAmount: Math.round(r.paidAmount),
      totalEarnings: Math.round(r.pendingAmount + r.settledAmount + r.paidAmount),
      status,
      updatedAt: r.updatedAt,
    };
  });

  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json(summaries);
}

/** Weekly payout batches across all vendors — batches are (re)built from the
 * settlement ledger on every read so the list is never stale. */
export async function listPayoutBatches(req: Request, res: Response) {
  await ensureBatchesForAllVendors();

  const { status } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  const { page, limit, skip } = objectPagination(req.query as Record<string, unknown>);

  const [items, total] = await Promise.all([
    VendorPayoutBatch.find(filter).sort({ periodStart: -1, createdAt: -1 }).skip(skip).limit(limit),
    VendorPayoutBatch.countDocuments(filter),
  ]);

  const vendorIds = [...new Set(items.map((b) => String(b.vendorId)))];
  const vendors = await Vendor.find({ _id: { $in: vendorIds } });
  const nameById = new Map(vendors.map((v) => [String(v._id), vendorDisplayName(v)]));

  res.json({
    items: items.map((b) => ({
      ...toSafeJson(b),
      vendorName: nameById.get(String(b.vendorId)) ?? 'Unknown vendor',
    })),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
}

/** The only truthful source of a "paid" payout status — actual bank transfers to
 * vendors happen outside the app, so this records what an admin confirmed. */
export async function markPayoutBatchPaid(req: Request, res: Response) {
  const batch = await VendorPayoutBatch.findById(req.params.id);
  if (!batch) throw new HttpError(404, 'Payout batch not found');

  const { bankAccountLabel, transactionRef } = req.body as {
    bankAccountLabel?: string;
    transactionRef?: string;
  };

  batch.status = 'paid';
  batch.bankAccountLabel = bankAccountLabel;
  batch.transactionRef = transactionRef;
  batch.transactionDate = new Date();
  batch.failureReason = undefined;
  await batch.save();

  res.json(toSafeJson(batch));
}

export async function markPayoutBatchFailed(req: Request, res: Response) {
  const batch = await VendorPayoutBatch.findById(req.params.id);
  if (!batch) throw new HttpError(404, 'Payout batch not found');

  const { failureReason } = req.body as { failureReason?: string };

  batch.status = 'failed';
  batch.failureReason = failureReason;
  await batch.save();

  res.json(toSafeJson(batch));
}
