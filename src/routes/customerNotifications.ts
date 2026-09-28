import { Router } from 'express';
import { param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/customerNotificationController';

export const customerNotificationRouter = Router();
customerNotificationRouter.use(authenticate, authorize('customer'));

customerNotificationRouter.get('/', asyncHandler(ctrl.listNotifications));
customerNotificationRouter.get('/unread-count', asyncHandler(ctrl.getUnreadCount));
customerNotificationRouter.patch('/read-all', asyncHandler(ctrl.markAllRead));
customerNotificationRouter.get('/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.getNotification));
customerNotificationRouter.patch('/:id/read', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.markRead));
