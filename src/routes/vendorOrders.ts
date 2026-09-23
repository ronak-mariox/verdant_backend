import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/vendorOrderController';

export const vendorOrderRouter = Router();
vendorOrderRouter.use(authenticate, authorize('vendor'));

vendorOrderRouter.get('/', asyncHandler(ctrl.listMyOrders));
vendorOrderRouter.get('/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.getMyOrder));

vendorOrderRouter.patch(
  '/:id/status',
  param('id').isString().notEmpty(),
  body('status').isIn(['accepted', 'rejected', 'cancelled', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered']),
  body('note').optional().isString().trim(),
  handleValidation,
  asyncHandler(ctrl.updateOrderStatus),
);
