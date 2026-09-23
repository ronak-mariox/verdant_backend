import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/vendorOfferController';

export const vendorOfferRouter = Router();
vendorOfferRouter.use(authenticate, authorize('vendor'));

vendorOfferRouter.get('/', asyncHandler(ctrl.listMyOffers));

vendorOfferRouter.post(
  '/',
  body('title').isString().trim().notEmpty().withMessage('Offer title is required'),
  body('discountType').isIn(['percentage', 'flat']),
  body('discountValue').isFloat({ min: 0 }),
  body('scope').isIn(['selected-products', 'entire-store']),
  body('categoryIds').optional().isArray(),
  body('minOrderValueEnabled').optional().isBoolean(),
  body('minOrderValue').optional().isFloat({ min: 0 }),
  body('customerEligibility').optional().isIn(['all', 'new-only']),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  handleValidation,
  asyncHandler(ctrl.createOffer),
);

vendorOfferRouter.get('/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.getMyOffer));

vendorOfferRouter.patch('/:id/pause', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.pauseOffer));

vendorOfferRouter.patch('/:id/resume', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.resumeOffer));

vendorOfferRouter.delete('/:id', param('id').isString().notEmpty(), handleValidation, asyncHandler(ctrl.deleteOffer));
