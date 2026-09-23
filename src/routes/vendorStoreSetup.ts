import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { upload } from '../lib/upload';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/vendorStoreSetupController';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const vendorStoreSetupRouter = Router();
vendorStoreSetupRouter.use(authenticate, authorize('vendor'));

vendorStoreSetupRouter.patch(
  '/profile',
  body('storeName').isString().trim().notEmpty().withMessage('Store name is required'),
  body('description').isString().trim().isLength({ min: 1, max: 250 }).withMessage('Store description is required (max 250 characters)'),
  body('primaryCategory').isString().trim().notEmpty().withMessage('Primary category is required'),
  body('subCategory').isString().trim().notEmpty().withMessage('Sub-category is required'),
  body('tags').isArray({ min: 1 }).withMessage('At least one tag is required'),
  body('tags.*').isString().trim().notEmpty(),
  body('minimumOrderValue').isString().trim().notEmpty().withMessage('Minimum order value is required'),
  body('avgPrepTime').isString().trim().notEmpty().withMessage('Average prep time is required'),
  handleValidation,
  asyncHandler(ctrl.saveProfile),
);

vendorStoreSetupRouter.post('/logo', upload.single('file'), asyncHandler(ctrl.uploadLogo));
vendorStoreSetupRouter.post('/cover-image', upload.single('file'), asyncHandler(ctrl.uploadCoverImage));

vendorStoreSetupRouter.patch(
  '/address',
  body('buildingShopNo').isString().trim().notEmpty().withMessage('Building/Shop No. is required'),
  body('street').isString().trim().notEmpty().withMessage('Street is required'),
  body('landmark').isString().trim().notEmpty().withMessage('Landmark is required'),
  body('area').isString().trim().notEmpty().withMessage('Area/Locality is required'),
  body('pincode').isString().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Enter a valid 6-digit pincode'),
  body('city').isString().trim().notEmpty().withMessage('City is required'),
  body('state').isString().trim().notEmpty().withMessage('State is required'),
  body('contactNumber').isString().trim().notEmpty().withMessage('Store contact number is required'),
  body('sameAsBusinessAddress').isBoolean().withMessage('sameAsBusinessAddress must be true or false'),
  body('location.address').isString().trim().notEmpty().withMessage('Location address is required'),
  body('location.cityState').isString().trim().notEmpty().withMessage('Location city/state is required'),
  body('location.latitude').isFloat().withMessage('Location latitude is required'),
  body('location.longitude').isFloat().withMessage('Location longitude is required'),
  handleValidation,
  asyncHandler(ctrl.saveAddress),
);

vendorStoreSetupRouter.patch(
  '/hours',
  body('sameEveryDay').isBoolean().withMessage('sameEveryDay must be true or false'),
  body('defaultOpen').isString().trim().notEmpty().withMessage('Default opening time is required'),
  body('defaultClose').isString().trim().notEmpty().withMessage('Default closing time is required'),
  body('breakEnabled').isBoolean().withMessage('breakEnabled must be true or false'),
  body('weeklySchedule').isArray({ min: 7, max: 7 }).withMessage('weeklySchedule must cover all 7 days'),
  body('weeklySchedule.*.day').isIn(DAY_NAMES).withMessage('Invalid day name'),
  body('weeklySchedule.*.open').isString().trim().notEmpty().withMessage('Opening time is required for every day'),
  body('weeklySchedule.*.close').isString().trim().notEmpty().withMessage('Closing time is required for every day'),
  body('weeklySchedule.*.isOpen').isBoolean().withMessage('isOpen must be true or false for every day'),
  handleValidation,
  asyncHandler(ctrl.saveHours),
);

// Holidays are a genuinely optional list (a store may have zero planned
// closures) — added/removed one at a time; every field on an added holiday
// is still required.
vendorStoreSetupRouter.post(
  '/holidays',
  body('title').isString().trim().notEmpty().withMessage('Holiday title is required'),
  body('date').isString().trim().notEmpty().withMessage('Holiday date is required'),
  body('daysClosed').isInt({ min: 1 }).withMessage('Days closed must be at least 1'),
  body('note').isString().trim().notEmpty().withMessage('A note is required'),
  handleValidation,
  asyncHandler(ctrl.addHoliday),
);

vendorStoreSetupRouter.patch(
  '/holidays/:id',
  param('id').isString().notEmpty(),
  body('title').isString().trim().notEmpty().withMessage('Holiday title is required'),
  body('date').isString().trim().notEmpty().withMessage('Holiday date is required'),
  body('daysClosed').isInt({ min: 1 }).withMessage('Days closed must be at least 1'),
  body('note').isString().trim().notEmpty().withMessage('A note is required'),
  handleValidation,
  asyncHandler(ctrl.updateHoliday),
);

vendorStoreSetupRouter.delete(
  '/holidays/:id',
  param('id').isString().notEmpty(),
  handleValidation,
  asyncHandler(ctrl.removeHoliday),
);

vendorStoreSetupRouter.patch(
  '/delivery',
  body('fulfillmentType').isIn(['delivery', 'pickup', 'both']).withMessage('Select a valid fulfillment type'),
  body('deliveryRadiusKm').isFloat({ gt: 0 }).withMessage('Delivery radius is required'),
  body('minimumOrderForDelivery').isString().trim().notEmpty().withMessage('Minimum order for delivery is required'),
  body('chargeType').isString().trim().notEmpty().withMessage('Charge type is required'),
  body('slabs').isArray({ min: 1 }).withMessage('At least one delivery slab is required'),
  body('slabs.*.range').isString().trim().notEmpty().withMessage('Every slab needs a range'),
  body('slabs.*.charge').isString().trim().notEmpty().withMessage('Every slab needs a charge'),
  body('freeDeliveryAbove').isString().trim().notEmpty().withMessage('Free delivery threshold is required'),
  handleValidation,
  asyncHandler(ctrl.saveDelivery),
);

vendorStoreSetupRouter.patch(
  '/availability',
  body('slotsEnabled').isBoolean().withMessage('slotsEnabled must be true or false'),
  body('slots').isArray({ min: 1 }).withMessage('At least one delivery slot is required'),
  body('slots.*.label').isString().trim().notEmpty().withMessage('Every slot needs a label'),
  body('slots.*.window').isString().trim().notEmpty().withMessage('Every slot needs a time window'),
  body('slots.*.totalSlots').isInt({ min: 1 }).withMessage('Every slot needs a total capacity'),
  body('slots.*.usedSlots').isInt({ min: 0 }).withMessage('Every slot needs a used count'),
  body('maxSimultaneousOrders').isString().trim().notEmpty().withMessage('Max simultaneous orders is required'),
  body('autoPauseAtCapacity').isBoolean().withMessage('autoPauseAtCapacity must be true or false'),
  handleValidation,
  asyncHandler(ctrl.saveAvailability),
);

vendorStoreSetupRouter.patch(
  '/status',
  body('storeStatus').isIn(['open', 'closed']).withMessage('storeStatus must be "open" or "closed" (use /temp-closure for a temporary closure)'),
  handleValidation,
  asyncHandler(ctrl.saveStatus),
);

vendorStoreSetupRouter.patch(
  '/temp-closure',
  body('reason').isString().trim().notEmpty().withMessage('Reason for closure is required'),
  body('customMessage').isString().trim().notEmpty().withMessage('A customer-facing message is required'),
  body('fromDate').isString().trim().notEmpty().withMessage('Closure start date is required'),
  body('toDate').isString().trim().notEmpty().withMessage('Closure end date is required'),
  body('closeFromTime').isString().trim().notEmpty().withMessage('Close-from time is required'),
  body('reopenAt').isString().trim().notEmpty().withMessage('Reopen time is required'),
  body('notifyCustomers').isBoolean().withMessage('notifyCustomers must be true or false'),
  handleValidation,
  asyncHandler(ctrl.saveTempClosure),
);

vendorStoreSetupRouter.get('/', asyncHandler(ctrl.getStoreSetup));
vendorStoreSetupRouter.get('/status', asyncHandler(ctrl.getStoreSetupStatus));
vendorStoreSetupRouter.post('/complete', asyncHandler(ctrl.complete));
