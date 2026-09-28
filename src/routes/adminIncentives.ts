import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/adminIncentiveController';

export const adminIncentiveRouter = Router();
adminIncentiveRouter.use(authenticate, authorize('admin'));

const incentiveFieldValidators = (mode: 'create' | 'update') => {
  const req = <T extends { optional: () => T }>(chain: T) => (mode === 'create' ? chain : chain.optional());
  return [
    req(body('title').isString().trim().notEmpty().withMessage('Title is required')),
    req(body('description').isString().trim().notEmpty().withMessage('Description is required')),
    req(body('rewardAmount').isFloat({ gt: 0 }).withMessage('Reward amount must be greater than 0')),
    req(body('targetDeliveries').isInt({ min: 1 }).withMessage('Target deliveries must be at least 1')),
    req(body('startAt').isISO8601()),
    req(body('expiresAt').isISO8601()),
    body('status').optional().isIn(['active', 'expired']),
    body('conditions').optional().isArray(),
    body('conditions.*.label').isString().trim().notEmpty(),
    body('conditions.*.type').isString().trim().notEmpty(),
    body('conditions.*.threshold').isFloat({ min: 0 }),
  ];
};

adminIncentiveRouter.get('/', query('status').optional().isIn(['active', 'expired']), handleValidation, asyncHandler(ctrl.listIncentives));
adminIncentiveRouter.post('/', ...incentiveFieldValidators('create'), handleValidation, asyncHandler(ctrl.createIncentive));
adminIncentiveRouter.patch('/:id', param('id').isMongoId(), ...incentiveFieldValidators('update'), handleValidation, asyncHandler(ctrl.updateIncentive));
adminIncentiveRouter.delete('/:id', param('id').isMongoId(), handleValidation, asyncHandler(ctrl.deleteIncentive));
