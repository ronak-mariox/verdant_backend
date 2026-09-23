import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/driverNotificationController';

export const driverNotificationRouter = Router();
driverNotificationRouter.use(authenticate, authorize('driver'));

driverNotificationRouter.get('/', asyncHandler(ctrl.listNotifications));
driverNotificationRouter.get('/unread-count', asyncHandler(ctrl.getUnreadCount));
driverNotificationRouter.patch('/read-all', asyncHandler(ctrl.markAllRead));
driverNotificationRouter.patch(
  '/mark-unread',
  body('ids').isArray(),
  handleValidation,
  asyncHandler(ctrl.markUnread),
);
driverNotificationRouter.delete('/', asyncHandler(ctrl.clearAll));
driverNotificationRouter.patch('/:id/read', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.markRead));
driverNotificationRouter.delete('/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.dismissNotification));
