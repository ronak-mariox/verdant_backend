import type { Request, Response } from 'express';
import { Types, type HydratedDocument } from 'mongoose';
import { Driver, DRIVER_REVIEW_KEYS, DRIVER_REVIEW_LABELS, type DriverDoc, type DriverReviewKey } from '../models/Driver';
import { Order } from '../models/Order';
import { EarningsLedger } from '../models/EarningsLedger';
import { createOtp, verifyOtp as verifyOtpCode } from '../lib/otp';
import { issueTokenPair } from '../lib/tokens';
import { toSafeJson } from '../lib/sanitize';
import { publicUrlFor } from '../lib/upload';
import { HttpError } from '../lib/httpError';
import { restrictedBody } from '../lib/accountStatus';

export async function requestOtp(req: Request, res: Response) {
  const { devOtp } = await createOtp(req.body.phone, 'driver');
  res.json({ message: 'OTP sent', ...(devOtp && { devOtp }) });
}

export async function verifyOtp(req: Request, res: Response) {
  const phone = req.body.phone as string;
  // 'login' means the client is on the sign-in flow and expects an existing account —
  // don't silently auto-register a stranger's number just because they tapped "Send OTP"
  // on the login screen. 'register' (the default, for backward compatibility with the
  // registration flow) keeps the historical auto-create-on-first-verify behaviour.
  const intent = req.body.intent === 'login' ? 'login' : 'register';
  const result = await verifyOtpCode(phone, 'driver', req.body.otp);
  if (!result.ok) {
    res.status(400).json({ error: 'Incorrect or expired OTP', reason: result.reason });
    return;
  }

  let driver = await Driver.findOne({ phone });

  if (!driver && intent === 'login') {
    res.status(404).json({ error: 'No rider account found for this number. Please register first.', reason: 'account_not_found' });
    return;
  }

  const isNewDriver = !driver;
  driver ??= await Driver.create({ phone });

  if (driver.status === 'suspended') {
    res.status(403).json(restrictedBody('driver', driver.status));
    return;
  }

  const tokens = await issueTokenPair(String(driver._id), 'driver');
  res.json({ ...tokens, isNewDriver, driver: toSafeJson(driver) });
}

export async function getMe(req: Request, res: Response) {
  const driver = await Driver.findById(req.user!.id);
  if (!driver) throw new HttpError(404, 'Driver not found');
  res.json(toSafeJson(driver));
}

export async function uploadAvatar(req: Request, res: Response) {
  if (!req.file) throw new HttpError(400, 'No file uploaded — field name must be "avatar"');
  const avatarUrl = publicUrlFor(req.file.filename);
  await Driver.findByIdAndUpdate(req.user!.id, { $set: { avatarUrl }, $unset: { 'reviews.profile_photo': '' } });
  res.json({ avatarUrl });
}

async function loadDriverOrThrow(driverId: string) {
  const driver = await Driver.findById(driverId);
  if (!driver) throw new HttpError(404, 'Driver not found');
  return driver;
}

export async function updateStatus(req: Request, res: Response) {
  const { isOnline, lat, lng } = req.body as { isOnline: boolean; lat?: number; lng?: number };
  if (isOnline) {
    const current = await loadDriverOrThrow(req.user!.id);
    if (current.status !== 'active') {
      throw new HttpError(403, 'Your account must be approved before you can go online', { reason: 'account_not_active' });
    }
  }
  const update: Record<string, unknown> = { isOnline };
  if (lat != null && lng != null) {
    update.currentLocation = { lat, lng, updatedAt: new Date() };
  }
  const driver = await Driver.findByIdAndUpdate(req.user!.id, { $set: update }, { new: true });
  if (!driver) throw new HttpError(404, 'Driver not found');
  res.json({ isOnline: driver.isOnline, currentLocation: driver.currentLocation ?? null });
}

export async function updateLocation(req: Request, res: Response) {
  const { lat, lng } = req.body as { lat: number; lng: number };
  const currentLocation = { lat, lng, updatedAt: new Date() };
  const driver = await Driver.findByIdAndUpdate(req.user!.id, { $set: { currentLocation } }, { new: true });
  if (!driver) throw new HttpError(404, 'Driver not found');
  res.json({ isOnline: driver.isOnline, currentLocation: driver.currentLocation });
}

export async function getHomeSummary(req: Request, res: Response) {
  const driverId = req.user!.id;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [todayLedger, todayDeliveries, activeOrder] = await Promise.all([
    EarningsLedger.aggregate([
      { $match: { driverId: new Types.ObjectId(driverId), createdAt: { $gte: startOfToday } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Order.countDocuments({ driverId, status: 'delivered', deliveredAt: { $gte: startOfToday } }),
    Order.findOne({ driverId, status: { $in: ['ready_for_pickup', 'out_for_delivery'] } }),
  ]);

  res.json({
    todayEarnings: todayLedger[0]?.total ?? 0,
    todayDeliveries,
    activeOrderId: activeOrder ? String(activeOrder._id) : null,
  });
}

// ---------------------------------------------------------------------------
// Multi-step registration
// ---------------------------------------------------------------------------

type StepKey =
  | 'personal-info'
  | 'address'
  | 'emergency-contact'
  | 'vehicle-type'
  | 'vehicle-details'
  | 'documents'
  | 'insurance-details'
  | 'bank-details';

const REQUIRED_DOCUMENTS = ['license_front', 'license_back', 'rc', 'insurance'] as const;

const STEP_ORDER: { key: StepKey; isDone: (d: DriverDoc) => boolean }[] = [
  { key: 'personal-info', isDone: (d) => Boolean(d.fullName && d.dob) },
  { key: 'address', isDone: (d) => Boolean(d.address) },
  { key: 'emergency-contact', isDone: (d) => Boolean(d.emergencyContact) },
  { key: 'vehicle-type', isDone: (d) => Boolean(d.vehicleType) },
  { key: 'vehicle-details', isDone: (d) => Boolean(d.vehicleDetails) },
  { key: 'documents', isDone: (d) => REQUIRED_DOCUMENTS.every((doc) => Boolean(d.documents?.[doc])) },
  { key: 'insurance-details', isDone: (d) => Boolean(d.insuranceDetails) },
  { key: 'bank-details', isDone: (d) => Boolean(d.bankDetails) },
];

function nextStepFor(driver: DriverDoc): StepKey | 'submit' | null {
  if (driver.registrationStep === 'submitted') return null;
  return STEP_ORDER.find((s) => !s.isDone(driver))?.key ?? 'submit';
}

/** Once submitted (or approved) the KYC data is frozen — only a rejected driver
 * may edit and resubmit. */
function assertRegistrationEditable(driver: DriverDoc) {
  if (driver.status === 'rejected') return;
  if (driver.registrationStep === 'submitted' || driver.status === 'active') {
    throw new HttpError(409, 'Registration has already been submitted and can no longer be edited', {
      reason: 'registration_locked',
    });
  }
}

async function loadEditableDriver(driverId: string): Promise<HydratedDocument<DriverDoc>> {
  const driver = await loadDriverOrThrow(driverId);
  assertRegistrationEditable(driver);
  return driver;
}

/** A changed item goes back to "not reviewed" so the admin looks at the new version. */
function clearReviews(driver: HydratedDocument<DriverDoc>, keys: DriverReviewKey[]) {
  if (!driver.reviews) return;
  const reviews = { ...driver.reviews };
  keys.forEach((key) => delete reviews[key]);
  driver.reviews = reviews;
  driver.markModified('reviews');
}

function rejectedItems(driver: DriverDoc) {
  return DRIVER_REVIEW_KEYS.filter((key) => driver.reviews?.[key]?.status === 'rejected').map((key) => ({
    key,
    label: DRIVER_REVIEW_LABELS[key],
    note: driver.reviews?.[key]?.note ?? null,
  }));
}

async function saveStep(
  driverId: string,
  stepKey: StepKey,
  fields: Record<string, unknown>,
  reviewKeys: DriverReviewKey[] = [],
) {
  const driver = await loadEditableDriver(driverId);
  // A rejected driver fixing one item must not be thrown back to the start of the wizard.
  driver.set(driver.status === 'rejected' ? fields : { ...fields, registrationStep: stepKey });
  clearReviews(driver, reviewKeys);
  await driver.save();
}

export async function savePersonalInfo(req: Request, res: Response) {
  const dobDate = new Date(req.body.dob);
  const ageYears = (Date.now() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (ageYears < 18) {
    res.status(422).json({ error: 'Validation failed', details: [{ path: 'dob', msg: 'You must be at least 18 years old' }] });
    return;
  }
  const { fullName, email, dob, gender } = req.body;
  await saveStep(req.user!.id, 'personal-info', { fullName, email, dob, gender }, ['personal_info']);
  res.json({ message: 'Saved' });
}

export async function saveAddress(req: Request, res: Response) {
  const { line1, area, city, state, pincode, addressType } = req.body;
  await saveStep(req.user!.id, 'address', { address: { line1, area, city, state, pincode, addressType } });
  res.json({ message: 'Saved' });
}

export async function saveEmergencyContact(req: Request, res: Response) {
  const { name, relationship, mobile, altMobile } = req.body;
  await saveStep(req.user!.id, 'emergency-contact', {
    emergencyContact: { name, relationship, mobile, ...(altMobile ? { altMobile } : {}) },
  });
  res.json({ message: 'Saved' });
}

export async function saveVehicleType(req: Request, res: Response) {
  await saveStep(req.user!.id, 'vehicle-type', { vehicleType: req.body.vehicleType }, ['vehicle_details']);
  res.json({ message: 'Saved' });
}

export async function saveVehicleDetails(req: Request, res: Response) {
  const { registrationNumber, brand, model, year, fuelType, color, capacity } = req.body;
  await saveStep(
    req.user!.id,
    'vehicle-details',
    { vehicleDetails: { registrationNumber, brand, model, year, fuelType, color, ...(capacity ? { capacity } : {}) } },
    ['vehicle_details'],
  );
  res.json({ message: 'Saved' });
}

export async function uploadDocument(req: Request, res: Response) {
  if (!req.file) throw new HttpError(400, 'No file uploaded — field name must be "file"');
  const driver = await loadEditableDriver(req.user!.id);
  const documents = { ...(driver.documents ?? {}), [req.body.type]: publicUrlFor(req.file.filename) };
  driver.documents = documents;
  if (driver.status !== 'rejected') driver.registrationStep = 'documents';
  clearReviews(driver, [req.body.type as DriverReviewKey]);
  await driver.save();
  res.json({ type: req.body.type, url: documents[req.body.type as keyof typeof documents] });
}

export async function saveInsuranceDetails(req: Request, res: Response) {
  const { insuranceType, policyNumber, validFrom, validUntil } = req.body;
  await saveStep(
    req.user!.id,
    'insurance-details',
    { insuranceDetails: { insuranceType, policyNumber, validFrom, validUntil } },
    ['insurance_details'],
  );
  res.json({ message: 'Saved' });
}

export async function saveBankDetails(req: Request, res: Response) {
  const { accountHolderName, accountNumber, ifsc, upiId } = req.body;
  await saveStep(
    req.user!.id,
    'bank-details',
    { bankDetails: { accountHolderName, accountNumber, ifsc, ...(upiId ? { upiId } : {}) } },
    ['bank_details'],
  );
  res.json({ message: 'Saved' });
}

export async function getRegistration(req: Request, res: Response) {
  const driver = await loadDriverOrThrow(req.user!.id);
  res.json({
    registrationStep: driver.registrationStep,
    nextStep: nextStepFor(driver),
    personalInfo: { fullName: driver.fullName ?? null, email: driver.email ?? null, dob: driver.dob ?? null, gender: driver.gender ?? null },
    avatarUrl: driver.avatarUrl ?? null,
    address: driver.address ?? null,
    emergencyContact: driver.emergencyContact ?? null,
    vehicleType: driver.vehicleType ?? null,
    vehicleDetails: driver.vehicleDetails ?? null,
    documents: driver.documents ?? null,
    insuranceDetails: driver.insuranceDetails ?? null,
    bankDetails: driver.bankDetails ?? null,
    referenceId: driver.referenceId ?? null,
    rejectedItems: rejectedItems(driver),
  });
}

export async function getStatus(req: Request, res: Response) {
  const driver = await loadDriverOrThrow(req.user!.id);
  res.json({
    status: driver.status,
    kycStatus: driver.kycStatus,
    registrationStep: driver.registrationStep,
    nextStep: nextStepFor(driver),
    referenceId: driver.referenceId ?? null,
    rejectionReason: driver.rejectionReason ?? null,
    rejectedItems: rejectedItems(driver),
  });
}

export async function submit(req: Request, res: Response) {
  const driver = await loadEditableDriver(req.user!.id);

  const missingSteps = STEP_ORDER.filter((s) => !s.isDone(driver)).map((s) => s.key);
  const missingDocuments = REQUIRED_DOCUMENTS.filter((doc) => !driver.documents?.[doc]);
  if (missingSteps.length > 0) {
    res.status(422).json({ error: 'Registration is incomplete', missingSteps, missingDocuments });
    return;
  }
  const unresolved = rejectedItems(driver);
  if (unresolved.length > 0) {
    res.status(422).json({
      error: `Please fix the rejected items first: ${unresolved.map((item) => item.label).join(', ')}`,
      rejectedItems: unresolved,
    });
    return;
  }

  const referenceId = driver.referenceId ?? `VR-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 899999)}`;
  driver.referenceId = referenceId;
  driver.status = 'pending';
  driver.kycStatus = 'pending';
  driver.rejectionReason = undefined;
  driver.registrationStep = 'submitted';
  await driver.save();

  res.json({ referenceId: driver.referenceId, status: driver.status, kycStatus: driver.kycStatus });
}
