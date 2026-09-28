import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/vendorOfferController';

export const vendorOfferRouter = Router();
vendorOfferRouter.use(authenticate, authorize('vendor'));

const offerFieldValidators = (mode: 'create' | 'update') => {
  const req = <T extends { optional: () => T }>(chain: T) => (mode === 'create' ? chain : chain.optional());
  return [
    req(body('title').isString().trim().notEmpty().withMessage('Offer title is required')),
    req(body('discountType').isIn(['percentage', 'flat'])),
    req(body('discountValue').isFloat({ min: 0 })),
    req(body('scope').isIn(['selected-products', 'entire-store'])),
    body('productIds').optional().isArray(),
    body('productIds.*').isMongoId().withMessage('Each productId must be a valid id'),
    body('categoryIds').optional().isArray(),
    body('categoryIds.*').isMongoId().withMessage('Each categoryId must be a valid id'),
    body('minOrderValueEnabled').optional().isBoolean(),
    body('minOrderValue').optional().isFloat({ min: 0 }),
    body('customerEligibility').optional().isIn(['all', 'new-only']),
    req(body('startDate').isISO8601()),
    req(body('endDate').isISO8601()),
  ];
};

vendorOfferRouter.get('/', asyncHandler(ctrl.listMyOffers));

vendorOfferRouter.post('/', ...offerFieldValidators('create'), handleValidation, asyncHandler(ctrl.createOffer));

vendorOfferRouter.get('/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.getMyOffer));

vendorOfferRouter.patch(
  '/:id',
  param('id').isMongoId(),
  ...offerFieldValidators('update'),
  handleValidation,
  asyncHandler(ctrl.updateOffer),
);

vendorOfferRouter.patch('/:id/pause', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.pauseOffer));

vendorOfferRouter.patch('/:id/resume', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.resumeOffer));

vendorOfferRouter.delete('/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.deleteOffer));
