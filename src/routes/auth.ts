import { Router } from 'express';
import { body } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import * as authController from '../controllers/authController';

export const authRouter = Router();

authRouter.post(
  '/refresh',
  body('refreshToken').isString().notEmpty(),
  handleValidation,
  asyncHandler(authController.refresh),
);

authRouter.post(
  '/logout',
  body('refreshToken').isString().notEmpty(),
  handleValidation,
  asyncHandler(authController.logout),
);
