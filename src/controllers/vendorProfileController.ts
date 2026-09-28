import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Vendor, type RegistrationStepKey, type VendorAddressData, type AdditionalDocumentData } from '../models/Vendor';
import { Order } from '../models/Order';
import { VendorSettlement } from '../models/VendorSettlement';
import { VendorPayoutBatch } from '../models/VendorPayoutBatch';
import { ensureBatchesForVendor } from '../lib/settlementBatches';
import { toSafeJson } from '../lib/sanitize';
import { HttpError } from '../lib/httpError';

async function loadVendorOrThrow(vendorId: string) {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw new HttpError(404, 'Vendor not found');
  return vendor;
}

/**
 * Post-approval profile editing. Distinct from vendorRegistrationController's
 * saveXxx endpoints, which also advance `registrationStep` (onboarding
 * progress) — reusing those here would silently regress an already-active
 * vendor's registration state every time they edited a field later.
 */
const EDITABLE_OWNER_FIELDS = ['fullName', 'email', 'mobile'];
const EDITABLE_BUSINESS_FIELDS = ['businessName', 'displayName', 'category', 'addressLine1', 'addressLine2', 'city', 'state', 'pincode', 'country'];
const EDITABLE_STORE_FIELDS = ['storeName', 'storeAddress', 'landmark', 'contactNumber', 'storeType', 'operatingHours', 'location'];
const EDITABLE_STORE_PROFILE_FIELDS = ['storeName', 'description', 'primaryCategory', 'subCategory', 'tags', 'minimumOrderValue', 'avgPrepTime'];

function pick(source: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> {
  if (!source) return {};
  return Object.fromEntries(keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));
}

export async function updateProfile(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  const { businessInfo, ownerInfo, storeInfo, storeProfile } = req.body as {
    businessInfo?: Record<string, unknown>;
    ownerInfo?: Record<string, unknown>;
    storeInfo?: Record<string, unknown>;
    storeProfile?: Record<string, unknown>;
  };

  // Identity/KYC fields (PAN, GST, business proof, bank details, business type)
  // are rejected by the route validators — they only change via the document
  // replace / bank-request review flows.
  if (ownerInfo) vendor.set('ownerInfo', { ...vendor.ownerInfo, ...pick(ownerInfo, EDITABLE_OWNER_FIELDS) });
  if (businessInfo) vendor.set('businessInfo', { ...vendor.businessInfo, ...pick(businessInfo, EDITABLE_BUSINESS_FIELDS) });
  if (storeInfo) vendor.set('storeInfo', { ...vendor.storeInfo, ...pick(storeInfo, EDITABLE_STORE_FIELDS) });
  // storeProfile (store display name/description) is the same field the
  // post-approval store-setup wizard writes — kept in sync so the name/
  // description customers see stays consistent with what's edited here.
  if (storeProfile) vendor.set('storeProfile', { ...vendor.storeProfile, ...pick(storeProfile, EDITABLE_STORE_PROFILE_FIELDS) });

  await vendor.save();
  res.json(toSafeJson(vendor, ['passwordHash']));
}

/** Vendor-submitted request to change live bank details. Never applies
 * directly — an admin must approve it (adminController.reviewBankRequest)
 * before `vendor.bankDetails` actually changes. */
export async function requestBankDetailsChange(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  if (vendor.pendingBankDetails?.status === 'pending') {
    throw new HttpError(409, 'A bank details change request is already pending review');
  }

  const { accountHolderName, accountNumber, ifsc, bankName, branch, accountType, upiId } = req.body as {
    accountHolderName: string;
    accountNumber: string;
    ifsc: string;
    bankName?: string;
    branch?: string;
    accountType: string;
    upiId?: string;
  };

  vendor.pendingBankDetails = {
    data: { accountHolderName, accountNumber, ifsc, bankName, branch, accountType, upiId },
    status: 'pending',
    submittedAt: new Date(),
  };
  vendor.markModified('pendingBankDetails');
  await vendor.save();
  res.status(201).json(vendor.pendingBankDetails);
}

export async function getBankDetailsRequestStatus(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  res.json(vendor.pendingBankDetails ?? null);
}

/** Real order counts/revenue/rating for the Profile tab's stat card — `rating`
 * is the average of customers' per-order vendor ratings, null until one exists. */
export async function getStats(req: Request, res: Response) {
  const vendorObjectId = new Types.ObjectId(req.user!.id);
  const [orders, revenueAgg, ratingAgg] = await Promise.all([
    Order.countDocuments({ vendorId: vendorObjectId }),
    Order.aggregate([
      { $match: { vendorId: vendorObjectId, status: 'delivered' } },
      { $group: { _id: null, revenue: { $sum: '$pricing.grandTotal' } } },
    ]),
    Order.aggregate([
      { $match: { vendorId: vendorObjectId, vendorRating: { $ne: null } } },
      { $group: { _id: null, avg: { $avg: '$vendorRating' }, count: { $sum: 1 } } },
    ]),
  ]);
  const rating = ratingAgg[0] ? Math.round(ratingAgg[0].avg * 10) / 10 : null;
  res.json({ orders, revenue: revenueAgg[0]?.revenue ?? 0, rating, ratingCount: ratingAgg[0]?.count ?? 0 });
}

export async function listAddresses(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  res.json(vendor.addresses ?? []);
}

export async function addAddress(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  const { label, line1, line2, lat, lng } = req.body as {
    label: string;
    line1: string;
    line2?: string;
    lat?: number;
    lng?: number;
  };
  const isFirst = (vendor.addresses ?? []).length === 0;
  const address: VendorAddressData = {
    id: new Types.ObjectId().toString(),
    label,
    line1,
    line2,
    isPrimary: isFirst,
    lat,
    lng,
  };
  vendor.addresses = [...(vendor.addresses ?? []), address];
  await vendor.save();
  res.status(201).json(vendor.addresses);
}

export async function updateAddress(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  const { addressId } = req.params;
  const index = (vendor.addresses ?? []).findIndex((a) => a.id === addressId);
  if (index < 0) throw new HttpError(404, 'Address not found');

  const { label, line1, line2, lat, lng } = req.body as {
    label?: string;
    line1?: string;
    line2?: string;
    lat?: number;
    lng?: number;
  };
  const current = vendor.addresses[index];
  vendor.addresses[index] = {
    ...current,
    ...(label !== undefined && { label }),
    ...(line1 !== undefined && { line1 }),
    ...(line2 !== undefined && { line2 }),
    ...(lat !== undefined && { lat }),
    ...(lng !== undefined && { lng }),
  };
  vendor.markModified('addresses');
  await vendor.save();
  res.json(vendor.addresses);
}

export async function removeAddress(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  const { addressId } = req.params;
  const remaining = (vendor.addresses ?? []).filter((a) => a.id !== addressId);
  if (remaining.length === vendor.addresses.length) throw new HttpError(404, 'Address not found');

  const removedWasPrimary = vendor.addresses.find((a) => a.id === addressId)?.isPrimary;
  if (removedWasPrimary && remaining.length > 0) remaining[0].isPrimary = true;

  vendor.addresses = remaining;
  await vendor.save();
  res.json(vendor.addresses);
}

export async function setPrimaryAddress(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  const { addressId } = req.params;
  if (!(vendor.addresses ?? []).some((a) => a.id === addressId)) throw new HttpError(404, 'Address not found');

  vendor.addresses = vendor.addresses.map((a) => ({ ...a, isPrimary: a.id === addressId }));
  await vendor.save();
  res.json(vendor.addresses);
}

/** Swaps a KYC document's file and resets it to "pending" for re-review — the
 * only documents that are actual files (not just data fields) are PAN, GST
 * certificate, and the general business proof; bank details have no file to
 * replace. */
const REPLACEABLE_DOCUMENT_STEPS: RegistrationStepKey[] = ['panDetails', 'gstDetails', 'businessProof'];

export async function replaceDocument(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  const stepKey = req.params.stepKey as RegistrationStepKey;
  if (!REPLACEABLE_DOCUMENT_STEPS.includes(stepKey)) {
    throw new HttpError(400, `"${req.params.stepKey}" is not a replaceable document`);
  }
  const { url } = req.body as { url: string };

  if (stepKey === 'panDetails') {
    if (!vendor.panDetails) throw new HttpError(404, 'No PAN details on file');
    vendor.set('panDetails', { ...vendor.panDetails, documentUrl: url });
  } else if (stepKey === 'gstDetails') {
    if (!vendor.gstDetails) throw new HttpError(404, 'No GST details on file');
    vendor.set('gstDetails', { ...vendor.gstDetails, certificateUrl: url });
  } else {
    if (!vendor.businessProof) throw new HttpError(404, 'No business proof on file');
    vendor.set('businessProof', { ...vendor.businessProof, frontUrl: url });
  }

  vendor.stepReviews = { ...(vendor.stepReviews ?? {}), [stepKey]: { status: 'pending' } };
  vendor.markModified('stepReviews');
  await vendor.save();
  res.json(toSafeJson(vendor, ['passwordHash']));
}

export async function listAdditionalDocuments(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  res.json(vendor.additionalDocuments ?? []);
}

export async function addAdditionalDocument(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  const { name, url } = req.body as { name: string; url: string };
  const document: AdditionalDocumentData = {
    id: new Types.ObjectId().toString(),
    name,
    url,
    uploadedAt: new Date(),
  };
  vendor.additionalDocuments = [...(vendor.additionalDocuments ?? []), document];
  await vendor.save();
  res.status(201).json(vendor.additionalDocuments);
}

export async function removeAdditionalDocument(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  const { documentId } = req.params;
  const remaining = (vendor.additionalDocuments ?? []).filter((d) => d.id !== documentId);
  if (remaining.length === (vendor.additionalDocuments ?? []).length) {
    throw new HttpError(404, 'Document not found');
  }
  vendor.additionalDocuments = remaining;
  await vendor.save();
  res.json(vendor.additionalDocuments);
}

export async function getSettlements(req: Request, res: Response) {
  const settlements = await VendorSettlement.find({ vendorId: req.user!.id })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(settlements.map((s) => toSafeJson(s)));
}

export async function getPayoutBatches(req: Request, res: Response) {
  await ensureBatchesForVendor(req.user!.id);
  const batches = await VendorPayoutBatch.find({ vendorId: req.user!.id })
    .sort({ periodStart: -1 })
    .limit(52);
  res.json(batches.map((b) => toSafeJson(b)));
}

export async function getPayoutBatch(req: Request, res: Response) {
  const batch = await VendorPayoutBatch.findById(req.params.id);
  if (!batch || String(batch.vendorId) !== req.user!.id) {
    throw new HttpError(404, 'Payout batch not found');
  }
  res.json(toSafeJson(batch));
}

export async function getNotificationPrefs(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  res.json(vendor.notificationPrefs ?? {});
}

export async function updateNotificationPrefs(req: Request, res: Response) {
  const vendor = await loadVendorOrThrow(req.user!.id);
  const updates = req.body as Record<string, boolean>;
  vendor.notificationPrefs = { ...(vendor.notificationPrefs ?? {}), ...updates };
  vendor.markModified('notificationPrefs');
  await vendor.save();
  res.json(vendor.notificationPrefs);
}
