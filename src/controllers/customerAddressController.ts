import type { Request, Response } from 'express';
import { Address } from '../models/Address';
import { toSafeJson } from '../lib/sanitize';
import { HttpError } from '../lib/httpError';

export async function listAddresses(req: Request, res: Response) {
  const addresses = await Address.find({ customerId: req.user!.id }).sort({ isDefault: -1, createdAt: -1 });
  res.json(addresses.map((a) => toSafeJson(a)));
}

async function unsetOtherDefaults(customerId: string) {
  await Address.updateMany({ customerId, isDefault: true }, { $set: { isDefault: false } });
}

export async function createAddress(req: Request, res: Response) {
  const customerId = req.user!.id;
  const { label, contactName, contactPhone, line1, line2, landmark, city, state, pincode, latitude, longitude, isDefault } =
    req.body;

  const existingCount = await Address.countDocuments({ customerId });
  const shouldBeDefault = Boolean(isDefault) || existingCount === 0;
  if (shouldBeDefault) await unsetOtherDefaults(customerId);

  const address = await Address.create({
    customerId,
    label,
    contactName,
    contactPhone,
    line1,
    line2,
    landmark,
    city,
    state,
    pincode,
    latitude,
    longitude,
    isDefault: shouldBeDefault,
  });
  res.status(201).json(toSafeJson(address));
}

export async function updateAddress(req: Request, res: Response) {
  const customerId = req.user!.id;
  const address = await Address.findOne({ _id: req.params.id, customerId });
  if (!address) throw new HttpError(404, 'Address not found');

  const { label, contactName, contactPhone, line1, line2, landmark, city, state, pincode, latitude, longitude, isDefault } =
    req.body;

  if (isDefault === true) await unsetOtherDefaults(customerId);

  Object.assign(address, {
    ...(label !== undefined && { label }),
    ...(contactName !== undefined && { contactName }),
    ...(contactPhone !== undefined && { contactPhone }),
    ...(line1 !== undefined && { line1 }),
    ...(line2 !== undefined && { line2 }),
    ...(landmark !== undefined && { landmark }),
    ...(city !== undefined && { city }),
    ...(state !== undefined && { state }),
    ...(pincode !== undefined && { pincode }),
    ...(latitude !== undefined && { latitude }),
    ...(longitude !== undefined && { longitude }),
    ...(isDefault !== undefined && { isDefault }),
  });
  await address.save();
  res.json(toSafeJson(address));
}

export async function deleteAddress(req: Request, res: Response) {
  const customerId = req.user!.id;
  const address = await Address.findOneAndDelete({ _id: req.params.id, customerId });
  if (!address) throw new HttpError(404, 'Address not found');

  if (address.isDefault) {
    const next = await Address.findOne({ customerId }).sort({ createdAt: -1 });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }
  res.status(204).end();
}

export async function setDefaultAddress(req: Request, res: Response) {
  const customerId = req.user!.id;
  const address = await Address.findOne({ _id: req.params.id, customerId });
  if (!address) throw new HttpError(404, 'Address not found');

  await unsetOtherDefaults(customerId);
  address.isDefault = true;
  await address.save();
  res.json(toSafeJson(address));
}
