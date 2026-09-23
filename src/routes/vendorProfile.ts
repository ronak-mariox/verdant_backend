import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/vendorProfileController';

export const vendorProfileRouter = Router();
vendorProfileRouter.use(authenticate, authorize('vendor'));

vendorProfileRouter.patch('/', asyncHandler(ctrl.updateProfile));
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
  param('addressId').isString().notEmpty(),
  body('lat').optional().isFloat(),
  body('lng').optional().isFloat(),
  handleValidation,
  asyncHandler(ctrl.updateAddress),
);
vendorProfileRouter.delete(
  '/addresses/:addressId',
  param('addressId').isString().notEmpty(),
  handleValidation,
  asyncHandler(ctrl.removeAddress),
);
vendorProfileRouter.patch(
  '/addresses/:addressId/primary',
  param('addressId').isString().notEmpty(),
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
  param('documentId').isString().notEmpty(),
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
