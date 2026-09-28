import { Router } from 'express';
import { body, param } from 'express-validator';
import { normalizePhone } from '../lib/json';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/vendorProfileController';

export const vendorProfileRouter = Router();
vendorProfileRouter.use(authenticate, authorize('vendor'));

const LOCKED_PROFILE_FIELDS = ['panDetails', 'gstDetails', 'businessProof', 'bankDetails', 'businessType'];

vendorProfileRouter.patch(
  '/',
  ...LOCKED_PROFILE_FIELDS.map((field) =>
    body(field).not().exists().withMessage(`${field} cannot be edited here — use the document replace / bank details request flow`),
  ),
  body('ownerInfo').optional().isObject(),
  body('ownerInfo.fullName').optional().isString().trim().isLength({ min: 2, max: 80 }),
  body('ownerInfo.email').optional().isEmail().normalizeEmail(),
  body('ownerInfo.mobile').optional().customSanitizer(normalizePhone).isLength({ min: 10, max: 10 }).withMessage('Enter a valid 10-digit mobile number'),
  body('businessInfo').optional().isObject(),
  body('businessInfo.businessName').optional().isString().trim().notEmpty(),
  body('businessInfo.displayName').optional().isString().trim().notEmpty(),
  body('businessInfo.category').optional().isString().trim().notEmpty(),
  body('businessInfo.addressLine1').optional().isString().trim().notEmpty(),
  body('businessInfo.addressLine2').optional({ values: 'null' }).isString().trim(),
  body('businessInfo.city').optional().isString().trim().notEmpty(),
  body('businessInfo.state').optional().isString().trim().notEmpty(),
  body('businessInfo.pincode').optional().isString().isLength({ min: 6, max: 6 }).isNumeric(),
  body('businessInfo.country').optional().isString().trim().notEmpty(),
  body('storeInfo').optional().isObject(),
  body('storeInfo.storeName').optional().isString().trim().notEmpty(),
  body('storeInfo.storeAddress').optional().isString().trim().notEmpty(),
  body('storeInfo.landmark').optional({ values: 'null' }).isString().trim(),
  body('storeInfo.contactNumber').optional().isString().trim().notEmpty(),
  body('storeInfo.storeType').optional().isString().trim().notEmpty(),
  body('storeInfo.operatingHours').optional().isString().trim().notEmpty(),
  body('storeInfo.location').optional().isObject(),
  body('storeInfo.location.latitude').optional().isFloat(),
  body('storeInfo.location.longitude').optional().isFloat(),
  body('storeProfile').optional().isObject(),
  body('storeProfile.storeName').optional().isString().trim().notEmpty(),
  body('storeProfile.description').optional().isString().trim().isLength({ max: 250 }),
  body('storeProfile.tags').optional().isArray(),
  body('storeProfile.tags.*').isString().trim().notEmpty(),
  handleValidation,
  asyncHandler(ctrl.updateProfile),
);
vendorProfileRouter.get('/stats', asyncHandler(ctrl.getStats));

vendorProfileRouter.get('/addresses', asyncHandler(ctrl.listAddresses));
vendorProfileRouter.post(
  '/addresses',
  body('label').isString().trim().notEmpty(),
  body('line1').isString().trim().notEmpty(),
  body('line2').optional().isString().trim(),
  body('lat').optional().isFloat(),
  body('lng').optional().isFloat(),
  handleValidation,
  asyncHandler(ctrl.addAddress),
);
vendorProfileRouter.patch(
  '/addresses/:addressId',
  param('addressId').isMongoId(),
  body('lat').optional().isFloat(),
  body('lng').optional().isFloat(),
  handleValidation,
  asyncHandler(ctrl.updateAddress),
);
vendorProfileRouter.delete(
  '/addresses/:addressId',
  param('addressId').isMongoId(),
  handleValidation,
  asyncHandler(ctrl.removeAddress),
);
vendorProfileRouter.patch(
  '/addresses/:addressId/primary',
  param('addressId').isMongoId(),
  handleValidation,
  asyncHandler(ctrl.setPrimaryAddress),
);

vendorProfileRouter.patch(
  '/documents/:stepKey/replace',
  param('stepKey').isString().notEmpty(),
  body('url').isString().trim().notEmpty(),
  handleValidation,
  asyncHandler(ctrl.replaceDocument),
);

vendorProfileRouter.get('/notification-prefs', asyncHandler(ctrl.getNotificationPrefs));
vendorProfileRouter.patch('/notification-prefs', asyncHandler(ctrl.updateNotificationPrefs));

vendorProfileRouter.get('/documents/additional', asyncHandler(ctrl.listAdditionalDocuments));
vendorProfileRouter.post(
  '/documents/additional',
  body('name').isString().trim().notEmpty(),
  body('url').isString().trim().notEmpty(),
  handleValidation,
  asyncHandler(ctrl.addAdditionalDocument),
);
vendorProfileRouter.delete(
  '/documents/additional/:documentId',
  param('documentId').isMongoId(),
  handleValidation,
  asyncHandler(ctrl.removeAdditionalDocument),
);

vendorProfileRouter.get(
  '/bank-details/request',
  asyncHandler(ctrl.getBankDetailsRequestStatus),
);
vendorProfileRouter.post(
  '/bank-details/request',
  body('accountHolderName').isString().trim().notEmpty(),
  body('accountNumber').isString().trim().notEmpty(),
  body('ifsc').isString().trim().notEmpty(),
  body('bankName').optional().isString().trim(),
  body('branch').optional().isString().trim(),
  body('accountType').isString().trim().notEmpty(),
  body('upiId').optional().isString().trim(),
  handleValidation,
  asyncHandler(ctrl.requestBankDetailsChange),
);

vendorProfileRouter.get('/settlements', asyncHandler(ctrl.getSettlements));

vendorProfileRouter.get('/payments/batches', asyncHandler(ctrl.getPayoutBatches));
vendorProfileRouter.get(
  '/payments/batches/:id',
  param('id').isMongoId(),
  handleValidation,
  asyncHandler(ctrl.getPayoutBatch),
);
