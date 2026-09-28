import { Schema, model } from 'mongoose';

export type VariantKind = 'weight_volume' | 'attribute' | 'none';

export const VARIANT_KINDS: VariantKind[] = ['weight_volume', 'attribute', 'none'];

export interface CategoryVariantConfig {
  // 'none' = sold as a single item with no size/unit at all (e.g. earbuds).
  kind: VariantKind;
  label: string;
  units?: string[];
  options?: string[];
  // Lets a vendor type a value that isn't in `options` (attribute kind only).
  allowCustom?: boolean;
}

export interface SubcategoryItem {
  id: string;
  name: string;
  imageUrl?: string;
  isActive: boolean;
  // Each subcategory's own unit/variant setup — e.g. Fashion's "Dresses" needs
  // clothing sizes while its "Watches" subcategory doesn't. Falls back to the
  // category's own variantConfig when unset.
  variantConfig?: CategoryVariantConfig;
  variantConfigs?: CategoryVariantConfig[];
}

export interface CategoryDoc {
  _id: unknown;
  name: string;
  slug: string;
  imageUrl?: string;
  sortOrder: number;
  isActive: boolean;
  showOnHome: boolean;
  subcategories: SubcategoryItem[];
  // Primary variant type; kept in sync with variantConfigs[0] for older clients.
  variantConfig?: CategoryVariantConfig;
  // Every variant type a product here may use — the vendor picks one per product.
  variantConfigs?: CategoryVariantConfig[];
  createdAt: Date;
  updatedAt: Date;
}

const variantConfigSchema = new Schema<CategoryVariantConfig>(
  {
    kind: { type: String, enum: VARIANT_KINDS, required: true },
    label: { type: String, required: true, trim: true },
    units: { type: [String], default: undefined },
    options: { type: [String], default: undefined },
    allowCustom: { type: Boolean, default: undefined },
  },
  { _id: false },
);

const subcategorySchema = new Schema<SubcategoryItem>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    imageUrl: String,
    isActive: { type: Boolean, default: true },
    variantConfig: { type: variantConfigSchema, required: false },
    variantConfigs: { type: [variantConfigSchema], default: undefined },
  },
  { _id: false },
);

const categorySchema = new Schema<CategoryDoc>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    imageUrl: String,
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    showOnHome: { type: Boolean, default: true },
    subcategories: { type: [subcategorySchema], default: [] },
    variantConfig: { type: variantConfigSchema, required: false },
    variantConfigs: { type: [variantConfigSchema], default: undefined },
  },
  { timestamps: true },
);

categorySchema.index({ sortOrder: 1 });

export const Category = model<CategoryDoc>('Category', categorySchema);
