import { Router } from 'express';
import { body } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { upload } from '../lib/upload';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/vendorRegistrationController';

export const vendorRegistrationRouter = Router();
vendorRegistrationRouter.use(authenticate, authorize('vendor'));

vendorRegistrationRouter.patch(
  '/business-type',
  body('businessType')
    .isIn(['individual', 'proprietorship', 'partnership', 'private-limited', 'other'])
    .withMessage('Select a valid business type'),
  handleValidation,
  asyncHandler(ctrl.saveBusinessType),
);

vendorRegistrationRouter.patch(
  '/business-info',
  body('legalName').isString().trim().notEmpty().withMessage('Legal name is required'),
  body('displayName').isString().trim().notEmpty().withMessage('Display name is required'),
  body('category').isString().trim().notEmpty().withMessage('Business category is required'),
  body('addressLine1').isString().trim().notEmpty().withMessage('Address line 1 is required'),
  body('addressLine2').optional({ checkFalsy: true }).isString().trim(),
  body('city').isString().trim().notEmpty().withMessage('City is required'),
  body('state').isString().trim().notEmpty().withMessage('State is required'),
  body('pincode').isString().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Enter a valid 6-digit pincode'),
  body('country').isString().trim().notEmpty().withMessage('Country is required'),
  handleValidation,
  asyncHandler(ctrl.saveBusinessInfo),
);

vendorRegistrationRouter.patch(
  '/owner-info',
  body('fullName').isString().trim().notEmpty().withMessage('Full name is required'),
  body('mobile').isString().trim().notEmpty().withMessage('Mobile number is required'),
  body('email').isEmail().withMessage('Enter a valid email').normalizeEmail(),
  body('dob').isISO8601().withMessage('Date of birth must be a valid date (YYYY-MM-DD)'),
  body('pan')
    .isString()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .withMessage('Enter a valid PAN (e.g. ABCDE1234F)'),
  handleValidation,
  asyncHandler(ctrl.saveOwnerInfo),
);

vendorRegistrationRouter.patch(
  '/store-info',
  body('storeName').isString().trim().notEmpty().withMessage('Store name is required'),
  body('storeAddress').isString().trim().notEmpty().withMessage('Store address is required'),
  body('landmark').isString().trim().notEmpty().withMessage('Landmark is required'),
  body('contactNumber').isString().trim().notEmpty().withMessage('Contact number is required'),
  body('storeType').isString().trim().notEmpty().withMessage('Store type is required'),
  body('operatingHours').isString().trim().notEmpty().withMessage('Operating hours are required'),
  body('location.address').isString().trim().notEmpty().withMessage('Store location address is required'),
  body('location.cityState').isString().trim().notEmpty().withMessage('Store location city/state is required'),
  body('location.latitude').isFloat().withMessage('Store location latitude is required'),
  body('location.longitude').isFloat().withMessage('Store location longitude is required'),
  handleValidation,
  asyncHandler(ctrl.saveStoreInfo),
);

// GST details are conditionally required — an unregistered business has no
// GST paperwork to submit, matching GSTDetailsScreen's own toggle.
vendorRegistrationRouter.patch(
  '/gst-details',
  body('registered').isBoolean().withMessage('registered must be true or false'),
  body('gstin')
    .if((_v, { req }) => req.body.registered === true)
    .matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/)
    .withMessage('Enter a valid GSTIN'),
  body('businessName')
    .if((_v, { req }) => req.body.registered === true)
    .isString()
    .trim()
    .notEmpty()
    .withMessage('GST-registered business name is required'),
  body('registrationDate')
    .if((_v, { req }) => req.body.registered === true)
    .isISO8601()
    .withMessage('GST registration date is required'),
  body('category')
    .if((_v, { req }) => req.body.registered === true)
    .isString()
    .trim()
    .notEmpty()
    .withMessage('GST category is required'),
  body('certificateUrl')
    .if((_v, { req }) => req.body.registered === true)
    .isString()
    .trim()
    .notEmpty()
    .withMessage('GST certificate upload is required'),
  handleValidation,
  asyncHandler(ctrl.saveGstDetails),
);

vendorRegistrationRouter.patch(
  '/pan-details',
  body('panNumber')
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .withMessage('Enter a valid PAN'),
  body('holderName').isString().trim().notEmpty().withMessage('PAN holder name is required'),
  body('dob').isISO8601().withMessage('Date of birth is required'),
  body('panType').isString().trim().notEmpty().withMessage('PAN type is required'),
  body('documentUrl').isString().trim().notEmpty().withMessage('PAN card document upload is required'),
  handleValidation,
  asyncHandler(ctrl.savePanDetails),
);

// backUrl and expiryDate are optional — some business proofs (e.g. shop
// registration) never expire, and the back-side upload is labelled optional.
vendorRegistrationRouter.patch(
  '/business-proof',
  body('documentType').isString().trim().notEmpty().withMessage('Document type is required'),
  body('documentNumber').isString().trim().notEmpty().withMessage('Document number is required'),
  body('issueDate').isISO8601().withMessage('Issue date is required'),
  body('expiryDate').optional({ values: 'falsy' }).isISO8601().withMessage('Expiry date must be a valid date'),
  body('frontUrl').isString().trim().notEmpty().withMessage('Front-side document upload is required'),
  body('backUrl').optional({ values: 'falsy' }).isString(),
  handleValidation,
  asyncHandler(ctrl.saveBusinessProof),
);

// upiId is intentionally optional — BankDetailsScreen's own UI marks it
// optional; bankName/branch are always populated by the app's IFSC lookup.
vendorRegistrationRouter.patch(
  '/bank-details',
  body('accountHolderName').isString().trim().notEmpty().withMessage('Account holder name is required'),
  body('accountNumber').isString().trim().isLength({ min: 6, max: 20 }).withMessage('Enter a valid account number'),
  body('confirmAccountNumber')
    .custom((v, { req }) => v === req.body.accountNumber)
    .withMessage('Account numbers do not match'),
  body('ifsc')
    .isString()
    .matches(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .withMessage('Enter a valid IFSC code'),
  body('bankName').isString().trim().notEmpty().withMessage('Bank name is required'),
  body('branch').isString().trim().notEmpty().withMessage('Branch is required'),
  body('accountType').isString().trim().notEmpty().withMessage('Account type is required'),
  body('upiId').optional({ values: 'falsy' }).isString(),
  handleValidation,
  asyncHandler(ctrl.saveBankDetails),
);

vendorRegistrationRouter.post('/documents', upload.single('file'), asyncHandler(ctrl.uploadDocument));

vendorRegistrationRouter.get('/', asyncHandler(ctrl.getRegistration));
vendorRegistrationRouter.get('/status', asyncHandler(ctrl.getStatus));
vendorRegistrationRouter.post('/submit', asyncHandler(ctrl.submit));
