import type { Request, Response } from 'express';
import { Category } from '../models/Category';
import { Product } from '../models/Product';
import { HttpError } from '../lib/httpError';
import { toSafeJson } from '../lib/sanitize';
import { notifyVendor } from '../lib/vendorNotify';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(_req: Request, res: Response) {
  const categories = await Category.find().sort({ sortOrder: 1 });
  res.json(categories.map((c) => toSafeJson(c)));
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function createCategory(req: Request, res: Response) {
  const { name, imageUrl, sortOrder, isActive, showOnHome, variantConfig } = req.body;
  const category = await Category.create({
    name,
    slug: slugify(name),
    imageUrl,
    sortOrder: sortOrder ?? 0,
    isActive: isActive ?? true,
    showOnHome: showOnHome ?? true,
    subcategories: [],
    variantConfig,
  });
  res.status(201).json(toSafeJson(category));
}

export async function updateCategory(req: Request, res: Response) {
  const category = await Category.findById(req.params.id);
  if (!category) throw new HttpError(404, 'Category not found');

  const { name, imageUrl, sortOrder, isActive, showOnHome, variantConfig } = req.body;
  if (name !== undefined) {
    category.name = name;
    category.slug = slugify(name);
  }
  if (imageUrl !== undefined) category.imageUrl = imageUrl;
  if (sortOrder !== undefined) category.sortOrder = sortOrder;
  if (isActive !== undefined) category.isActive = isActive;
  if (showOnHome !== undefined) category.showOnHome = showOnHome;
  if (variantConfig !== undefined) category.variantConfig = variantConfig;
  await category.save();
  res.json(toSafeJson(category));
}

export async function deleteCategory(req: Request, res: Response) {
  const inUse = await Product.countDocuments({ categoryId: req.params.id });
  if (inUse > 0) throw new HttpError(409, `${inUse} product(s) still use this category`);

  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) throw new HttpError(404, 'Category not found');
  res.status(204).end();
}

export async function addSubcategory(req: Request, res: Response) {
  const category = await Category.findById(req.params.id);
  if (!category) throw new HttpError(404, 'Category not found');

  const { name, imageUrl, variantConfig } = req.body;
  category.subcategories.push({ id: `sub-${Date.now()}`, name, imageUrl, isActive: true, variantConfig });
  await category.save();
  res.status(201).json(toSafeJson(category));
}

export async function updateSubcategory(req: Request, res: Response) {
  const category = await Category.findById(req.params.id);
  if (!category) throw new HttpError(404, 'Category not found');

  const sub = category.subcategories.find((s) => s.id === req.params.subId);
  if (!sub) throw new HttpError(404, 'Subcategory not found');

  const { name, imageUrl, isActive, variantConfig } = req.body;
  if (name !== undefined) sub.name = name;
  if (imageUrl !== undefined) sub.imageUrl = imageUrl;
  if (isActive !== undefined) sub.isActive = isActive;
  // null clears a subcategory's override so it falls back to the category's own variantConfig.
  if (variantConfig !== undefined) sub.variantConfig = variantConfig ?? undefined;
  await category.save();
  res.json(toSafeJson(category));
}

export async function removeSubcategory(req: Request, res: Response) {
  const category = await Category.findById(req.params.id);
  if (!category) throw new HttpError(404, 'Category not found');

  category.subcategories = category.subcategories.filter((s) => s.id !== req.params.subId);
  await category.save();
  res.json(toSafeJson(category));
}

// ---------------------------------------------------------------------------
// Product moderation — admin sees every vendor's products
// ---------------------------------------------------------------------------

export async function listAllProducts(req: Request, res: Response) {
  const { status, vendorId, search, page: pageRaw, limit: limitRaw } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (vendorId) filter.vendorId = vendorId;
  if (search) filter.name = { $regex: search, $options: 'i' };

  const page = Math.max(1, Number(pageRaw) || 1);
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 50));

  const [items, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ items: items.map((p) => toSafeJson(p)), page, limit, total, totalPages: Math.ceil(total / limit) });
}

export async function getProductForAdmin(req: Request, res: Response) {
  const product = await Product.findById(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found');
  res.json(toSafeJson(product));
}

export async function updateProductStatus(req: Request, res: Response) {
  const { status, rejectionReason } = req.body as { status: 'active' | 'inactive' | 'rejected'; rejectionReason?: string };
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: { status, rejectionReason: status === 'rejected' ? rejectionReason : undefined } },
    { new: true },
  );
  if (!product) throw new HttpError(404, 'Product not found');

  if (status === 'active') {
    await notifyVendor(product.vendorId, 'product-approval', 'Product Approved', `${product.name} is now live`, {
      productId: product._id,
      productName: product.name,
    });
  } else if (status === 'rejected') {
    await notifyVendor(
      product.vendorId,
      'product-approval',
      'Product Rejected',
      rejectionReason ? `${product.name} · ${rejectionReason}` : `${product.name} was not approved`,
      { productId: product._id, productName: product.name },
    );
  }

  res.json(toSafeJson(product));
}

export async function updateProductForAdmin(req: Request, res: Response) {
  const product = await Product.findById(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found');

  const {
    name,
    description,
    images,
    variants,
    tags,
    taxRate,
    isAvailable,
    sku,
    barcode,
    hsnCode,
    countryOfOrigin,
    reorderLevel,
    maxStock,
  } = req.body;
  Object.assign(product, {
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(images !== undefined && { images }),
    ...(variants !== undefined && { variants }),
    ...(tags !== undefined && { tags }),
    ...(taxRate !== undefined && { taxRate }),
    ...(isAvailable !== undefined && { isAvailable }),
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
