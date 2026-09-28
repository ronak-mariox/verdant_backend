import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/vendorNotificationController';

export const vendorNotificationRouter = Router();
vendorNotificationRouter.use(authenticate, authorize('vendor'));

vendorNotificationRouter.get('/', asyncHandler(ctrl.listNotifications));
vendorNotificationRouter.get('/unread-count', asyncHandler(ctrl.getUnreadCount));
vendorNotificationRouter.patch('/read-all', asyncHandler(ctrl.markAllRead));
vendorNotificationRouter.patch(
  '/mark-unread',
  body('ids').isArray(),
  handleValidation,
  asyncHandler(ctrl.markUnread),
);
vendorNotificationRouter.delete('/', asyncHandler(ctrl.clearAll));
vendorNotificationRouter.patch('/:id/read', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.markRead));
vendorNotificationRouter.delete('/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.dismissNotification));
