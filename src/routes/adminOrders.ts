import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/adminOrderController';

export const adminOrderRouter = Router();
adminOrderRouter.use(authenticate, authorize('admin'));

adminOrderRouter.get('/', asyncHandler(ctrl.listAllOrders));
adminOrderRouter.get('/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.getOrderForAdmin));
adminOrderRouter.patch(
  '/:id/status',
  param('id').isMongoId(),
  body('status').isIn([
    'placed',
    'accepted',
    'preparing',
    'ready_for_pickup',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'rejected',
  ]),
  body('note').optional().isString().trim(),
  handleValidation,
  asyncHandler(ctrl.updateOrderStatusAsAdmin),
);
