import type { Request, Response } from 'express';
import { Offer } from '../models/Offer';
import { Product } from '../models/Product';
import { HttpError } from '../lib/httpError';
import { toSafeJson } from '../lib/sanitize';
import { deriveOfferStatus } from '../lib/offers';

function withStatus(offer: InstanceType<typeof Offer>) {
  return { ...toSafeJson(offer), status: deriveOfferStatus(offer) };
}

function parseDateRange(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new HttpError(422, 'Invalid start or end date');
  }
  if (end.getTime() < start.getTime()) {
    throw new HttpError(422, 'End date must be after the start date');
  }
  return { start, end };
}

/** Only this vendor's own products may be attached to an offer. */
async function assertOwnProducts(vendorId: string, productIds: string[]) {
  if (productIds.length === 0) return;
  const owned = await Product.countDocuments({ _id: { $in: productIds }, vendorId });
  if (owned !== new Set(productIds).size) {
    throw new HttpError(422, 'One or more selected products do not belong to your store');
  }
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
    productIds,
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
    productIds?: string[];
    categoryIds?: string[];
    minOrderValueEnabled?: boolean;
    minOrderValue?: number;
    customerEligibility?: 'all' | 'new-only';
    startDate: string;
    endDate: string;
  };

  const { start, end } = parseDateRange(startDate, endDate);
  const selectedProducts = productIds ?? [];
  const selectedCategories = categoryIds ?? [];
  if (scope === 'selected-products' && selectedProducts.length === 0 && selectedCategories.length === 0) {
    throw new HttpError(422, 'Select at least one product or category for this offer');
  }
  await assertOwnProducts(req.user!.id, selectedProducts);

  const offer = await Offer.create({
    vendorId: req.user!.id,
    title,
    discountType,
    discountValue,
    scope,
    productIds: scope === 'entire-store' ? [] : selectedProducts,
    categoryIds: scope === 'entire-store' ? [] : selectedCategories,
    minOrderValueEnabled: Boolean(minOrderValueEnabled),
    minOrderValue: minOrderValueEnabled ? Number(minOrderValue) || 0 : 0,
    customerEligibility: customerEligibility ?? 'all',
    startDate: start,
    endDate: end,
  });

  res.status(201).json(withStatus(offer));
}

export async function updateOffer(req: Request, res: Response) {
  const offer = await Offer.findOne({ _id: req.params.id, vendorId: req.user!.id });
  if (!offer) throw new HttpError(404, 'Offer not found');

  const {
    title,
    discountType,
    discountValue,
    scope,
    productIds,
    categoryIds,
    minOrderValueEnabled,
    minOrderValue,
    customerEligibility,
    startDate,
    endDate,
  } = req.body as Partial<{
    title: string;
    discountType: 'percentage' | 'flat';
    discountValue: number;
    scope: 'selected-products' | 'entire-store';
    productIds: string[];
    categoryIds: string[];
    minOrderValueEnabled: boolean;
    minOrderValue: number;
    customerEligibility: 'all' | 'new-only';
    startDate: string;
    endDate: string;
  }>;

  const { start, end } = parseDateRange(startDate ?? offer.startDate.toISOString(), endDate ?? offer.endDate.toISOString());
  const nextScope = scope ?? offer.scope;
  const nextProducts = productIds ?? offer.productIds.map(String);
  const nextCategories = categoryIds ?? offer.categoryIds.map(String);
  if (nextScope === 'selected-products' && nextProducts.length === 0 && nextCategories.length === 0) {
    throw new HttpError(422, 'Select at least one product or category for this offer');
  }
  if (productIds) await assertOwnProducts(req.user!.id, productIds);

  if (title !== undefined) offer.title = title;
  if (discountType !== undefined) offer.discountType = discountType;
  if (discountValue !== undefined) offer.discountValue = discountValue;
  offer.scope = nextScope;
  offer.set('productIds', nextScope === 'entire-store' ? [] : nextProducts);
  offer.set('categoryIds', nextScope === 'entire-store' ? [] : nextCategories);
  if (minOrderValueEnabled !== undefined) offer.minOrderValueEnabled = minOrderValueEnabled;
  if (minOrderValue !== undefined) offer.minOrderValue = minOrderValue;
  if (!offer.minOrderValueEnabled) offer.minOrderValue = 0;
  if (customerEligibility !== undefined) offer.customerEligibility = customerEligibility;
  offer.startDate = start;
  offer.endDate = end;
  await offer.save();

  res.json(withStatus(offer));
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
