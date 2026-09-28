import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/adminCouponController';

export const adminCouponRouter = Router();
adminCouponRouter.use(authenticate, authorize('admin'));

adminCouponRouter.get('/', asyncHandler(ctrl.listCoupons));
adminCouponRouter.post(
  '/',
  body('code').isString().trim().notEmpty().withMessage('Coupon code is required'),
  body('discountType').isIn(['flat', 'percent']),
  body('value').isFloat({ min: 0 }),
  handleValidation,
  asyncHandler(ctrl.createCoupon),
);
adminCouponRouter.patch(
  '/:id',
  param('id').isMongoId(),
  body('code').optional().isString().trim().notEmpty().withMessage('Coupon code cannot be empty'),
  body('discountType').optional().isIn(['flat', 'percent']),
  body('value').optional().isFloat({ min: 0 }),
  body('minOrderValue').optional().isFloat({ min: 0 }),
  body('maxDiscount').optional({ values: 'null' }).isFloat({ min: 0 }),
  body('expiresAt').optional({ values: 'null' }).isISO8601(),
  body('usageLimit').optional({ values: 'null' }).isInt({ min: 0 }),
  body('isActive').optional().isBoolean(),
  handleValidation,
  asyncHandler(ctrl.updateCoupon),
);
adminCouponRouter.delete('/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.deleteCoupon));
