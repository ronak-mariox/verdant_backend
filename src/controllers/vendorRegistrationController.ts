import type { Request, Response } from 'express';
import { Vendor, type VendorDoc } from '../models/Vendor';
import { publicUrlFor } from '../lib/upload';
import { HttpError } from '../lib/httpError';

/**
 * The vendor business-registration wizard as a real guarded multi-step flow:
 * every field vender_app's screens collect is required (validated in the
 * matching route file), and a step cannot be saved until every step before it
 * is complete.
 */

type StepKey =
  | 'business-type'
  | 'business-info'
  | 'owner-info'
  | 'store-info'
  | 'gst-details'
  | 'pan-details'
  | 'business-proof'
  | 'bank-details';

const STEP_ORDER: { key: StepKey; field: keyof VendorDoc; label: string }[] = [
  { key: 'business-type', field: 'businessType', label: 'Business Type' },
  { key: 'business-info', field: 'businessInfo', label: 'Business Info' },
  { key: 'owner-info', field: 'ownerInfo', label: 'Owner Info' },
  { key: 'store-info', field: 'storeInfo', label: 'Store Info' },
  { key: 'gst-details', field: 'gstDetails', label: 'GST Details' },
  { key: 'pan-details', field: 'panDetails', label: 'PAN Verification' },
  { key: 'business-proof', field: 'businessProof', label: 'Business Proof' },
  { key: 'bank-details', field: 'bankDetails', label: 'Bank Details' },
];

function assertPriorStepsComplete(vendor: VendorDoc, stepKey: StepKey) {
  const idx = STEP_ORDER.findIndex((s) => s.key === stepKey);
  for (let i = 0; i < idx; i++) {
    const step = STEP_ORDER[i];
    if (!vendor[step.field]) {
      throw new HttpError(409, `Complete the "${step.label}" step first`, { missingStep: step.key });
    }
  }
}

async function loadVendorOrThrow(vendorId: string) {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw new HttpError(404, 'Vendor not found');
  return vendor;
}

/** Once submitted (or approved) the KYC data is frozen — only a rejected vendor
 * may edit and resubmit. Post-approval edits go through PATCH /vendor/me. */
function assertRegistrationEditable(vendor: VendorDoc) {
  if (vendor.status === 'rejected') return;
  if (vendor.registrationStep === 'submitted' || vendor.status === 'active') {
    throw new HttpError(409, 'Registration has already been submitted and can no longer be edited', {
      reason: 'registration_locked',
    });
  }
}

async function saveStep(vendorId: string, stepKey: StepKey, field: keyof VendorDoc, value: unknown) {
  const vendor = await loadVendorOrThrow(vendorId);
  assertRegistrationEditable(vendor);
  assertPriorStepsComplete(vendor, stepKey);
  vendor.set(field as string, value);
  vendor.registrationStep = stepKey;
  await vendor.save();
}

export async function saveBusinessType(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  assertRegistrationEditable(vendor);
  assertPriorStepsComplete(vendor, 'business-type');
  vendor.businessType = req.body.businessType;
  vendor.registrationStep = 'business-type';
  await vendor.save();
  res.json({ message: 'Saved' });
}

export async function saveBusinessInfo(req: Request, res: Response) {
  const { legalName, displayName, category, addressLine1, addressLine2, city, state, pincode, country } = req.body;
  await saveStep(req.user!.id, 'business-info', 'businessInfo', {
    legalName,
    displayName,
    category,
    addressLine1,
    addressLine2,
    city,
    state,
    pincode,
    country,
  });
  res.json({ message: 'Saved' });
}

export async function saveOwnerInfo(req: Request, res: Response) {
  const dobDate = new Date(req.body.dob);
  const ageYears = (Date.now() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (ageYears < 18) {
    res.status(422).json({ error: 'Validation failed', details: [{ path: 'dob', msg: 'You must be at least 18 years old' }] });
    return;
  }
  const { fullName, mobile, email, dob, pan } = req.body;
  await saveStep(req.user!.id, 'owner-info', 'ownerInfo', { fullName, mobile, email, dob, pan });
  res.json({ message: 'Saved' });
}

export async function saveStoreInfo(req: Request, res: Response) {
  const { storeName, storeAddress, landmark, contactNumber, storeType, operatingHours, location } = req.body;
  await saveStep(req.user!.id, 'store-info', 'storeInfo', {
    storeName,
    storeAddress,
    landmark,
    contactNumber,
    storeType,
    operatingHours,
    location,
  });
  res.json({ message: 'Saved' });
}

export async function saveGstDetails(req: Request, res: Response) {
  const { registered, gstin, businessName, registrationDate, category, certificateUrl } = req.body;
  await saveStep(
    req.user!.id,
    'gst-details',
    'gstDetails',
    registered ? { registered, gstin, businessName, registrationDate, category, certificateUrl } : { registered: false },
  );
  res.json({ message: 'Saved' });
}

export async function savePanDetails(req: Request, res: Response) {
  const { panNumber, holderName, dob, panType, documentUrl } = req.body;
  await saveStep(req.user!.id, 'pan-details', 'panDetails', { panNumber, holderName, dob, panType, documentUrl });
  res.json({ message: 'Saved' });
}

export async function saveBusinessProof(req: Request, res: Response) {
  const { documentType, documentNumber, issueDate, expiryDate, frontUrl, backUrl } = req.body;
  await saveStep(req.user!.id, 'business-proof', 'businessProof', {
    documentType,
    documentNumber,
    issueDate,
    expiryDate,
    frontUrl,
    ...(backUrl ? { backUrl } : {}),
  });
  res.json({ message: 'Saved' });
}

export async function saveBankDetails(req: Request, res: Response) {
  const { accountHolderName, accountNumber, ifsc, bankName, branch, accountType, upiId } = req.body;
  await saveStep(req.user!.id, 'bank-details', 'bankDetails', {
    accountHolderName,
    accountNumber,
    ifsc,
    bankName,
    branch,
    accountType,
    ...(upiId ? { upiId } : {}),
  });
  res.json({ message: 'Saved' });
}

export async function uploadDocument(req: Request, res: Response) {
  if (!req.file) throw new HttpError(400, 'No file uploaded — field name must be "file"');
  res.json({ url: publicUrlFor(req.file.filename) });
}

export async function getRegistration(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  res.json({
    registrationStep: vendor.registrationStep,
    businessType: vendor.businessType ?? null,
    businessInfo: vendor.businessInfo ?? null,
    ownerInfo: vendor.ownerInfo ?? null,
    storeInfo: vendor.storeInfo ?? null,
    gstDetails: vendor.gstDetails ?? null,
    panDetails: vendor.panDetails ?? null,
    businessProof: vendor.businessProof ?? null,
    bankDetails: vendor.bankDetails ?? null,
    referenceId: vendor.referenceId ?? null,
    nextStep: STEP_ORDER.find((s) => !vendor[s.field])?.key ?? null,
    stepReviews: vendor.stepReviews ?? {},
  });
}

export async function getStatus(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  res.json({
    status: vendor.status,
    kycStatus: vendor.kycStatus,
    registrationStep: vendor.registrationStep,
    referenceId: vendor.referenceId ?? null,
    rejectionReason: vendor.rejectionReason ?? null,
    storeSetupCompleted: Boolean(vendor.storeSetupCompletedAt),
    // The first not-yet-filled step, or null once all 8 are filled — lets the app
    // decide in one lightweight call whether to resume the wizard, send the vendor
    // to review/submit, or let them into the app, instead of ever defaulting to
    // "let them in" on an incomplete/unapproved account.
    nextStep: STEP_ORDER.find((s) => !vendor[s.field])?.key ?? null,
    // Per-step admin review (verify/reject + note), set via the admin panel's
    // verification checklist — lets the vendor app show real progress instead of
    // a generic "under review" placeholder.
    stepReviews: vendor.stepReviews ?? {},
  });
}

export async function submit(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  assertRegistrationEditable(vendor);

  const missingSteps = STEP_ORDER.filter((s) => !vendor[s.field]).map((s) => s.key);
  if (missingSteps.length > 0) {
    res.status(422).json({ error: 'Registration is incomplete', missingSteps });
    return;
  }

  const referenceId = vendor.referenceId ?? `VND-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 89999)}`;
  vendor.referenceId = referenceId;
  vendor.status = 'pending';
  vendor.kycStatus = 'pending';
  vendor.rejectionReason = undefined;
  vendor.registrationStep = 'submitted';
  await vendor.save();

  res.json({ referenceId: vendor.referenceId, status: vendor.status, kycStatus: vendor.kycStatus });
}
