import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { normalizePhone } from '../lib/json';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { upload } from '../lib/upload';
import { asyncHandler } from '../utils/asyncHandler';
import { env } from '../lib/env';
import * as customerController from '../controllers/customerController';
import { customerCatalogRouter } from './customerCatalog';
import { customerAddressRouter } from './customerAddress';
import { customerCartRouter } from './customerCart';
import { customerOrderRouter } from './customerOrders';
import { customerNotificationRouter } from './customerNotifications';
import { customerWishlistRouter } from './customerWishlist';

export const customerRouter = Router();

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${normalizePhone(req.body?.phone ?? '')}`,
  message: { error: 'Too many OTP requests — please try again in a few minutes' },
});

const phoneValidator = body('phone')
  .customSanitizer(normalizePhone)
  .isLength({ min: 10, max: 10 })
  .withMessage('Enter a valid 10-digit mobile number');

const otpValidator = body('otp')
  .isString()
  .isLength({ min: env.otpLength, max: env.otpLength })
  .isNumeric()
  .withMessage(`OTP must be ${env.otpLength} digits`);

customerRouter.post(
  '/auth/otp/request',
  otpRequestLimiter,
  phoneValidator,
  handleValidation,
  asyncHandler(customerController.requestOtp),
);

customerRouter.post(
  '/auth/otp/verify',
  phoneValidator,
  otpValidator,
  handleValidation,
  asyncHandler(customerController.verifyOtp),
);

customerRouter.post(
  '/auth/register',
  body('verifiedPhoneToken').isString().notEmpty(),
  body('name').isString().trim().isLength({ min: 2, max: 80 }).withMessage('Full name is required'),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid email').normalizeEmail(),
  handleValidation,
  asyncHandler(customerController.register),
);

customerRouter.get('/me', authenticate, authorize('customer'), asyncHandler(customerController.getMe));

customerRouter.patch(
  '/me',
  authenticate,
  authorize('customer'),
  body('name').optional().isString().trim().isLength({ min: 1, max: 80 }),
  body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
  body('dob').optional({ values: 'falsy' }).isISO8601().withMessage('dob must be an ISO date (YYYY-MM-DD)'),
  body('gender').optional({ values: 'falsy' }).isIn(['female', 'male', 'other']),
  handleValidation,
  asyncHandler(customerController.updateMe),
);

customerRouter.post(
  '/me/avatar',
  authenticate,
  authorize('customer'),
  upload.single('avatar'),
  asyncHandler(customerController.uploadAvatar),
);

// ---------------------------------------------------------------------------
// Catalog browsing, addresses, cart, and orders — see their own route files.
// ---------------------------------------------------------------------------

customerRouter.use('/', customerCatalogRouter);
customerRouter.use('/addresses', customerAddressRouter);
customerRouter.use('/cart', customerCartRouter);
customerRouter.use('/orders', customerOrderRouter);
customerRouter.use('/notifications', customerNotificationRouter);
customerRouter.use('/wishlist', customerWishlistRouter);
