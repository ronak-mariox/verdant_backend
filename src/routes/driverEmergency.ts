import { Router } from 'express';
import { body, param } from 'express-validator';
import { handleValidation } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/driverEmergencyController';

export const driverEmergencyRouter = Router();
driverEmergencyRouter.use(authenticate, authorize('driver'));

const INCIDENT_TYPES = ['accident', 'medical', 'harassment', 'theft', 'vehicle_breakdown', 'other'];

driverEmergencyRouter.post(
  '/activate',
  body('type').isIn(INCIDENT_TYPES),
  body('orderId').optional({ values: 'falsy' }).isMongoId(),
  body('description').optional().isString().trim(),
  body('medicalNeeded').optional().isBoolean(),
  body('lat').optional().isFloat(),
  body('lng').optional().isFloat(),
  handleValidation,
  asyncHandler(ctrl.activate),
);

driverEmergencyRouter.post(
  '/incidents',
  body('type').isIn(INCIDENT_TYPES),
  body('orderId').optional({ values: 'falsy' }).isMongoId(),
  body('description').optional().isString().trim(),
  body('medicalNeeded').optional().isBoolean(),
  body('evidenceUrls').optional().isArray(),
  body('evidenceUrls.*').isString().trim().notEmpty(),
  body('lat').optional().isFloat(),
  body('lng').optional().isFloat(),
  handleValidation,
  asyncHandler(ctrl.reportIncident),
);

driverEmergencyRouter.get(
  '/incidents/:id',
  param('id').isMongoId(),
  handleValidation,
  asyncHandler(ctrl.getIncidentById),
);

driverEmergencyRouter.post(
  '/share-location',
  body('lat').isFloat(),
  body('lng').isFloat(),
  body('accuracy').optional().isFloat(),
  body('orderId').optional({ values: 'falsy' }).isMongoId(),
  body('incidentId').optional({ values: 'falsy' }).isMongoId(),
  handleValidation,
  asyncHandler(ctrl.shareLocation),
);

driverEmergencyRouter.post('/stop-sharing', asyncHandler(ctrl.stopSharing));

driverEmergencyRouter.post(
  '/support-contact',
  body('message').isString().trim().notEmpty(),
  body('orderId').optional({ values: 'falsy' }).isMongoId(),
  handleValidation,
  asyncHandler(ctrl.contactSupport),
);
