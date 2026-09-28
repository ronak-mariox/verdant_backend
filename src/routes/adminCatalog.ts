import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { productBodyValidators } from './productValidators';
import { VARIANT_KINDS, type VariantKind } from '../models/Category';
import * as ctrl from '../controllers/adminCatalogController';

export const adminCatalogRouter = Router();
adminCatalogRouter.use(authenticate, authorize('admin'));

// Categories
function assertVariantConfig(value: unknown, field: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const config = value as Record<string, unknown>;
  if (!VARIANT_KINDS.includes(config.kind as VariantKind)) {
    throw new Error(`${field}.kind must be one of ${VARIANT_KINDS.join(', ')}`);
  }
  if (typeof config.label !== 'string' || !config.label.trim()) {
    throw new Error(`${field}.label is required`);
  }
  for (const key of ['units', 'options'] as const) {
    const list = config[key];
    if (list !== undefined && (!Array.isArray(list) || !list.every((item) => typeof item === 'string'))) {
      throw new Error(`${field}.${key} must be an array of strings`);
    }
  }
  if (config.allowCustom !== undefined && typeof config.allowCustom !== 'boolean') {
    throw new Error(`${field}.allowCustom must be a boolean`);
  }
  if (config.kind === 'attribute' && !config.allowCustom && !(config.options as string[] | undefined)?.length) {
    throw new Error(`${field} needs at least one option, or allow vendors to enter their own`);
  }
}

// null clears the setting: a subcategory then inherits its category's variant types.
const variantConfigValidators = [
  body('variantConfig')
    .optional({ values: 'null' })
    .custom((value) => {
      if (value !== null) assertVariantConfig(value, 'variantConfig');
      return true;
    }),
  body('variantConfigs')
    .optional({ values: 'null' })
    .custom((value) => {
      if (value === null) return true;
      if (!Array.isArray(value)) throw new Error('variantConfigs must be an array');
      value.forEach((config, index) => assertVariantConfig(config, `variantConfigs[${index}]`));
      const labels = value.map((config) => String(config.label).trim().toLowerCase());
      if (new Set(labels).size !== labels.length) throw new Error('Each variant type needs a different label');
      return true;
    }),
];

adminCatalogRouter.get('/categories', asyncHandler(ctrl.listCategories));
adminCatalogRouter.post(
  '/categories',
  body('name').isString().trim().notEmpty().withMessage('Category name is required'),
  ...variantConfigValidators,
  handleValidation,
  asyncHandler(ctrl.createCategory),
);
adminCatalogRouter.patch(
  '/categories/:id',
  param('id').isMongoId(),
  ...variantConfigValidators,
  handleValidation,
  asyncHandler(ctrl.updateCategory),
);
adminCatalogRouter.delete('/categories/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.deleteCategory));

adminCatalogRouter.post(
  '/categories/:id/subcategories',
  param('id').isMongoId(),
  body('name').isString().trim().notEmpty().withMessage('Subcategory name is required'),
  ...variantConfigValidators,
  handleValidation,
  asyncHandler(ctrl.addSubcategory),
);
adminCatalogRouter.patch(
  '/categories/:id/subcategories/:subId',
  param('id').isMongoId(),
  param('subId').isString().notEmpty(),
  ...variantConfigValidators,
  handleValidation,
  asyncHandler(ctrl.updateSubcategory),
);
adminCatalogRouter.delete(
  '/categories/:id/subcategories/:subId',
  param('id').isMongoId(),
  param('subId').isString().notEmpty(),
  handleValidation,
  asyncHandler(ctrl.removeSubcategory),
);

// Product moderation
adminCatalogRouter.get('/products', asyncHandler(ctrl.listAllProducts));
adminCatalogRouter.get('/products/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.getProductForAdmin));
adminCatalogRouter.patch(
  '/products/:id/status',
  param('id').isMongoId(),
  body('status').isIn(['active', 'inactive', 'rejected']),
  body('rejectionReason').optional({ values: 'falsy' }).isString(),
  handleValidation,
  asyncHandler(ctrl.updateProductStatus),
);
adminCatalogRouter.patch(
  '/products/:id',
  param('id').isMongoId(),
  ...productBodyValidators('update'),
  handleValidation,
  asyncHandler(ctrl.updateProductForAdmin),
);
