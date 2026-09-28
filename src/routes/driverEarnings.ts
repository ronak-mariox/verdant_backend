import { Router } from 'express';
import { param, query } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/driverEarningsController';

export const driverEarningsRouter = Router();
driverEarningsRouter.use(authenticate, authorize('driver'));

driverEarningsRouter.get(
  '/summary',
  query('period').optional().isIn(['today', 'week', 'month']),
  handleValidation,
  asyncHandler(ctrl.getSummary),
);

driverEarningsRouter.get(
  '/history',
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  handleValidation,
  asyncHandler(ctrl.getHistory),
);

driverEarningsRouter.get(
  '/breakdown/:orderId',
  param('orderId').isMongoId(),
  handleValidation,
  asyncHandler(ctrl.getBreakdown),
);

driverEarningsRouter.get('/payout-status', asyncHandler(ctrl.getPayoutStatus));
