import { Router } from 'express';
import { param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/customerWishlistController';

export const customerWishlistRouter = Router();
customerWishlistRouter.use(authenticate, authorize('customer'));

customerWishlistRouter.get('/', asyncHandler(ctrl.listWishlist));
customerWishlistRouter.post(
  '/:productId/toggle',
  param('productId').isMongoId(),
  handleValidation,
  asyncHandler(ctrl.toggleWishlist),
);
