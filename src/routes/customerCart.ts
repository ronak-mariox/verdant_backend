import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/customerCartController';

export const customerCartRouter = Router();
customerCartRouter.use(authenticate, authorize('customer'));

customerCartRouter.get('/', asyncHandler(ctrl.getCart));

customerCartRouter.post(
  '/items',
  body('productId').isString().notEmpty(),
  body('variantId').isString().notEmpty(),
  body('quantity').optional().isInt({ min: 1 }),
  handleValidation,
  asyncHandler(ctrl.addItem),
);

customerCartRouter.patch(
  '/items/:productId/:variantId',
  param('productId').isString().notEmpty(),
  param('variantId').isString().notEmpty(),
  body('quantity').isInt({ min: 0 }),
  handleValidation,
  asyncHandler(ctrl.updateItem),
);

customerCartRouter.delete('/items/:productId/:variantId', asyncHandler(ctrl.removeItem));

customerCartRouter.delete('/', asyncHandler(ctrl.clearCart));

customerCartRouter.post(
  '/coupon',
  body('code').isString().trim().notEmpty().withMessage('Enter a coupon code'),
  handleValidation,
  asyncHandler(ctrl.applyCoupon),
);

customerCartRouter.delete('/coupon', asyncHandler(ctrl.removeCoupon));
