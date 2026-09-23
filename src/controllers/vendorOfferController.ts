import type { Request, Response } from 'express';
import { Offer } from '../models/Offer';
import { HttpError } from '../lib/httpError';
import { toSafeJson } from '../lib/sanitize';
import { deriveOfferStatus } from '../lib/offers';

function withStatus(offer: InstanceType<typeof Offer>) {
  return { ...toSafeJson(offer), status: deriveOfferStatus(offer) };
}

export async function listMyOffers(req: Request, res: Response) {
  const offers = await Offer.find({ vendorId: req.user!.id }).sort({ createdAt: -1 });
  res.json(offers.map(withStatus));
}

export async function getMyOffer(req: Request, res: Response) {
  const offer = await Offer.findOne({ _id: req.params.id, vendorId: req.user!.id });
  if (!offer) throw new HttpError(404, 'Offer not found');
  res.json(withStatus(offer));
}

export async function createOffer(req: Request, res: Response) {
  const {
    title,
    discountType,
    discountValue,
    scope,
    categoryIds,
    minOrderValueEnabled,
    minOrderValue,
    customerEligibility,
    startDate,
    endDate,
  } = req.body as {
    title: string;
    discountType: 'percentage' | 'flat';
    discountValue: number;
    scope: 'selected-products' | 'entire-store';
    categoryIds?: string[];
    minOrderValueEnabled?: boolean;
    minOrderValue?: number;
    customerEligibility?: 'all' | 'new-only';
    startDate: string;
    endDate: string;
  };

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new HttpError(422, 'Invalid start or end date');
  }
  if (end.getTime() < start.getTime()) {
    throw new HttpError(422, 'End date must be after the start date');
  }
  if (scope === 'selected-products' && (!categoryIds || categoryIds.length === 0)) {
    throw new HttpError(422, 'Select at least one category for this offer');
  }

  const offer = await Offer.create({
    vendorId: req.user!.id,
    title,
    discountType,
    discountValue,
    scope,
    categoryIds: scope === 'entire-store' ? [] : categoryIds,
    minOrderValueEnabled: Boolean(minOrderValueEnabled),
    minOrderValue: minOrderValueEnabled ? Number(minOrderValue) || 0 : 0,
    customerEligibility: customerEligibility ?? 'all',
    startDate: start,
    endDate: end,
  });

  res.status(201).json(withStatus(offer));
}

export async function pauseOffer(req: Request, res: Response) {
  const offer = await Offer.findOne({ _id: req.params.id, vendorId: req.user!.id });
  if (!offer) throw new HttpError(404, 'Offer not found');
  offer.isPaused = true;
  await offer.save();
  res.json(withStatus(offer));
}

export async function resumeOffer(req: Request, res: Response) {
  const offer = await Offer.findOne({ _id: req.params.id, vendorId: req.user!.id });
  if (!offer) throw new HttpError(404, 'Offer not found');
  offer.isPaused = false;
  await offer.save();
  res.json(withStatus(offer));
}

export async function deleteOffer(req: Request, res: Response) {
  const offer = await Offer.findOneAndDelete({ _id: req.params.id, vendorId: req.user!.id });
  if (!offer) throw new HttpError(404, 'Offer not found');
  res.status(204).end();
}
