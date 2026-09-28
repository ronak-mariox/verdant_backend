import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import type { HydratedDocument } from 'mongoose';
import { Cart } from '../models/Cart';
import { Product, type ProductDoc } from '../models/Product';
import { Address } from '../models/Address';
import { Coupon } from '../models/Coupon';
import { Order, type OrderDoc, type OrderItemSnapshot } from '../models/Order';
import { Offer } from '../models/Offer';
import { Rating } from '../models/Rating';
import { Driver } from '../models/Driver';
import { HttpError } from '../lib/httpError';
import { arrayPagination, toSafeJson } from '../lib/sanitize';
import { evaluateCoupon, computeOrderPricing, findVariant, priceLine } from '../lib/pricing';
import { resolveAppliedOffers } from '../lib/offers';
import { CANCELLABLE_STATUSES } from '../lib/orderStatus';
import { releaseOrderResources } from '../lib/orderStock';
import { notifyCustomer, notifyOrderStatusChange } from '../lib/notify';
import { notifyVendor } from '../lib/vendorNotify';

function generateOrderNumber(): string {
  const year = new Date().getFullYear();
  return `VR-${year}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/** The customer's view of an order: the delivery OTP (dummy — shown so they can
 * read it to the rider) only while it's out for delivery, plus the assigned
 * driver's contact card. */
async function serializeForCustomer(orders: HydratedDocument<OrderDoc>[]) {
  const driverIds = [...new Set(orders.filter((o) => o.driverId).map((o) => String(o.driverId)))];
  const drivers = driverIds.length ? await Driver.find({ _id: { $in: driverIds } }) : [];
  const ratingRows = driverIds.length
    ? await Rating.aggregate([
        { $match: { driverId: { $in: drivers.map((d) => d._id) } } },
        { $group: { _id: '$driverId', avg: { $avg: '$stars' } } },
      ])
    : [];
  const ratingByDriver = new Map(ratingRows.map((r) => [String(r._id), Math.round(r.avg * 10) / 10]));
  const driverById = new Map(drivers.map((d) => [String(d._id), d]));

  return orders.map((o) => {
    const json = toSafeJson(o, ['deliveryOtpHash', 'deliveryOtp', 'deliveryOtpAttempts'])!;
    const driver = o.driverId ? driverById.get(String(o.driverId)) : undefined;
    return {
      ...json,
      deliveryOtp: o.status === 'out_for_delivery' ? o.deliveryOtp ?? null : undefined,
      driver: driver
        ? {
            id: String(driver._id),
            name: driver.fullName ?? 'Delivery partner',
            phone: driver.phone,
            vehicleType: driver.vehicleType,
            vehicleNumber: driver.vehicleDetails?.registrationNumber,
            rating: ratingByDriver.get(String(driver._id)) ?? null,
          }
        : null,
    };
  });
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

  await notifyCustomer(customerId, 'order', 'Order placed', `Your order #${order.orderNumber} has been placed successfully.`, order);
  await notifyVendor(
    order.vendorId,
    'new-order',
    `New Order #${order.orderNumber}`,
    `${items.length} item${items.length === 1 ? '' : 's'} · ₹${pricing.grandTotal}`,
    { orderId: order._id, orderNumber: order.orderNumber },
  );

  const [json] = await serializeForCustomer([order]);
  res.status(201).json(json);
}

export async function listOrders(req: Request, res: Response) {
  const { skip, limit } = arrayPagination(req.query as Record<string, unknown>);
  const orders = await Order.find({ customerId: req.user!.id }).sort({ createdAt: -1 }).skip(skip).limit(limit);
  res.json(await serializeForCustomer(orders));
}

export async function getOrder(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  const [json] = await serializeForCustomer([order]);
  res.json(json);
}

export async function cancelOrder(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    throw new HttpError(409, `This order can no longer be cancelled (status: ${order.status})`);
  }

  await releaseOrderResources(order);

  const now = new Date();
  order.status = 'cancelled';
  order.cancelReason = req.body.reason;
  order.cancelledBy = 'customer';
  order.statusHistory.push({ status: 'cancelled', at: now, note: req.body.reason });
  await order.save();

  await notifyOrderStatusChange(order, 'cancelled', req.body.reason);
  await notifyVendor(
    order.vendorId,
    'order-cancellation',
    `Order #${order.orderNumber} Cancelled`,
    req.body.reason ? `Cancelled by customer · ${req.body.reason}` : 'Cancelled by customer',
    { orderId: order._id, orderNumber: order.orderNumber },
  );

  const [json] = await serializeForCustomer([order]);
  res.json(json);
}

export async function rateOrder(req: Request, res: Response) {
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user!.id });
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.status !== 'delivered') {
    throw new HttpError(409, 'Only delivered orders can be rated');
  }
  if (order.vendorRating !== undefined && order.vendorRating !== null) {
    throw new HttpError(409, 'This order has already been rated');
  }

  const { stars, reviewText } = req.body as { stars: number; reviewText?: string };

  let rating = null;
  if (order.driverId) {
    const existing = await Rating.findOne({ orderId: order._id as never });
    if (existing) throw new HttpError(409, 'This order has already been rated');
    rating = await Rating.create({
      orderId: order._id as never,
      driverId: order.driverId,
      customerId: req.user!.id,
      stars,
      reviewText,
    });
  }

  order.vendorRating = stars;
  await order.save();

  res.status(201).json({
    ...(rating ? toSafeJson(rating) : { orderId: String(order._id), customerId: req.user!.id, stars, reviewText }),
    vendorRating: stars,
  });
}
