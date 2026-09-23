import type { Request, Response } from 'express';
import { Coupon } from '../models/Coupon';
import { HttpError } from '../lib/httpError';
import { toSafeJson } from '../lib/sanitize';

export async function listCoupons(_req: Request, res: Response) {
  const coupons = await Coupon.find().sort({ createdAt: -1 });
  res.json(coupons.map((c) => toSafeJson(c)));
}

export async function createCoupon(req: Request, res: Response) {
  const { code, description, discountType, value, minOrderValue, maxDiscount, expiresAt, usageLimit } = req.body;
  const existing = await Coupon.findOne({ code: String(code).toUpperCase() });
  if (existing) throw new HttpError(409, 'A coupon with this code already exists');

  const coupon = await Coupon.create({
    code,
    description,
    discountType,
    value,
    minOrderValue: minOrderValue ?? 0,
    maxDiscount,
    expiresAt,
    usageLimit,
    isActive: true,
  });
  res.status(201).json(toSafeJson(coupon));
}

export async function updateCoupon(req: Request, res: Response) {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw new HttpError(404, 'Coupon not found');

  const { description, discountType, value, minOrderValue, maxDiscount, expiresAt, usageLimit, isActive } = req.body;
  Object.assign(coupon, {
    ...(description !== undefined && { description }),
    ...(discountType !== undefined && { discountType }),
    ...(value !== undefined && { value }),
    ...(minOrderValue !== undefined && { minOrderValue }),
    ...(maxDiscount !== undefined && { maxDiscount }),
    ...(expiresAt !== undefined && { expiresAt }),
    ...(usageLimit !== undefined && { usageLimit }),
    ...(isActive !== undefined && { isActive }),
  });
  await coupon.save();
  res.json(toSafeJson(coupon));
}

export async function deleteCoupon(req: Request, res: Response) {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) throw new HttpError(404, 'Coupon not found');
  res.status(204).end();
}
