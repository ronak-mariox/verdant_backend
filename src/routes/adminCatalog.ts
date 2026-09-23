import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/adminCatalogController';

export const adminCatalogRouter = Router();
adminCatalogRouter.use(authenticate, authorize('admin'));

// Categories
const variantConfigValidators = [
  body('variantConfig').optional().isObject().withMessage('variantConfig must be an object'),
  body('variantConfig.kind')
    .if(body('variantConfig').exists())
    .isIn(['weight_volume', 'attribute'])
    .withMessage('variantConfig.kind must be weight_volume or attribute'),
  body('variantConfig.label')
    .if(body('variantConfig').exists())
    .isString()
    .trim()
    .notEmpty()
    .withMessage('variantConfig.label is required'),
  body('variantConfig.units').optional().isArray().withMessage('variantConfig.units must be an array of strings'),
  body('variantConfig.units.*').optional().isString(),
  body('variantConfig.options').optional().isArray().withMessage('variantConfig.options must be an array of strings'),
  body('variantConfig.options.*').optional().isString(),
];

// Subcategory PATCH allows variantConfig: null to clear a subcategory's override
// (falling back to the category's own variantConfig), which the plain isObject()
// check above rejects — so PATCH uses this custom validator instead.
const nullableVariantConfigValidator = body('variantConfig')
  .optional({ values: 'null' })
  .custom((value) => {
    if (value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('variantConfig must be an object or null');
    }
    if (!['weight_volume', 'attribute'].includes(value.kind)) {
      throw new Error('variantConfig.kind must be weight_volume or attribute');
    }
    if (typeof value.label !== 'string' || !value.label.trim()) {
      throw new Error('variantConfig.label is required');
    }
    if (value.units !== undefined && (!Array.isArray(value.units) || !value.units.every((u: unknown) => typeof u === 'string'))) {
      throw new Error('variantConfig.units must be an array of strings');
    }
    if (value.options !== undefined && (!Array.isArray(value.options) || !value.options.every((o: unknown) => typeof o === 'string'))) {
      throw new Error('variantConfig.options must be an array of strings');
    }
    return true;
  });

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
  param('id').isString().notEmpty(),
  ...variantConfigValidators,
  handleValidation,
  asyncHandler(ctrl.updateCategory),
);
adminCatalogRouter.delete('/categories/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.deleteCategory));

adminCatalogRouter.post(
  '/categories/:id/subcategories',
  param('id').isString().notEmpty(),
  body('name').isString().trim().notEmpty().withMessage('Subcategory name is required'),
  ...variantConfigValidators,
  handleValidation,
  asyncHandler(ctrl.addSubcategory),
);
adminCatalogRouter.patch(
  '/categories/:id/subcategories/:subId',
  param('id').isString().notEmpty(),
  param('subId').isString().notEmpty(),
  nullableVariantConfigValidator,
  handleValidation,
  asyncHandler(ctrl.updateSubcategory),
);
adminCatalogRouter.delete(
  '/categories/:id/subcategories/:subId',
  param('id').isString().notEmpty(),
  param('subId').isString().notEmpty(),
  handleValidation,
  asyncHandler(ctrl.removeSubcategory),
);

// Product moderation
adminCatalogRouter.get('/products', asyncHandler(ctrl.listAllProducts));
adminCatalogRouter.get('/products/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.getProductForAdmin));
adminCatalogRouter.patch(
  '/products/:id/status',
  param('id').isString().notEmpty(),
  body('status').isIn(['active', 'inactive', 'rejected']),
  body('rejectionReason').optional({ values: 'falsy' }).isString(),
  handleValidation,
  asyncHandler(ctrl.updateProductStatus),
);
adminCatalogRouter.patch('/products/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.updateProductForAdmin));
