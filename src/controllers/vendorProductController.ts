import type { Request, Response } from 'express';
import { Product } from '../models/Product';
import { Vendor } from '../models/Vendor';
import { HttpError } from '../lib/httpError';
import { arrayPagination, escapeRegex, toSafeJson } from '../lib/sanitize';
import { assertCategoryAssignable } from '../lib/catalog';
import { publicUrlFor } from '../lib/upload';
import { notifyVendor } from '../lib/vendorNotify';
import { StockAdjustment, type StockEventType } from '../models/StockAdjustment';

/** Enforces the intended flow: approved registration first, then store setup,
 * only then can a vendor start listing products — a store with no profile,
 * address, or delivery settings has nothing for a customer-facing listing to
 * attach to. Only gates product CREATION; managing already-created products
 * (which could only exist if this passed once already) isn't re-checked. */
async function assertReadyToAddProducts(vendorId: string) {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw new HttpError(404, 'Vendor not found');
  if (vendor.status !== 'active') {
    throw new HttpError(403, 'Your vendor account must be approved before you can manage products');
  }
  if (!vendor.storeSetupCompletedAt) {
    throw new HttpError(409, 'Complete your store setup before adding products', { reason: 'store_setup_incomplete' });
  }
}

export async function listMyProducts(req: Request, res: Response) {
  const { status, search } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = { vendorId: req.user!.id };
  if (status) filter.status = status;
  if (search) filter.name = { $regex: escapeRegex(search), $options: 'i' };

  const { skip, limit } = arrayPagination(req.query as Record<string, unknown>);
  const products = await Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
  res.json(products.map((p) => toSafeJson(p)));
}

export async function getMyProduct(req: Request, res: Response) {
  const product = await Product.findOne({ _id: req.params.id, vendorId: req.user!.id });
  if (!product) throw new HttpError(404, 'Product not found');
  res.json(toSafeJson(product));
}

export async function getStockHistory(req: Request, res: Response) {
  const { productId } = req.query as { productId?: string };
  const filter: Record<string, unknown> = { vendorId: req.user!.id };
  if (productId) filter.productId = productId;

  const events = await StockAdjustment.find(filter).sort({ createdAt: -1 }).limit(200);
  res.json(events.map((e) => toSafeJson(e)));
}

export async function createProduct(req: Request, res: Response) {
  await assertReadyToAddProducts(req.user!.id);
  const {
    categoryId,
    subcategoryId,
    name,
    description,
    brand,
    unit,
    images,
    variants,
    tags,
    taxRate,
    sku,
    barcode,
    hsnCode,
    countryOfOrigin,
    reorderLevel,
    maxStock,
  } = req.body;

  await assertCategoryAssignable(categoryId, subcategoryId);

  const product = await Product.create({
    vendorId: req.user!.id,
    categoryId,
    subcategoryId,
    name,
    description,
    brand,
    unit,
    images: images ?? [],
    variants,
    tags: tags ?? [],
    taxRate: taxRate ?? 0,
    status: 'pending',
    isAvailable: true,
    sku,
    barcode,
    hsnCode,
    countryOfOrigin,
    reorderLevel,
    maxStock,
  });
  res.status(201).json(toSafeJson(product));
}

export async function updateProduct(req: Request, res: Response) {
  const product = await Product.findOne({ _id: req.params.id, vendorId: req.user!.id });
  if (!product) throw new HttpError(404, 'Product not found');

  const {
    categoryId,
    subcategoryId,
    name,
    description,
    brand,
    unit,
    images,
    variants,
    tags,
    taxRate,
    sku,
    barcode,
    hsnCode,
    countryOfOrigin,
    reorderLevel,
    maxStock,
  } = req.body;

  if (categoryId !== undefined || subcategoryId !== undefined) {
    await assertCategoryAssignable(categoryId ?? String(product.categoryId), subcategoryId ?? product.subcategoryId);
  }

  // Editing display fields on a live product keeps it live — the data is
  // validated here, not sent back through moderation.
  Object.assign(product, {
    ...(categoryId !== undefined && { categoryId }),
    ...(subcategoryId !== undefined && { subcategoryId }),
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(brand !== undefined && { brand }),
    ...(unit !== undefined && { unit }),
    ...(images !== undefined && { images }),
    ...(variants !== undefined && { variants }),
    ...(tags !== undefined && { tags }),
    ...(taxRate !== undefined && { taxRate }),
    ...(sku !== undefined && { sku }),
    ...(barcode !== undefined && { barcode }),
    ...(hsnCode !== undefined && { hsnCode }),
    ...(countryOfOrigin !== undefined && { countryOfOrigin }),
    ...(reorderLevel !== undefined && { reorderLevel }),
    ...(maxStock !== undefined && { maxStock }),
  });
  await product.save();
  res.json(toSafeJson(product));
}

export async function updateStock(req: Request, res: Response) {
  const product = await Product.findOne({ _id: req.params.id, vendorId: req.user!.id });
  if (!product) throw new HttpError(404, 'Product not found');

  const { variantId, stock, reason, type, reference } = req.body as {
    variantId: string;
    stock: number;
    reason?: string;
    type?: StockEventType;
    reference?: string;
  };
  const variant = product.variants.find((v) => v.id === variantId);
  if (!variant) throw new HttpError(404, 'Variant not found');

  const previousStock = variant.stock;
  variant.stock = stock;
  await product.save();

  const delta = stock - previousStock;
  if (delta !== 0) {
    await StockAdjustment.create({
      vendorId: product.vendorId,
      productId: product._id as never,
      productName: product.name,
      type: type ?? 'adjustment',
      delta,
      afterStock: stock,
      reason: reason || 'Stock updated',
      reference,
      actor: 'You',
    });
  }

  // Only fire once per threshold crossing (previous stock was above it) —
  // otherwise every subsequent stock edit while already low would re-notify.
  if (stock === 0 && previousStock > 0) {
    await notifyVendor(product.vendorId, 'out-of-stock', `${product.name} out of stock`, `${variant.label} · Action needed`, {
      productId: product._id,
      productName: product.name,
    });
  } else if (product.reorderLevel !== undefined && stock > 0 && stock <= product.reorderLevel && previousStock > product.reorderLevel) {
    await notifyVendor(product.vendorId, 'low-stock', `${product.name} going low`, `${variant.label} · ${stock} units left`, {
      productId: product._id,
      productName: product.name,
    });
  }

  res.json(toSafeJson(product));
}

export async function setAvailability(req: Request, res: Response) {
  const product = await Product.findOne({ _id: req.params.id, vendorId: req.user!.id });
  if (!product) throw new HttpError(404, 'Product not found');

  product.isAvailable = Boolean(req.body.isAvailable);
  await product.save();
  res.json(toSafeJson(product));
}

export async function deleteProduct(req: Request, res: Response) {
  const product = await Product.findOneAndDelete({ _id: req.params.id, vendorId: req.user!.id });
  if (!product) throw new HttpError(404, 'Product not found');
  res.status(204).end();
}

export async function uploadImage(req: Request, res: Response) {
  if (!req.file) throw new HttpError(400, 'No file uploaded — field name must be "file"');
  res.status(201).json({ url: publicUrlFor(req.file.filename) });
}
