import type { Request, Response } from 'express';
import { Customer } from '../models/Customer';
import { Product } from '../models/Product';
import { toSafeJson } from '../lib/sanitize';
import { HttpError } from '../lib/httpError';

export async function listWishlist(req: Request, res: Response) {
  const customer = await Customer.findById(req.user!.id);
  const ids = customer?.wishlist ?? [];
  const products = await Product.find({ _id: { $in: ids }, status: 'active' });
  res.json(products.map((p) => toSafeJson(p)));
}

export async function toggleWishlist(req: Request, res: Response) {
  const customer = await Customer.findById(req.user!.id);
  if (!customer) throw new HttpError(404, 'Customer not found');

  const { productId } = req.params;
  const index = customer.wishlist.findIndex((id) => String(id) === productId);
  const isWishlisted = index < 0;

  if (isWishlisted) {
    customer.wishlist.push(productId as never);
  } else {
    customer.wishlist.splice(index, 1);
  }
  await customer.save();

  res.json({ isWishlisted });
}
