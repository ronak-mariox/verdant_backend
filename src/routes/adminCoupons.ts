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
adminCouponRouter.patch('/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.updateCoupon));
adminCouponRouter.delete('/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.deleteCoupon));
