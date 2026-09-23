import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/driverPerformanceController';

export const driverPerformanceRouter = Router();
driverPerformanceRouter.use(authenticate, authorize('driver'));

driverPerformanceRouter.get('/summary', asyncHandler(ctrl.getSummary));
driverPerformanceRouter.get('/acceptance-rate', asyncHandler(ctrl.getAcceptanceRate));
driverPerformanceRouter.get('/completion-rate', asyncHandler(ctrl.getCompletionRate));
driverPerformanceRouter.get('/rating', asyncHandler(ctrl.getRating));
driverPerformanceRouter.get('/milestones', asyncHandler(ctrl.getMilestones));
