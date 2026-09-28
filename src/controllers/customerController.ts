import type { Request, Response } from 'express';
import { Customer } from '../models/Customer';
import { createOtp, verifyOtp as verifyOtpCode } from '../lib/otp';
import { issueTokenPair } from '../lib/tokens';
import { toSafeJson } from '../lib/sanitize';
import { signPurposeToken, verifyPurposeToken } from '../lib/jwt';
import { publicUrlFor } from '../lib/upload';
import { HttpError } from '../lib/httpError';
import { restrictedBody } from '../lib/accountStatus';

export async function requestOtp(req: Request, res: Response) {
  const phone = req.body.phone as string;
  const { devOtp } = await createOtp(phone, 'customer');
  res.json({ message: 'OTP sent', ...(devOtp && { devOtp }) });
}

/**
 * Verifies the OTP, then branches: an existing customer logs straight in;
 * a new phone number does NOT create an account here — it only proves phone
 * ownership and hands back a short-lived token for `register` below, so a
 * customer who verifies but abandons signup never leaves a blank profile
 * behind (mirrors the vendor app's verify -> register two-step).
 */
export async function verifyOtp(req: Request, res: Response) {
  const phone = req.body.phone as string;
  const result = await verifyOtpCode(phone, 'customer', req.body.otp);
  if (!result.ok) {
    res.status(400).json({ error: 'Incorrect or expired OTP', reason: result.reason });
    return;
  }

  const customer = await Customer.findOne({ phone });

  if (!customer) {
    const verifiedPhoneToken = signPurposeToken({ phone, role: 'customer', purpose: 'signup' }, '15m');
    res.json({ isNewUser: true, verifiedPhoneToken });
    return;
  }

  if (customer.status === 'blocked') {
    res.status(403).json(restrictedBody('customer', customer.status));
    return;
  }

  const tokens = await issueTokenPair(String(customer._id), 'customer');
  res.json({ ...tokens, isNewUser: false, user: toSafeJson(customer) });
}

/** Completes signup for a phone that just verified OTP for the first time. */
export async function register(req: Request, res: Response) {
  let purpose: ReturnType<typeof verifyPurposeToken>;
  try {
    purpose = verifyPurposeToken(req.body.verifiedPhoneToken);
    if (purpose.purpose !== 'signup' || purpose.role !== 'customer') throw new Error('wrong purpose');
  } catch {
    res.status(401).json({ error: 'Phone verification expired — please verify your OTP again' });
    return;
  }

  const existing = await Customer.findOne({ phone: purpose.phone });
  if (existing) {
    res.status(409).json({ error: 'An account with this phone number already exists' });
    return;
  }

  const { name, email } = req.body as { name: string; email?: string };
  const customer = await Customer.create({ phone: purpose.phone, name, email });

  const tokens = await issueTokenPair(String(customer._id), 'customer');
  res.status(201).json({ ...tokens, user: toSafeJson(customer) });
}

export async function getMe(req: Request, res: Response) {
  const customer = await Customer.findById(req.user!.id);
  if (!customer) throw new HttpError(404, 'Customer not found');
  res.json(toSafeJson(customer));
}

export async function updateMe(req: Request, res: Response) {
  const { name, email, dob, gender } = req.body as Record<string, string | undefined>;
  const customer = await Customer.findByIdAndUpdate(
    req.user!.id,
    { $set: { name, email, dob, gender } },
    { new: true },
  );
  res.json(toSafeJson(customer));
}

export async function uploadAvatar(req: Request, res: Response) {
  if (!req.file) throw new HttpError(400, 'No file uploaded — field name must be "avatar"');
  const avatarUrl = publicUrlFor(req.file.filename);
  await Customer.findByIdAndUpdate(req.user!.id, { $set: { avatarUrl } });
  res.json({ avatarUrl });
}
