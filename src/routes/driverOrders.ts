import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/driverOrderController';

export const driverOrderRouter = Router();
driverOrderRouter.use(authenticate, authorize('driver'));

driverOrderRouter.get('/available', asyncHandler(ctrl.listAvailableOrders));
driverOrderRouter.get('/active', asyncHandler(ctrl.listActiveOrders));
driverOrderRouter.get(
  '/history',
  query('tab').optional().isIn(['completed', 'cancelled', 'all']),
  handleValidation,
  asyncHandler(ctrl.listOrderHistory),
);

driverOrderRouter.get('/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.getOrderById));
driverOrderRouter.get('/:id/timeline', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.getOrderTimeline));

driverOrderRouter.post('/:id/accept', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.acceptOrder));

driverOrderRouter.post(
  '/:id/reject',
  param('id').isMongoId(),
  body('reasonCode').optional().isString().trim(),
  handleValidation,
  asyncHandler(ctrl.rejectOrder),
);

driverOrderRouter.post(
  '/:id/pickup-confirm',
  param('id').isMongoId(),
  handleValidation,
  asyncHandler(ctrl.confirmPickup),
);

driverOrderRouter.post(
  '/:id/verify-otp',
  param('id').isMongoId(),
  body('otp').isString().notEmpty(),
  handleValidation,
  asyncHandler(ctrl.verifyDeliveryOtp),
);

driverOrderRouter.post(
  '/:id/issue',
  param('id').isMongoId(),
  body('type').isIn(['wrong_address', 'package_damage', 'vehicle_problem', 'road_blockage', 'safety_concern', 'delivery_failed']),
  body('description').optional().isString().trim(),
  body('evidenceUrls').optional().isArray(),
  body('evidenceUrls.*').isString().trim().notEmpty(),
  handleValidation,
  asyncHandler(ctrl.reportIssue),
);
