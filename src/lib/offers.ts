import { Types } from 'mongoose';
import { Offer, type OfferDoc } from '../models/Offer';
import { Order } from '../models/Order';
import type { ProductDoc } from '../models/Product';
import { round2, type AppliedOffer } from './pricing';

export type OfferStatus = 'scheduled' | 'active' | 'paused' | 'expired';

/** All offers for a vendor that are within their date range and not paused. */
export async function getActiveOffersForVendor(vendorId: string | Types.ObjectId): Promise<OfferDoc[]> {
  const now = new Date();
  return Offer.find({
    vendorId,
    isPaused: false,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).sort({ createdAt: -1 });
}

type OfferMatchTarget = Pick<ProductDoc, '_id' | 'categoryId'>;

/** Picks the best-matching offer for a product from an already-fetched active list —
 * entire-store offers match everything; selected-products offers match by the
 * offer's explicit productIds, falling back to categoryIds when none were chosen.
 * Most recently created offer wins when more than one matches. */
export function matchOfferForProduct(offers: OfferDoc[], product: OfferMatchTarget): OfferDoc | null {
  return (
    offers.find((offer) => {
      if (offer.scope === 'entire-store') return true;
      if (offer.productIds.length > 0) return offer.productIds.some((id) => String(id) === String(product._id));
      return offer.categoryIds.some((id) => String(id) === String(product.categoryId));
    }) ?? null
  );
}

export async function findActiveOfferForProduct(
  product: Pick<ProductDoc, '_id' | 'vendorId' | 'categoryId'>,
): Promise<OfferDoc | null> {
  const offers = await getActiveOffersForVendor(product.vendorId);
  return matchOfferForProduct(offers, product);
}

/** Batched version of findActiveOfferForProduct for a product listing — fetches
 * each vendor's active offers once instead of once per product. */
export async function matchOffersForProducts(
  products: Pick<ProductDoc, '_id' | 'vendorId' | 'categoryId'>[],
): Promise<Map<string, OfferDoc | null>> {
  const vendorIds = [...new Set(products.map((p) => String(p.vendorId)))];
  const offersByVendor = new Map<string, OfferDoc[]>();
  for (const vendorId of vendorIds) {
    offersByVendor.set(vendorId, await getActiveOffersForVendor(vendorId));
  }
  const result = new Map<string, OfferDoc | null>();
  for (const product of products) {
    result.set(String(product._id), matchOfferForProduct(offersByVendor.get(String(product.vendorId)) ?? [], product));
  }
  return result;
}

export function applyOfferPrice(unitPrice: number, offer: Pick<OfferDoc, 'discountType' | 'discountValue'>): number {
  const discounted =
    offer.discountType === 'percentage' ? unitPrice * (1 - offer.discountValue / 100) : unitPrice - offer.discountValue;
  return round2(Math.max(discounted, 0));
}

/** Gates an otherwise-matching offer behind the vendor's own conditions — a
 * cart below minOrderValue, or a returning customer on a new-customer-only
 * offer, doesn't get the discount even though the product/category matched. */
export function isOfferEligible(
  offer: Pick<OfferDoc, 'minOrderValueEnabled' | 'minOrderValue' | 'customerEligibility'>,
  context: { cartItemsTotalForVendor: number; isNewCustomer: boolean },
): boolean {
  if (offer.minOrderValueEnabled && context.cartItemsTotalForVendor < offer.minOrderValue) return false;
  if (offer.customerEligibility === 'new-only' && !context.isNewCustomer) return false;
  return true;
}

export function deriveOfferStatus(offer: Pick<OfferDoc, 'isPaused' | 'startDate' | 'endDate'>): OfferStatus {
  const now = Date.now();
  if (offer.endDate.getTime() < now) return 'expired';
  if (offer.isPaused) return 'paused';
  if (offer.startDate.getTime() > now) return 'scheduled';
  return 'active';
}

/**
 * Resolves the applied offer (if any, and if the vendor's own conditions are
 * met) for each line in a cart/order, in the same order as `lines`. The raw
 * (pre-offer) per-vendor subtotal — needed to gate on minOrderValue — is
 * computed from the line set itself, and "new customer" is whether this
 * customer has ever placed an order with that vendor before.
 */
export async function resolveAppliedOffers(
  lines: { product: Pick<ProductDoc, '_id' | 'vendorId' | 'categoryId'>; unitPrice: number; quantity: number }[],
  customerId: string,
): Promise<(AppliedOffer | undefined)[]> {
  if (lines.length === 0) return [];

  const vendorIds = [...new Set(lines.map((l) => String(l.product.vendorId)))];

  const offersByVendor = new Map<string, OfferDoc[]>();
  const priorOrderCountByVendor = new Map<string, number>();
  for (const vendorId of vendorIds) {
    offersByVendor.set(vendorId, await getActiveOffersForVendor(vendorId));
    priorOrderCountByVendor.set(vendorId, await Order.countDocuments({ customerId, vendorId }));
  }

  const rawTotalByVendor = new Map<string, number>();
  for (const line of lines) {
    const key = String(line.product.vendorId);
    rawTotalByVendor.set(key, (rawTotalByVendor.get(key) ?? 0) + line.unitPrice * line.quantity);
  }

  return lines.map((line) => {
    const vendorKey = String(line.product.vendorId);
    const offer = matchOfferForProduct(offersByVendor.get(vendorKey) ?? [], line.product);
    if (!offer) return undefined;

    const eligible = isOfferEligible(offer, {
      cartItemsTotalForVendor: rawTotalByVendor.get(vendorKey) ?? 0,
      isNewCustomer: (priorOrderCountByVendor.get(vendorKey) ?? 0) === 0,
    });
    if (!eligible) return undefined;

    return { id: String(offer._id), discountType: offer.discountType, discountValue: offer.discountValue };
  });
}
