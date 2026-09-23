import type { Request, Response } from 'express';
import type { HydratedDocument } from 'mongoose';
import { Incentive, type IncentiveDoc } from '../models/Incentive';
import { DriverIncentiveProgress } from '../models/DriverIncentiveProgress';
import { EarningsLedger } from '../models/EarningsLedger';
import { HttpError } from '../lib/httpError';
import { toSafeJson } from '../lib/sanitize';

async function withProgress(req: Request, incentives: HydratedDocument<IncentiveDoc>[]) {
  const progressRows = await DriverIncentiveProgress.find({
    driverId: req.user!.id,
    incentiveId: { $in: incentives.map((i) => i._id as never) },
  });
  const byIncentiveId = new Map(progressRows.map((p) => [String(p.incentiveId), p]));

  return incentives.map((incentive) => {
    const progress = byIncentiveId.get(String(incentive._id));
    return {
      ...toSafeJson(incentive),
      progress: {
        currentProgress: progress?.currentProgress ?? 0,
        status: progress?.status ?? 'in_progress',
        completedAt: progress?.completedAt ?? null,
        payoutAmount: progress?.payoutAmount ?? null,
      },
    };
  });
}

export async function listIncentives(req: Request, res: Response) {
  const now = new Date();
  const incentives = await Incentive.find({ status: 'active', expiresAt: { $gte: now } }).sort({ expiresAt: 1 });
  res.json(await withProgress(req, incentives));
}

export async function getIncentiveById(req: Request, res: Response) {
  const incentive = await Incentive.findById(req.params.id);
  if (!incentive) throw new HttpError(404, 'Incentive not found');
  const [withInfo] = await withProgress(req, [incentive]);
  res.json(withInfo);
}

export async function getProgress(req: Request, res: Response) {
  const now = new Date();
  const incentives = await Incentive.find({ status: 'active', expiresAt: { $gte: now } }).sort({ expiresAt: 1 });
  res.json(await withProgress(req, incentives));
}

export async function getBonusHistory(req: Request, res: Response) {
  const { page: pageRaw, limit: limitRaw } = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(pageRaw) || 1);
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 30));

  const [items, total] = await Promise.all([
    EarningsLedger.find({ driverId: req.user!.id, type: 'incentive_bonus' })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    EarningsLedger.countDocuments({ driverId: req.user!.id, type: 'incentive_bonus' }),
  ]);

  res.json({ items: items.map((i) => toSafeJson(i)), page, limit, total, totalPages: Math.ceil(total / limit) });
}
