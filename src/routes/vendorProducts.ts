import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { upload } from '../lib/upload';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/vendorProductController';

export const vendorProductRouter = Router();
vendorProductRouter.use(authenticate, authorize('vendor'));

const variantValidator = body('variants')
  .isArray({ min: 1 })
  .withMessage('At least one variant is required');

vendorProductRouter.get('/', asyncHandler(ctrl.listMyProducts));

vendorProductRouter.post(
  '/upload-image',
  upload.single('file'),
  asyncHandler(ctrl.uploadImage),
);

vendorProductRouter.get('/stock-history', asyncHandler(ctrl.getStockHistory));

vendorProductRouter.post(
  '/',
  body('categoryId').isString().notEmpty().withMessage('Select a category'),
  body('name').isString().trim().notEmpty().withMessage('Product name is required'),
  variantValidator,
  handleValidation,
  asyncHandler(ctrl.createProduct),
);

vendorProductRouter.get('/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.getMyProduct));

vendorProductRouter.patch('/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.updateProduct));

vendorProductRouter.patch(
  '/:id/stock',
  param('id').isString().notEmpty(),
  body('variantId').isString().notEmpty(),
  body('stock').isInt({ min: 0 }),
  body('reason').optional().isString().trim(),
  body('type').optional().isIn(['purchase', 'sale', 'adjustment', 'return', 'damage', 'bulk', 'correction']),
  body('reference').optional().isString().trim(),
  handleValidation,
  asyncHandler(ctrl.updateStock),
);

vendorProductRouter.patch(
  '/:id/availability',
  param('id').isString().notEmpty(),
  body('isAvailable').isBoolean(),
  handleValidation,
  asyncHandler(ctrl.setAvailability),
);

vendorProductRouter.delete('/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.deleteProduct));
