import type { Request, Response } from 'express';
import { Incentive } from '../models/Incentive';
import { HttpError } from '../lib/httpError';
import { toSafeJson } from '../lib/sanitize';

function assertDateOrder(startAt: Date, expiresAt: Date) {
  if (expiresAt.getTime() < startAt.getTime()) {
    throw new HttpError(422, 'Validation failed', [{ path: 'expiresAt', msg: 'expiresAt must be after startAt' }]);
  }
}

export async function listIncentives(req: Request, res: Response) {
  const { status } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  const incentives = await Incentive.find(filter).sort({ expiresAt: -1 });
  res.json(incentives.map((i) => toSafeJson(i)));
}

export async function createIncentive(req: Request, res: Response) {
  const { title, description, rewardAmount, targetDeliveries, startAt, expiresAt, status, conditions } = req.body;
  const start = new Date(startAt);
  const end = new Date(expiresAt);
  assertDateOrder(start, end);

  const incentive = await Incentive.create({
    title,
    description,
    rewardAmount,
    targetDeliveries,
    startAt: start,
    expiresAt: end,
    status: status ?? 'active',
    conditions: conditions ?? [],
  });
  res.status(201).json(toSafeJson(incentive));
}

export async function updateIncentive(req: Request, res: Response) {
  const incentive = await Incentive.findById(req.params.id);
  if (!incentive) throw new HttpError(404, 'Incentive not found');

  const { title, description, rewardAmount, targetDeliveries, startAt, expiresAt, status, conditions } = req.body;
  const start = startAt !== undefined ? new Date(startAt) : incentive.startAt;
  const end = expiresAt !== undefined ? new Date(expiresAt) : incentive.expiresAt;
  assertDateOrder(start, end);

  Object.assign(incentive, {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(rewardAmount !== undefined && { rewardAmount }),
    ...(targetDeliveries !== undefined && { targetDeliveries }),
    startAt: start,
    expiresAt: end,
    ...(status !== undefined && { status }),
    ...(conditions !== undefined && { conditions }),
  });
  await incentive.save();
  res.json(toSafeJson(incentive));
}

export async function deleteIncentive(req: Request, res: Response) {
  const incentive = await Incentive.findByIdAndDelete(req.params.id);
  if (!incentive) throw new HttpError(404, 'Incentive not found');
  res.status(204).end();
}
