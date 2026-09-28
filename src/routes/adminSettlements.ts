import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/adminSettlementsController';

export const adminSettlementsRouter = Router();
adminSettlementsRouter.use(authenticate, authorize('admin'));

adminSettlementsRouter.get('/vendors', asyncHandler(ctrl.listVendorSettlements));
adminSettlementsRouter.get('/drivers', asyncHandler(ctrl.listDriverPayouts));
adminSettlementsRouter.get(
  '/batches',
  query('status').optional().isIn(['pending', 'paid', 'failed']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  handleValidation,
  asyncHandler(ctrl.listPayoutBatches),
);

adminSettlementsRouter.patch(
  '/batches/:id/paid',
  param('id').isMongoId(),
  body('bankAccountLabel').optional().isString().trim(),
  body('transactionRef').optional().isString().trim(),
  handleValidation,
  asyncHandler(ctrl.markPayoutBatchPaid),
);
adminSettlementsRouter.patch(
  '/batches/:id/failed',
  param('id').isMongoId(),
  body('failureReason').optional().isString().trim(),
  handleValidation,
  asyncHandler(ctrl.markPayoutBatchFailed),
);
