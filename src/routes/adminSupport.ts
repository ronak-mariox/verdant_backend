import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/adminSupportController';

export const adminSupportRouter = Router();
adminSupportRouter.use(authenticate, authorize('admin'));

adminSupportRouter.get('/', asyncHandler(ctrl.listTickets));

adminSupportRouter.patch(
  '/:id',
  param('id').isMongoId(),
  body('status')
    .optional()
    .customSanitizer((v) => (v === 'in-progress' ? 'in_progress' : v))
    .isIn(['open', 'in_progress', 'resolved', 'escalated']),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('note').optional({ values: 'falsy' }).isString().trim(),
  handleValidation,
  asyncHandler(ctrl.updateTicket),
);
