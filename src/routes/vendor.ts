import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { normalizePhone } from '../lib/json';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { upload } from '../lib/upload';
import { asyncHandler } from '../utils/asyncHandler';
import { env } from '../lib/env';
import { vendorRegistrationRouter } from './vendorRegistration';
import { vendorStoreSetupRouter } from './vendorStoreSetup';
import { vendorProductRouter } from './vendorProducts';
import { vendorOrderRouter } from './vendorOrders';
import { vendorOfferRouter } from './vendorOffers';
import { vendorProfileRouter } from './vendorProfile';
import { vendorAnalyticsRouter } from './vendorAnalytics';
import { vendorNotificationRouter } from './vendorNotifications';
import * as vendorController from '../controllers/vendorController';
import * as customerCatalogController from '../controllers/customerCatalogController';

export const vendorRouter = Router();

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

// ---------------------------------------------------------------------------
// OTP + account creation + password login
// ---------------------------------------------------------------------------

vendorRouter.post(
  '/auth/otp/request',
  otpRequestLimiter,
  phoneValidator,
  handleValidation,
  asyncHandler(vendorController.requestOtp),
);

vendorRouter.post(
  '/auth/otp/verify',
  phoneValidator,
  otpValidator,
  body('intent').isIn(['login', 'create-account']),
  handleValidation,
  asyncHandler(vendorController.verifyOtp),
);

vendorRouter.post(
  '/auth/register',
  body('verifiedPhoneToken').isString().notEmpty(),
  body('fullName').isString().trim().isLength({ min: 2, max: 80 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match'),
  handleValidation,
  asyncHandler(vendorController.register),
);

vendorRouter.post(
  '/auth/login',
  body('identifier').isString().trim().notEmpty().withMessage('Enter your mobile number or email'),
  body('password').isString().notEmpty(),
  handleValidation,
  asyncHandler(vendorController.login),
);

vendorRouter.post(
  '/auth/reset-password',
  body('resetToken').isString().notEmpty(),
  body('newPassword').isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  handleValidation,
  asyncHandler(vendorController.resetPassword),
);

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

vendorRouter.get('/me', authenticate, authorize('vendor'), asyncHandler(vendorController.getMe));

vendorRouter.post(
  '/me/avatar',
  authenticate,
  authorize('vendor'),
  upload.single('avatar'),
  asyncHandler(vendorController.uploadAvatar),
);

// Post-approval profile editing (business/owner/store/bank info, stats,
// addresses, notification prefs) — see routes/vendorProfile.ts.
vendorRouter.use('/me', vendorProfileRouter);
vendorRouter.use('/analytics', vendorAnalyticsRouter);
vendorRouter.use('/notifications', vendorNotificationRouter);

// ---------------------------------------------------------------------------
// Multi-step business registration — see routes/vendorRegistration.ts.
// ---------------------------------------------------------------------------

vendorRouter.use('/registration', vendorRegistrationRouter);

// ---------------------------------------------------------------------------
// Post-approval store setup — see routes/vendorStoreSetup.ts.
// ---------------------------------------------------------------------------

vendorRouter.use('/store-setup', vendorStoreSetupRouter);

// ---------------------------------------------------------------------------
// Categories (read-only — vendors assign products to admin-managed categories),
// products, and order management — see their own route files.
// ---------------------------------------------------------------------------

vendorRouter.get(
  '/categories',
  authenticate,
  authorize('vendor'),
  asyncHandler(customerCatalogController.getCategories),
);

vendorRouter.use('/products', vendorProductRouter);
vendorRouter.use('/orders', vendorOrderRouter);
vendorRouter.use('/offers', vendorOfferRouter);
