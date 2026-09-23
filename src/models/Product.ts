import { Schema, model, Types } from 'mongoose';
import crypto from 'node:crypto';

export interface ProductVariant {
  id: string;
  label: string;
  mrp: number;
  price: number;
  stock: number;
  sku?: string;
  isPrimary?: boolean;
}

export type ProductStatus = 'draft' | 'pending' | 'active' | 'inactive' | 'rejected';

export interface ProductDoc {
  _id: unknown;
  vendorId: Types.ObjectId;
  categoryId: Types.ObjectId;
  subcategoryId?: string;
  name: string;
  description?: string;
  brand?: string;
  unit?: string;
  images: string[];
  variants: ProductVariant[];
  tags: string[];
  taxRate: number;
  status: ProductStatus;
  rejectionReason?: string;
  isAvailable: boolean;
  sku?: string;
  barcode?: string;
  hsnCode?: string;
  countryOfOrigin?: string;
  reorderLevel?: number;
  maxStock?: number;
  createdAt: Date;
  updatedAt: Date;
}

const variantSchema = new Schema<ProductVariant>(
  {
    // Defaulted rather than left to the client — a variant with no caller-supplied
    // id (e.g. a simple single-variant product with no "Variants" step filled in)
    // would otherwise fail this required field at save time.
    id: { type: String, required: true, default: () => crypto.randomUUID() },
    label: { type: String, required: true },
    mrp: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    sku: String,
    isPrimary: Boolean,
  },
  { _id: false },
);

const productSchema = new Schema<ProductDoc>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    subcategoryId: String,
    name: { type: String, required: true, trim: true },
    description: String,
    brand: String,
    unit: String,
    images: { type: [String], default: [] },
    variants: {
      type: [variantSchema],
      default: [],
      validate: {
        validator: (v: ProductVariant[]) => v.length > 0,
        message: 'A product needs at least one variant',
      },
    },
    tags: { type: [String], default: [] },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    status: { type: String, enum: ['draft', 'pending', 'active', 'inactive', 'rejected'], default: 'pending' },
    rejectionReason: String,
    isAvailable: { type: Boolean, default: true },
    sku: String,
    barcode: String,
    hsnCode: String,
    countryOfOrigin: String,
    reorderLevel: Number,
    maxStock: Number,
  },
  { timestamps: true },
);

productSchema.index({ vendorId: 1 });
productSchema.index({ categoryId: 1, subcategoryId: 1 });
productSchema.index({ status: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ name: 'text', description: 'text' });

export const Product = model<ProductDoc>('Product', productSchema);
