import type { Request, Response } from 'express';
import { Vendor, type VendorDoc, type HolidayClosureItem } from '../models/Vendor';
import { publicUrlFor } from '../lib/upload';
import { HttpError } from '../lib/httpError';

/**
 * The post-approval store-setup wizard (StoreSetupContext in vender_app) — a
 * SEPARATE flow from business registration, only reachable once a vendor's
 * account has been approved. Steps are gated in order just like registration.
 */

type StepKey = 'profile' | 'media' | 'address' | 'hours' | 'delivery' | 'availability' | 'status';

const STEP_ORDER: { key: StepKey; label: string; isDone: (v: VendorDoc) => boolean }[] = [
  { key: 'profile', label: 'Store Profile', isDone: (v) => Boolean(v.storeProfile) },
  { key: 'media', label: 'Logo & Cover Image', isDone: (v) => Boolean(v.storeLogoUrl) && Boolean(v.storeCoverImageUrl) },
  { key: 'address', label: 'Store Address', isDone: (v) => Boolean(v.storeSetupAddress) },
  { key: 'hours', label: 'Operating Hours', isDone: (v) => Boolean(v.operatingHours) },
  { key: 'delivery', label: 'Delivery Settings', isDone: (v) => Boolean(v.deliverySettings) },
  { key: 'availability', label: 'Service Availability', isDone: (v) => Boolean(v.serviceAvailability) },
  { key: 'status', label: 'Store Status', isDone: (v) => Boolean(v.storeStatusSetAt) },
];

function assertPriorStepsComplete(vendor: VendorDoc, stepKey: StepKey) {
  const idx = STEP_ORDER.findIndex((s) => s.key === stepKey);
  for (let i = 0; i < idx; i++) {
    const step = STEP_ORDER[i];
    if (!step.isDone(vendor)) {
      throw new HttpError(409, `Complete the "${step.label}" step first`, { missingStep: step.key });
    }
  }
}

async function loadApprovedVendor(vendorId: string) {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw new HttpError(404, 'Vendor not found');
  if (vendor.status !== 'active') {
    throw new HttpError(403, 'Your vendor account must be approved before you can set up your store');
  }
  return vendor;
}

export async function saveProfile(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  assertPriorStepsComplete(vendor, 'profile');
  const { storeName, description, primaryCategory, subCategory, tags, minimumOrderValue, avgPrepTime } = req.body;
  vendor.storeProfile = { storeName, description, primaryCategory, subCategory, tags, minimumOrderValue, avgPrepTime };
  vendor.storeSetupStep = 'profile';
  await vendor.save();
  res.json({ message: 'Saved' });
}

export async function uploadLogo(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  assertPriorStepsComplete(vendor, 'media');
  if (!req.file) throw new HttpError(400, 'No file uploaded — field name must be "file"');
  vendor.storeLogoUrl = publicUrlFor(req.file.filename);
  vendor.storeSetupStep = 'media';
  await vendor.save();
  res.json({ storeLogoUrl: vendor.storeLogoUrl });
}

export async function uploadCoverImage(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  assertPriorStepsComplete(vendor, 'media');
  if (!req.file) throw new HttpError(400, 'No file uploaded — field name must be "file"');
  vendor.storeCoverImageUrl = publicUrlFor(req.file.filename);
  vendor.storeSetupStep = 'media';
  await vendor.save();
  res.json({ storeCoverImageUrl: vendor.storeCoverImageUrl });
}

export async function saveAddress(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  assertPriorStepsComplete(vendor, 'address');
  const { buildingShopNo, street, landmark, area, pincode, city, state, contactNumber, sameAsBusinessAddress, location } =
    req.body;
  vendor.storeSetupAddress = {
    buildingShopNo,
    street,
    landmark,
    area,
    pincode,
    city,
    state,
    contactNumber,
    sameAsBusinessAddress,
    location,
  };
  vendor.storeSetupStep = 'address';
  await vendor.save();
  res.json({ message: 'Saved' });
}

export async function saveHours(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  assertPriorStepsComplete(vendor, 'hours');
  const { sameEveryDay, defaultOpen, defaultClose, breakEnabled, weeklySchedule } = req.body;
  const days = weeklySchedule.map((d: { day: string }) => d.day);
  if (new Set(days).size !== 7) {
    res.status(422).json({ error: 'Validation failed', details: [{ path: 'weeklySchedule', msg: 'Each day of the week must appear exactly once' }] });
    return;
  }
  vendor.operatingHours = { sameEveryDay, defaultOpen, defaultClose, breakEnabled, weeklySchedule };
  vendor.storeSetupStep = 'hours';
  await vendor.save();
  res.json({ message: 'Saved' });
}

export async function addHoliday(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  const { title, date, daysClosed, note } = req.body;
  const holiday: HolidayClosureItem = { id: `hol-${Date.now()}`, title, date, daysClosed, note };
  vendor.holidays.push(holiday);
  await vendor.save();
  res.status(201).json(holiday);
}

export async function updateHoliday(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  const holiday = vendor.holidays.find((h) => h.id === req.params.id);
  if (!holiday) {
    res.status(404).json({ error: 'Holiday not found' });
    return;
  }
  const { title, date, daysClosed, note } = req.body;
  holiday.title = title;
  holiday.date = date;
  holiday.daysClosed = daysClosed;
  holiday.note = note;
  vendor.markModified('holidays');
  await vendor.save();
  res.json(holiday);
}

export async function removeHoliday(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  vendor.holidays = vendor.holidays.filter((h) => h.id !== req.params.id);
  await vendor.save();
  res.status(204).end();
}

export async function saveDelivery(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  assertPriorStepsComplete(vendor, 'delivery');
  const { fulfillmentType, deliveryRadiusKm, minimumOrderForDelivery, chargeType, slabs, freeDeliveryAbove } = req.body;
  vendor.deliverySettings = {
    fulfillmentType,
    deliveryRadiusKm,
    minimumOrderForDelivery,
    chargeType,
    slabs: slabs.map((s: { id?: string; range: string; charge: string }, i: number) => ({
      id: s.id ?? `slab-${i}`,
      range: s.range,
      charge: s.charge,
    })),
    freeDeliveryAbove,
  };
  vendor.storeSetupStep = 'delivery';
  await vendor.save();
  res.json({ message: 'Saved' });
}

export async function saveAvailability(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  assertPriorStepsComplete(vendor, 'availability');
  const { slotsEnabled, slots, maxSimultaneousOrders, autoPauseAtCapacity } = req.body;
  vendor.serviceAvailability = {
    slotsEnabled,
    slots: slots.map((s: { id?: string; label: string; window: string; totalSlots: number; usedSlots: number }, i: number) => ({
      id: s.id ?? `slot-${i}`,
      label: s.label,
      window: s.window,
      totalSlots: s.totalSlots,
      usedSlots: s.usedSlots,
    })),
    maxSimultaneousOrders,
    autoPauseAtCapacity,
  };
  vendor.storeSetupStep = 'availability';
  await vendor.save();
  res.json({ message: 'Saved' });
}

export async function saveStatus(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  assertPriorStepsComplete(vendor, 'status');
  vendor.storeStatus = req.body.storeStatus;
  vendor.storeStatusSetAt = new Date();
  vendor.tempClosure = undefined;
  vendor.storeSetupStep = 'status';
  await vendor.save();
  res.json({ message: 'Saved' });
}

export async function saveTempClosure(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  assertPriorStepsComplete(vendor, 'status');
  const { reason, customMessage, fromDate, toDate, closeFromTime, reopenAt, notifyCustomers } = req.body;
  vendor.tempClosure = { reason, customMessage, fromDate, toDate, closeFromTime, reopenAt, notifyCustomers };
  vendor.storeStatus = 'temporarily-closed';
  vendor.storeStatusSetAt = new Date();
  vendor.storeSetupStep = 'status';
  await vendor.save();
  res.json({ message: 'Saved' });
}

export async function getStoreSetup(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  res.json({
    storeSetupStep: vendor.storeSetupStep,
    storeSetupCompletedAt: vendor.storeSetupCompletedAt ?? null,
    storeProfile: vendor.storeProfile ?? null,
    storeLogoUrl: vendor.storeLogoUrl ?? null,
    storeCoverImageUrl: vendor.storeCoverImageUrl ?? null,
    storeSetupAddress: vendor.storeSetupAddress ?? null,
    operatingHours: vendor.operatingHours ?? null,
    holidays: vendor.holidays,
    deliverySettings: vendor.deliverySettings ?? null,
    serviceAvailability: vendor.serviceAvailability ?? null,
    storeStatus: vendor.storeStatus,
    tempClosure: vendor.tempClosure ?? null,
    nextStep: STEP_ORDER.find((s) => !s.isDone(vendor))?.key ?? null,
  });
}

export async function getStoreSetupStatus(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  res.json({
    storeStatus: vendor.storeStatus,
    completed: Boolean(vendor.storeSetupCompletedAt),
    nextStep: STEP_ORDER.find((s) => !s.isDone(vendor))?.key ?? null,
  });
}

export async function complete(req: Request, res: Response) {
  const vendor = await loadApprovedVendor(req.user!.id);
  const missingSteps = STEP_ORDER.filter((s) => !s.isDone(vendor)).map((s) => s.key);
  if (missingSteps.length > 0) {
    res.status(422).json({ error: 'Store setup is incomplete', missingSteps });
    return;
  }
  vendor.storeSetupCompletedAt = new Date();
  vendor.storeSetupStep = 'complete';
  await vendor.save();
  res.json({ storeSetupCompletedAt: vendor.storeSetupCompletedAt, storeStatus: vendor.storeStatus });
}
