import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/customerAddressController';

export const customerAddressRouter = Router();
customerAddressRouter.use(authenticate, authorize('customer'));

const createAddressValidators = [
  body('label').optional().isIn(['home', 'work', 'other']),
  body('contactName').optional().isString().trim(),
  body('contactPhone').optional().isString().trim(),
  body('line1').isString().trim().notEmpty().withMessage('Address line 1 is required'),
  body('line2').optional().isString().trim(),
  body('landmark').optional().isString().trim(),
  body('city').isString().trim().notEmpty().withMessage('City is required'),
  body('state').isString().trim().notEmpty().withMessage('State is required'),
  body('pincode').isString().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Enter a valid 6-digit pincode'),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
  body('isDefault').optional().isBoolean(),
];

const updateAddressValidators = [
  body('label').optional().isIn(['home', 'work', 'other']),
  body('contactName').optional().isString().trim(),
  body('contactPhone').optional().isString().trim(),
  body('line1').optional().isString().trim().notEmpty().withMessage('Address line 1 cannot be empty'),
  body('line2').optional().isString().trim(),
  body('landmark').optional().isString().trim(),
  body('city').optional().isString().trim().notEmpty().withMessage('City cannot be empty'),
  body('state').optional().isString().trim().notEmpty().withMessage('State cannot be empty'),
  body('pincode').optional().isString().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Enter a valid 6-digit pincode'),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
  body('isDefault').optional().isBoolean(),
];

customerAddressRouter.get('/', asyncHandler(ctrl.listAddresses));
customerAddressRouter.post('/', ...createAddressValidators, handleValidation, asyncHandler(ctrl.createAddress));
customerAddressRouter.patch(
  '/:id',
  param('id').isString().notEmpty(),
  ...updateAddressValidators,
  handleValidation,
  asyncHandler(ctrl.updateAddress),
);
customerAddressRouter.delete('/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.deleteAddress));
customerAddressRouter.patch(
  '/:id/default',
  param('id').isString().notEmpty(),
  handleValidation,
  asyncHandler(ctrl.setDefaultAddress),
);
