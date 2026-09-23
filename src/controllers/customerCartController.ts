import type { Request, Response } from 'express';
import { Cart, type CartItem } from '../models/Cart';
import { Product, type ProductDoc } from '../models/Product';
import { Coupon } from '../models/Coupon';
import { HttpError } from '../lib/httpError';
import { evaluateCoupon, computeOrderPricing, findVariant, priceLine, round2 } from '../lib/pricing';
import { resolveAppliedOffers } from '../lib/offers';

async function getOrCreateCart(customerId: string) {
  let cart = await Cart.findOne({ customerId });
  if (!cart) cart = await Cart.create({ customerId, items: [] });
  return cart;
}

/** Builds the authoritative cart response: joins live product/variant data, drops
 * items whose product/variant no longer exists, applies any eligible vendor
 * offers, and recomputes totals server-side. */
async function buildCartResponse(cart: { items: CartItem[]; couponCode?: string }, customerId: string) {
  const productIds = [...new Set(cart.items.map((i) => String(i.productId)))];
  const products = await Product.find({ _id: { $in: productIds } });
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  const lines: { product: ProductDoc; variantId: string; quantity: number }[] = [];
  const unavailable: { productId: string; variantId: string; reason: string }[] = [];

  for (const item of cart.items) {
    const product = productMap.get(String(item.productId));
    if (!product || product.status !== 'active' || !product.isAvailable) {
      unavailable.push({ productId: String(item.productId), variantId: item.variantId, reason: 'No longer available' });
      continue;
    }
    const variant = findVariant(product, item.variantId);
    if (!variant) {
      unavailable.push({ productId: String(item.productId), variantId: item.variantId, reason: 'Variant no longer available' });
      continue;
    }
    if (variant.stock < item.quantity) {
      unavailable.push({ productId: String(item.productId), variantId: item.variantId, reason: `Only ${variant.stock} left in stock` });
      continue;
    }
    lines.push({ product, variantId: item.variantId, quantity: item.quantity });
  }

  const appliedOffers = await resolveAppliedOffers(
    lines.map(({ product, variantId, quantity }) => ({
      product,
      unitPrice: findVariant(product, variantId)!.price,
      quantity,
    })),
    customerId,
  );
  const pricedLines = lines.map(({ product, variantId, quantity }, i) =>
    priceLine(product, findVariant(product, variantId)!, quantity, appliedOffers[i]),
  );
  const itemsTotal = round2(pricedLines.reduce((sum, l) => sum + l.subtotal, 0));

  let couponResult: { discount: number; reason?: string } = { discount: 0 };
  if (cart.couponCode) {
    const coupon = await Coupon.findOne({ code: cart.couponCode });
    couponResult = evaluateCoupon(coupon, itemsTotal);
  }

  const pricing = computeOrderPricing(pricedLines, couponResult.discount);

  return {
    items: pricedLines.map((l) => ({
      productId: String(l.product._id),
      variantId: l.variant.id,
      name: l.product.name,
      variantLabel: l.variant.label,
      imageUrl: l.product.images[0],
      price: l.variant.price,
      mrp: l.variant.mrp,
      quantity: l.quantity,
      subtotal: l.subtotal,
      maxStock: l.variant.stock,
      offerId: l.offerId,
      originalSubtotal: l.originalSubtotal,
    })),
    unavailable,
    couponCode: cart.couponCode ?? null,
    couponMessage: cart.couponCode && couponResult.discount === 0 ? couponResult.reason : undefined,
    pricing,
  };
}

export async function getCart(req: Request, res: Response) {
  const cart = await getOrCreateCart(req.user!.id);
  res.json(await buildCartResponse(cart, req.user!.id));
}

export async function addItem(req: Request, res: Response) {
  const { productId, variantId, quantity } = req.body as { productId: string; variantId: string; quantity?: number };
  const product = await Product.findOne({ _id: productId, status: 'active' });
  if (!product) throw new HttpError(404, 'Product not found');
  const variant = findVariant(product, variantId);
  if (!variant) throw new HttpError(404, 'Variant not found');

  const cart = await getOrCreateCart(req.user!.id);
  const existing = cart.items.find((i) => String(i.productId) === productId && i.variantId === variantId);
  const qtyToAdd = quantity ?? 1;
  if (existing) {
    existing.quantity += qtyToAdd;
  } else {
    cart.items.push({ productId: product._id as never, variantId, quantity: qtyToAdd });
  }
  await cart.save();
  res.status(201).json(await buildCartResponse(cart, req.user!.id));
}

export async function updateItem(req: Request, res: Response) {
  const { productId, variantId } = req.params;
  const { quantity } = req.body as { quantity: number };
  const cart = await getOrCreateCart(req.user!.id);
  const item = cart.items.find((i) => String(i.productId) === productId && i.variantId === variantId);
  if (!item) throw new HttpError(404, 'Item not in cart');

  if (quantity <= 0) {
    cart.items = cart.items.filter((i) => i !== item);
  } else {
    item.quantity = quantity;
  }
  await cart.save();
  res.json(await buildCartResponse(cart, req.user!.id));
}

export async function removeItem(req: Request, res: Response) {
  const { productId, variantId } = req.params;
  const cart = await getOrCreateCart(req.user!.id);
  cart.items = cart.items.filter((i) => !(String(i.productId) === productId && i.variantId === variantId));
  await cart.save();
  res.json(await buildCartResponse(cart, req.user!.id));
}

export async function clearCart(req: Request, res: Response) {
  const cart = await getOrCreateCart(req.user!.id);
  cart.items = [];
  cart.couponCode = undefined;
  await cart.save();
  res.json(await buildCartResponse(cart, req.user!.id));
}

export async function applyCoupon(req: Request, res: Response) {
  const { code } = req.body as { code: string };
  const coupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (!coupon) throw new HttpError(404, 'Invalid coupon code');

  const cart = await getOrCreateCart(req.user!.id);
  const preview = await buildCartResponse({ ...cart.toObject(), couponCode: coupon.code }, req.user!.id);
  const { discount, reason } = evaluateCoupon(coupon, preview.pricing.itemsTotal);
  if (discount === 0) throw new HttpError(422, reason ?? 'This coupon cannot be applied');

  cart.couponCode = coupon.code;
  await cart.save();
  res.json(await buildCartResponse(cart, req.user!.id));
}

export async function removeCoupon(req: Request, res: Response) {
  const cart = await getOrCreateCart(req.user!.id);
  cart.couponCode = undefined;
  await cart.save();
  res.json(await buildCartResponse(cart, req.user!.id));
}
