import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/customerOrderController';

export const customerOrderRouter = Router();
customerOrderRouter.use(authenticate, authorize('customer'));

customerOrderRouter.get('/', asyncHandler(ctrl.listOrders));

customerOrderRouter.post(
  '/',
  body('addressId').isMongoId().withMessage('Select a delivery address'),
  body('paymentMethod').isIn(['cod', 'online']),
  handleValidation,
  asyncHandler(ctrl.createOrder),
);

customerOrderRouter.get('/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.getOrder));

customerOrderRouter.post(
  '/:id/cancel',
  param('id').isMongoId(),
  body('reason').optional().isString().trim(),
  handleValidation,
  asyncHandler(ctrl.cancelOrder),
);

customerOrderRouter.post(
  '/:id/rate',
  param('id').isMongoId(),
  body('stars').isInt({ min: 1, max: 5 }),
  body('reviewText').optional().isString().trim(),
  handleValidation,
  asyncHandler(ctrl.rateOrder),
);
