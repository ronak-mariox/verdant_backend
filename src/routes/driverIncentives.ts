import { Router } from 'express';
import { param, query } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/driverIncentiveController';

export const driverIncentiveRouter = Router();
driverIncentiveRouter.use(authenticate, authorize('driver'));

driverIncentiveRouter.get('/', asyncHandler(ctrl.listIncentives));
driverIncentiveRouter.get('/progress', asyncHandler(ctrl.getProgress));
driverIncentiveRouter.get(
  '/bonus-history',
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  handleValidation,
  asyncHandler(ctrl.getBonusHistory),
);
driverIncentiveRouter.get('/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.getIncentiveById));
