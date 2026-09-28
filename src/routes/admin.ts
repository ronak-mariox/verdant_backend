import { Router } from 'express';
import { body, param } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as adminController from '../controllers/adminController';
import { adminCatalogRouter } from './adminCatalog';
import { adminOrderRouter } from './adminOrders';
import { adminCouponRouter } from './adminCoupons';
import { adminSupportRouter } from './adminSupport';
import { adminSettlementsRouter } from './adminSettlements';
import { adminIncentiveRouter } from './adminIncentives';
import { DRIVER_REVIEW_KEYS } from '../models/Driver';

export const adminRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — please try again in a few minutes' },
});

adminRouter.post(
  '/auth/login',
  loginLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').isString().notEmpty(),
  handleValidation,
  asyncHandler(adminController.login),
);

adminRouter.get('/me', authenticate, authorize('admin'), asyncHandler(adminController.getMe));

// ---------------------------------------------------------------------------
// KYC approvals — makes vendor/driver "verification pending" screens reflect a
// real admin decision instead of a client-side random roll.
// ---------------------------------------------------------------------------

adminRouter.get(
  '/vendors/pending',
  authenticate,
  authorize('admin'),
  asyncHandler(adminController.getPendingVendors),
);

adminRouter.patch(
  '/vendors/:id/status',
  authenticate,
  authorize('admin'),
  param('id').isMongoId(),
  body('status').isIn(['active', 'rejected', 'suspended']),
  body('kycStatus').optional().isIn(['verified', 'rejected', 'pending']),
  body('rejectionReason').optional({ values: 'falsy' }).isString(),
  handleValidation,
  asyncHandler(adminController.updateVendorStatus),
);

adminRouter.patch(
  '/vendors/:id/steps/:stepKey',
  authenticate,
  authorize('admin'),
  param('id').isMongoId(),
  param('stepKey').isIn([
    'businessType',
    'businessInfo',
    'ownerInfo',
    'storeInfo',
    'gstDetails',
    'panDetails',
    'businessProof',
    'bankDetails',
  ]),
  body('status').isIn(['pending', 'verified', 'rejected']),
  body('note').optional({ values: 'falsy' }).isString(),
  handleValidation,
  asyncHandler(adminController.updateVendorStepReview),
);

adminRouter.get(
  '/bank-requests',
  authenticate,
  authorize('admin'),
  asyncHandler(adminController.getPendingBankRequests),
);

adminRouter.patch(
  '/bank-requests/:vendorId',
  authenticate,
  authorize('admin'),
  param('vendorId').isMongoId(),
  body('approve').isBoolean(),
  body('note').optional({ values: 'falsy' }).isString(),
  handleValidation,
  asyncHandler(adminController.reviewBankRequest),
);

adminRouter.get(
  '/vendors/:id/settlements',
  authenticate,
  authorize('admin'),
  param('id').isMongoId(),
  handleValidation,
  asyncHandler(adminController.getVendorSettlements),
);

adminRouter.get(
  '/drivers/pending',
  authenticate,
  authorize('admin'),
  asyncHandler(adminController.getPendingDrivers),
);

adminRouter.patch(
  '/drivers/:id/reviews/:key',
  authenticate,
  authorize('admin'),
  param('id').isMongoId(),
  param('key').isIn([...DRIVER_REVIEW_KEYS]),
  body('status').isIn(['pending', 'verified', 'rejected']),
  body('note')
    .if(body('status').equals('rejected'))
    .isString()
    .trim()
    .notEmpty()
    .withMessage('A reason is required when rejecting an item'),
  handleValidation,
  asyncHandler(adminController.updateDriverItemReview),
);

adminRouter.patch(
  '/drivers/:id/status',
  authenticate,
  authorize('admin'),
  param('id').isMongoId(),
  body('status').isIn(['active', 'rejected', 'suspended']),
  body('kycStatus').optional().isIn(['verified', 'rejected', 'pending']),
  body('rejectionReason').optional({ values: 'falsy' }).isString(),
  handleValidation,
  asyncHandler(adminController.updateDriverStatus),
);

// ---------------------------------------------------------------------------
// Directory listings (full rosters, not just pending) + dashboard
// ---------------------------------------------------------------------------

adminRouter.get('/vendors', authenticate, authorize('admin'), asyncHandler(adminController.getAllVendors));
adminRouter.get('/vendors/:id', authenticate, authorize('admin'), param('id').isMongoId(), handleValidation, asyncHandler(adminController.getVendorById));

adminRouter.get('/drivers', authenticate, authorize('admin'), asyncHandler(adminController.getAllDrivers));
adminRouter.get('/drivers/:id', authenticate, authorize('admin'), param('id').isMongoId(), handleValidation, asyncHandler(adminController.getDriverById));

adminRouter.get('/customers', authenticate, authorize('admin'), asyncHandler(adminController.getAllCustomers));
adminRouter.get('/customers/:id', authenticate, authorize('admin'), param('id').isMongoId(), handleValidation, asyncHandler(adminController.getCustomerById));
adminRouter.patch(
  '/customers/:id/status',
  authenticate,
  authorize('admin'),
  param('id').isMongoId(),
  body('status').isIn(['active', 'blocked']),
  handleValidation,
  asyncHandler(adminController.updateCustomerStatus),
);

adminRouter.get('/dashboard', authenticate, authorize('admin'), asyncHandler(adminController.getDashboard));

// ---------------------------------------------------------------------------
// Catalog (categories + product moderation), orders, and coupons — see their
// own route files.
// ---------------------------------------------------------------------------

adminRouter.use('/', adminCatalogRouter);
adminRouter.use('/orders', adminOrderRouter);
adminRouter.use('/coupons', adminCouponRouter);
adminRouter.use('/support-tickets', adminSupportRouter);
adminRouter.use('/settlements', adminSettlementsRouter);
adminRouter.use('/incentives', adminIncentiveRouter);
