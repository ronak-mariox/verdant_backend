import type { Request, Response } from 'express';
import { Category } from '../models/Category';
import { Customer } from '../models/Customer';
import { Product } from '../models/Product';
import { Review } from '../models/Review';
import { toSafeJson } from '../lib/sanitize';
import { HttpError } from '../lib/httpError';
import { applyOfferPrice, matchOffersForProducts } from '../lib/offers';
import type { OfferDoc } from '../models/Offer';

/** Attaches the matched active offer (if any) and, per variant, the real
 * offer-discounted `effectivePrice` a customer would actually be charged —
 * mirrors the discount that `priceLine()` applies at checkout, so the price
 * shown in the catalog is never cosmetic. */
function withOffer(product: InstanceType<typeof Product>, offer: OfferDoc | null) {
  const json = toSafeJson(product) as Record<string, unknown> | null;
  if (!json) return json;
  json.activeOffer = offer
    ? { id: String(offer._id), title: offer.title, discountType: offer.discountType, discountValue: offer.discountValue }
    : null;
  json.variants = (json.variants as { price: number }[]).map((v) => ({
    ...v,
    effectivePrice: offer ? applyOfferPrice(v.price, offer) : v.price,
  }));
  return json;
}

async function withOffers(products: InstanceType<typeof Product>[]) {
  const offers = await matchOffersForProducts(products);
  return products.map((p) => withOffer(p, offers.get(String(p._id)) ?? null));
}

export async function getCategories(_req: Request, res: Response) {
  const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1 });
  res.json(categories.map((c) => toSafeJson(c)));
}

function parsePagination(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export async function listProducts(req: Request, res: Response) {
  const { categoryId, subcategoryId, tag, search, sort } = req.query as Record<string, string | undefined>;
  const { page, limit, skip } = parsePagination(req);

  const filter: Record<string, unknown> = { status: 'active', isAvailable: true };
  if (categoryId) filter.categoryId = categoryId;
  if (subcategoryId) filter.subcategoryId = subcategoryId;
  if (tag) filter.tags = tag;
  if (search) filter.$text = { $search: search };

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    price_asc: { 'variants.0.price': 1 },
    price_desc: { 'variants.0.price': -1 },
    newest: { createdAt: -1 },
  };

  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort(sortMap[sort ?? ''] ?? { createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Product.countDocuments(filter),
  ]);

  res.json({
    items: await withOffers(items),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
}

export async function getProduct(req: Request, res: Response) {
  const product = await Product.findOne({ _id: req.params.id, status: 'active' });
  if (!product) throw new HttpError(404, 'Product not found');

  const [similar, ratingAgg, reviews, customer] = await Promise.all([
    Product.find({
      _id: { $ne: product._id },
      categoryId: product.categoryId,
      status: 'active',
      isAvailable: true,
    }).limit(10),
    Review.aggregate([
      { $match: { productId: product._id } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
    Review.find({ productId: product._id as never }).sort({ createdAt: -1 }).limit(10),
    Customer.findById(req.user!.id),
  ]);

  const rating = ratingAgg[0]
    ? { avg: Math.round(ratingAgg[0].avg * 10) / 10, count: ratingAgg[0].count }
    : { avg: 0, count: 0 };
  const isWishlisted = (customer?.wishlist ?? []).some((id) => String(id) === String(product._id));

  const similarRatingAgg = similar.length
    ? await Review.aggregate([
        { $match: { productId: { $in: similar.map((p) => p._id) } } },
        { $group: { _id: '$productId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
    : [];
  const similarRatingsById = new Map(
    similarRatingAgg.map((r) => [String(r._id), { avg: Math.round(r.avg * 10) / 10, count: r.count }]),
  );

  const offers = await matchOffersForProducts([product, ...similar]);

  res.json({
    product: withOffer(product, offers.get(String(product._id)) ?? null),
    similar: similar.map((p) => ({
      ...withOffer(p, offers.get(String(p._id)) ?? null),
      rating: similarRatingsById.get(String(p._id)) ?? { avg: 0, count: 0 },
    })),
    rating,
    reviews: reviews.map((r) => toSafeJson(r)),
    isWishlisted,
  });
}

/**
 * Curated home-feed sections, driven by product `tags` (e.g. "deal", "saver",
 * "essential") rather than a hardcoded screen-specific model — keeps Verdant's
 * HomeScreen sections real without needing a bespoke banner-per-section schema.
 */
export async function getHome(_req: Request, res: Response) {
  const [categories, deals, saver, essentials, snacks, monsoon, banners] = await Promise.all([
    Category.find({ isActive: true, showOnHome: true }).sort({ sortOrder: 1 }),
    Product.find({ status: 'active', isAvailable: true, tags: 'deal' }).limit(12),
    Product.find({ status: 'active', isAvailable: true, tags: 'saver' }).limit(10),
    Product.find({ status: 'active', isAvailable: true, tags: 'essential' }).limit(12),
    Product.find({ status: 'active', isAvailable: true, tags: 'snack' }).limit(12),
    Product.find({ status: 'active', isAvailable: true, tags: 'monsoon' }).limit(9),
    Category.find({ isActive: true, showOnHome: true }).sort({ sortOrder: 1 }).limit(6),
  ]);

  const offers = await matchOffersForProducts([...deals, ...saver, ...essentials, ...snacks, ...monsoon]);

  res.json({
    categories: categories.map((c) => toSafeJson(c)),
    topDeals: deals.map((p) => withOffer(p, offers.get(String(p._id)) ?? null)),
    saverItems: saver.map((p) => withOffer(p, offers.get(String(p._id)) ?? null)),
    essentialItems: essentials.map((p) => withOffer(p, offers.get(String(p._id)) ?? null)),
    snackItems: snacks.map((p) => withOffer(p, offers.get(String(p._id)) ?? null)),
    monsoonItems: monsoon.map((p) => withOffer(p, offers.get(String(p._id)) ?? null)),
    banners: banners.map((c) => ({ id: String(c._id), title: c.name, imageUrl: c.imageUrl })),
  });
}

export async function search(req: Request, res: Response) {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.json({ items: [] });
    return;
  }
  const items = await Product.find({ status: 'active', isAvailable: true, $text: { $search: q } }).limit(20);
  res.json({ items: await withOffers(items) });
}
