import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { normalizePhone } from '../lib/json';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { upload } from '../lib/upload';
import { asyncHandler } from '../utils/asyncHandler';
import { env } from '../lib/env';
import * as driverController from '../controllers/driverController';
import { driverOrderRouter } from './driverOrders';
import { driverEarningsRouter } from './driverEarnings';
import { driverIncentiveRouter } from './driverIncentives';
import { driverPerformanceRouter } from './driverPerformance';
import { driverNotificationRouter } from './driverNotifications';
import { driverEmergencyRouter } from './driverEmergency';

export const driverRouter = Router();

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

// Lets the client say whether this OTP verification is a login attempt or part of the
// registration flow. Defaults to 'register' when omitted, matching the historical
// behaviour of always auto-creating a driver on first verify.
const intentValidator = body('intent').optional().isIn(['login', 'register']).withMessage('Invalid intent');

driverRouter.post(
  '/auth/otp/request',
  otpRequestLimiter,
  phoneValidator,
  handleValidation,
  asyncHandler(driverController.requestOtp),
);

driverRouter.post(
  '/auth/otp/verify',
  phoneValidator,
  otpValidator,
  intentValidator,
  handleValidation,
  asyncHandler(driverController.verifyOtp),
);

driverRouter.get('/me', authenticate, authorize('driver'), asyncHandler(driverController.getMe));

driverRouter.post(
  '/me/avatar',
  authenticate,
  authorize('driver'),
  upload.single('avatar'),
  asyncHandler(driverController.uploadAvatar),
);

driverRouter.patch(
  '/status',
  authenticate,
  authorize('driver'),
  body('isOnline').isBoolean(),
  body('lat').optional().isFloat(),
  body('lng').optional().isFloat(),
  handleValidation,
  asyncHandler(driverController.updateStatus),
);

driverRouter.get('/home-summary', authenticate, authorize('driver'), asyncHandler(driverController.getHomeSummary));

// ---------------------------------------------------------------------------
// Multi-step registration — mirrors DeliveryApp's Registration wizard.
// ---------------------------------------------------------------------------

const registrationRouter = Router();
registrationRouter.use(authenticate, authorize('driver'));

registrationRouter.patch(
  '/personal-info',
  body('fullName').isString().trim().isLength({ min: 2, max: 80 }),
  body('email').isEmail().normalizeEmail(),
  body('dob').isISO8601().withMessage('dob must be an ISO date (YYYY-MM-DD)'),
  body('gender').isIn(['female', 'male', 'other']),
  handleValidation,
  asyncHandler(driverController.savePersonalInfo),
);

registrationRouter.patch(
  '/address',
  body('line1').isString().trim().notEmpty(),
  body('area').isString().trim().notEmpty(),
  body('city').isString().trim().notEmpty(),
  body('state').isString().trim().notEmpty(),
  body('pincode').isString().isLength({ min: 6, max: 6 }).isNumeric(),
  body('addressType').isIn(['home', 'work', 'other']),
  handleValidation,
  asyncHandler(driverController.saveAddress),
);

registrationRouter.patch(
  '/emergency-contact',
  body('name').isString().trim().notEmpty(),
  body('relationship').isString().trim().notEmpty(),
  body('mobile').customSanitizer(normalizePhone).isLength({ min: 10, max: 10 }),
  body('altMobile').optional({ values: 'falsy' }).customSanitizer(normalizePhone).isLength({ min: 10, max: 10 }),
  handleValidation,
  asyncHandler(driverController.saveEmergencyContact),
);

registrationRouter.patch(
  '/vehicle-type',
  body('vehicleType').isIn(['motorbike', 'scooter', 'bicycle', 'other']),
  handleValidation,
  asyncHandler(driverController.saveVehicleType),
);

registrationRouter.patch(
  '/vehicle-details',
  body('registrationNumber').isString().trim().notEmpty(),
  body('brand').isString().trim().notEmpty(),
  body('model').isString().trim().notEmpty(),
  body('year').isInt({ min: 1990, max: new Date().getFullYear() + 1 }),
  body('fuelType').isString().trim().notEmpty(),
  body('color').isString().trim().notEmpty(),
  body('capacity').optional({ values: 'falsy' }).isString(),
  handleValidation,
  asyncHandler(driverController.saveVehicleDetails),
);

const DOC_TYPES = ['license_front', 'license_back', 'rc', 'insurance'] as const;

registrationRouter.post(
  '/documents',
  upload.single('file'),
  body('type').isIn(DOC_TYPES),
  handleValidation,
  asyncHandler(driverController.uploadDocument),
);

registrationRouter.patch(
  '/insurance-details',
  body('insuranceType').isString().trim().notEmpty(),
  body('policyNumber').isString().trim().notEmpty(),
  body('validFrom').isISO8601(),
  body('validUntil').isISO8601(),
  handleValidation,
  asyncHandler(driverController.saveInsuranceDetails),
);

registrationRouter.patch(
  '/bank-details',
  body('accountHolderName').isString().trim().notEmpty(),
  body('accountNumber').isString().trim().isLength({ min: 6, max: 20 }),
  body('confirmAccountNumber').custom((v, { req }) => v === req.body.accountNumber).withMessage('Account numbers do not match'),
  body('ifsc')
    .isString()
    .matches(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .withMessage('Enter a valid IFSC code'),
  body('upiId').optional({ values: 'falsy' }).isString(),
  handleValidation,
  asyncHandler(driverController.saveBankDetails),
);

registrationRouter.get('/', asyncHandler(driverController.getRegistration));
registrationRouter.get('/status', asyncHandler(driverController.getStatus));
registrationRouter.post('/submit', asyncHandler(driverController.submit));

driverRouter.use('/registration', registrationRouter);
driverRouter.use('/orders', driverOrderRouter);
driverRouter.use('/earnings', driverEarningsRouter);
driverRouter.use('/incentives', driverIncentiveRouter);
driverRouter.use('/performance', driverPerformanceRouter);
driverRouter.use('/notifications', driverNotificationRouter);
driverRouter.use('/emergency', driverEmergencyRouter);
