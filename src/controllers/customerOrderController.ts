import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { Cart } from '../models/Cart';
import { Product, type ProductDoc } from '../models/Product';
import { Address } from '../models/Address';
import { Coupon } from '../models/Coupon';
import { Order, type OrderItemSnapshot } from '../models/Order';
import { Offer } from '../models/Offer';
import { Rating } from '../models/Rating';
import { HttpError } from '../lib/httpError';
import { toSafeJson } from '../lib/sanitize';
import { evaluateCoupon, computeOrderPricing, findVariant, priceLine } from '../lib/pricing';
import { resolveAppliedOffers } from '../lib/offers';
import { CANCELLABLE_STATUSES } from '../lib/orderStatus';
import { notifyCustomer, notifyOrderStatusChange } from '../lib/notify';
import { notifyVendor } from '../lib/vendorNotify';

function generateOrderNumber(): string {
  const year = new Date().getFullYear();
  return `VR-${year}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Attempts to atomically decrement stock for each line. If any line fails
 * (raced out of stock), compensates by restoring the lines already decremented
 * and throws — no partial stock deduction survives a failed checkout, without
 * needing a multi-document transaction (works against a standalone MongoDB too).
 */
async function reserveStock(lines: { product: ProductDoc; variantId: string; quantity: number }[]) {
  const decremented: typeof lines = [];
  for (const line of lines) {
    const result = await Product.updateOne(
      { _id: line.product._id, 'variants.id': line.variantId, 'variants.stock': { $gte: line.quantity } },
      { $inc: { 'variants.$.stock': -line.quantity } },
    );
    if (result.modifiedCount === 0) {
      for (const done of decremented) {
        await Product.updateOne(
          { _id: done.product._id, 'variants.id': done.variantId },
          { $inc: { 'variants.$.stock': done.quantity } },
        );
      }
      throw new HttpError(409, `"${line.product.name}" no longer has enough stock`, { productId: String(line.product._id) });
    }
    decremented.push(line);
  }
}

export async function createOrder(req: Request, res: Response) {
  const customerId = req.user!.id;
  const { addressId, paymentMethod, specialInstructions } = req.body as {
    addressId: string;
    paymentMethod: 'cod' | 'online';
    specialInstructions?: string;
  };

  if (paymentMethod !== 'cod') {
    throw new HttpError(422, 'Online payment is not available yet — please choose Cash on Delivery');
  }

  const address = await Address.findOne({ _id: addressId, customerId });
  if (!address) throw new HttpError(404, 'Delivery address not found');

  const cart = await Cart.findOne({ customerId });
  if (!cart || cart.items.length === 0) throw new HttpError(422, 'Your cart is empty');

  const productIds = [...new Set(cart.items.map((i) => String(i.productId)))];
  const products = await Product.find({ _id: { $in: productIds } });
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  const lines: { product: ProductDoc; variantId: string; quantity: number }[] = [];
  for (const item of cart.items) {
    const product = productMap.get(String(item.productId));
    if (!product || product.status !== 'active' || !product.isAvailable) {
      throw new HttpError(409, `"${product?.name ?? 'An item'}" in your cart is no longer available`);
    }
    const variant = findVariant(product, item.variantId);
    if (!variant) throw new HttpError(409, `A variant of "${product.name}" is no longer available`);
    lines.push({ product, variantId: item.variantId, quantity: item.quantity });
  }

  // All items in an order must share a vendor — matches the vendor app's
  // per-store order model. Reject mixed-vendor carts rather than silently
  // splitting them (splitting would need multi-order checkout UI not present).
  const vendorIds = new Set(lines.map((l) => String(l.product.vendorId)));
  if (vendorIds.size > 1) {
    throw new HttpError(422, 'Your cart has items from multiple stores — checkout one store at a time');
  }

  const appliedOffers = await resolveAppliedOffers(
    lines.map(({ product, variantId, quantity }) => ({
      product,
      unitPrice: findVariant(product, variantId)!.price,
      quantity,
    })),
    customerId,
  );
  const pricedLines = lines.map((l, i) => priceLine(l.product, findVariant(l.product, l.variantId)!, l.quantity, appliedOffers[i]));
  const itemsTotal = pricedLines.reduce((sum, l) => sum + l.subtotal, 0);

  let discount = 0;
  let coupon = null;
  if (cart.couponCode) {
    coupon = await Coupon.findOne({ code: cart.couponCode });
    const evaluated = evaluateCoupon(coupon, itemsTotal);
    if (evaluated.discount === 0) throw new HttpError(422, evaluated.reason ?? 'Coupon can no longer be applied');
    discount = evaluated.discount;
  }

  await reserveStock(lines);

  const pricing = computeOrderPricing(pricedLines, discount);
  const now = new Date();
  const items: OrderItemSnapshot[] = pricedLines.map((l) => ({
    productId: l.product._id as never,
    variantId: l.variant.id,
    name: l.product.name,
    variantLabel: l.variant.label,
    imageUrl: l.product.images[0],
    price: l.variant.price,
    mrp: l.variant.mrp,
    quantity: l.quantity,
    subtotal: l.subtotal,
    offerId: l.offerId as never,
    originalSubtotal: l.originalSubtotal,
  }));

  let order;
  try {
    order = await Order.create({
      orderNumber: generateOrderNumber(),
      customerId,
      vendorId: lines[0].product.vendorId,
      items,
      address: {
        contactName: address.contactName,
        contactPhone: address.contactPhone,
        line1: address.line1,
        line2: address.line2,
        landmark: address.landmark,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        latitude: address.latitude,
        longitude: address.longitude,
      },
      pricing,
      couponCode: coupon?.code,
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      status: 'placed',
      statusHistory: [{ status: 'placed', at: now }],
      specialInstructions,
      placedAt: now,
    });
  } catch (err) {
    // Order creation failed after stock was reserved — release it back.
    for (const line of lines) {
      await Product.updateOne(
        { _id: line.product._id, 'variants.id': line.variantId },
        { $inc: { 'variants.$.stock': line.quantity } },
      );
    }
    throw err;
  }

  if (coupon) await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: 1 } });

  for (const l of pricedLines) {
    if (!l.offerId) continue;
    await Offer.updateOne({ _id: l.offerId }, { $inc: { usesCount: 1, revenueGenerated: l.subtotal } });
  }

  cart.items = [];
  cart.couponCode = undefined;
  await cart.save();

  await notifyCustomer(
    customerId,
    'order',
    'Order placed',
    `Your order #${order.orderNumber} has been placed successfully.`,
    order._id,
  );
  await notifyVendor(
    order.vendorId,
    'new-order',
    `New Order #${order.orderNumber}`,
    `${items.length} item${items.length === 1 ? '' : 's'} · ₹${pricing.grandTotal}`,
    { orderId: order._id },
  );

  res.status(201).json(toSafeJson(order, ['deliveryOtpHash']));
}

export async function listOrders(req: Request, res: Response) {
  const orders = await Order.find({ customerId: req.user!.id }).sort({ createdAt: -1 });
  res.json(orders.map((o) => toSafeJson(o, ['deliveryOtpHash'])));
}

export async function getOrder(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  res.json(toSafeJson(order, ['deliveryOtpHash']));
}

export async function cancelOrder(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    throw new HttpError(409, `This order can no longer be cancelled (status: ${order.status})`);
  }

  for (const item of order.items) {
    await Product.updateOne({ _id: item.productId, 'variants.id': item.variantId }, { $inc: { 'variants.$.stock': item.quantity } });
  }

  const now = new Date();
  order.status = 'cancelled';
  order.cancelReason = req.body.reason;
  order.cancelledBy = 'customer';
  order.statusHistory.push({ status: 'cancelled', at: now, note: req.body.reason });
  await order.save();

  await notifyOrderStatusChange(order.customerId, order._id, order.orderNumber, 'cancelled', req.body.reason);
  await notifyVendor(
    order.vendorId,
    'order-cancellation',
    `Order #${order.orderNumber} Cancelled`,
    req.body.reason ? `Cancelled by customer · ${req.body.reason}` : 'Cancelled by customer',
    { orderId: order._id },
  );

  res.json(toSafeJson(order, ['deliveryOtpHash']));
}

export async function rateOrder(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.status !== 'delivered') {
    throw new HttpError(409, 'Only delivered orders can be rated');
  }
  if (!order.driverId) {
    throw new HttpError(409, 'This order has no delivery driver to rate');
  }

  const existing = await Rating.findOne({ orderId: order._id as never });
  if (existing) throw new HttpError(409, 'This order has already been rated');

  const { stars, reviewText } = req.body as { stars: number; reviewText?: string };
  const rating = await Rating.create({
    orderId: order._id as never,
    driverId: order.driverId,
    customerId: req.user!.id,
    stars,
    reviewText,
  });

  res.status(201).json(toSafeJson(rating));
}
