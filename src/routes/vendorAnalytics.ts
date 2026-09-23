import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/vendorAnalyticsController';

export const vendorAnalyticsRouter = Router();
vendorAnalyticsRouter.use(authenticate, authorize('vendor'));

vendorAnalyticsRouter.get('/overview', asyncHandler(ctrl.getOverview));
vendorAnalyticsRouter.get('/best-selling', asyncHandler(ctrl.getBestSelling));
vendorAnalyticsRouter.get('/low-performing', asyncHandler(ctrl.getLowPerforming));
vendorAnalyticsRouter.get('/cancellation-reasons', asyncHandler(ctrl.getCancellationReasons));
vendorAnalyticsRouter.get('/inventory-performance', asyncHandler(ctrl.getInventoryPerformance));
