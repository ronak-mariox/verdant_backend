import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/adminSupportController';

export const adminSupportRouter = Router();
adminSupportRouter.use(authenticate, authorize('admin'));

adminSupportRouter.get('/', asyncHandler(ctrl.listTickets));
