import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Vendor } from '../models/Vendor';
import { createOtp, verifyOtp as verifyOtpCode } from '../lib/otp';
import { issueTokenPair } from '../lib/tokens';
import { normalizePhone } from '../lib/json';
import { toSafeJson } from '../lib/sanitize';
import { signPurposeToken, verifyPurposeToken } from '../lib/jwt';
import { publicUrlFor } from '../lib/upload';
import { HttpError } from '../lib/httpError';

export async function requestOtp(req: Request, res: Response) {
  const { devOtp } = await createOtp(req.body.phone, 'vendor');
  res.json({ message: 'OTP sent', ...(devOtp && { devOtp }) });
}

export async function verifyOtp(req: Request, res: Response) {
  const phone = req.body.phone as string;
  const intent = req.body.intent as 'login' | 'create-account';

  const result = await verifyOtpCode(phone, 'vendor', req.body.otp);
  if (!result.ok) {
    res.status(400).json({ error: 'Incorrect or expired OTP', reason: result.reason });
    return;
  }

  const vendor = await Vendor.findOne({ phone });
  const accountExists = Boolean(vendor?.passwordHash);

  if (intent === 'create-account') {
    if (accountExists) {
      res.json({ accountExists: true });
      return;
    }
    const verifiedPhoneToken = signPurposeToken({ phone, role: 'vendor', purpose: 'signup' }, '15m');
    res.json({ accountExists: false, verifiedPhoneToken });
    return;
  }

  // intent === 'login' — this is the "forgot password" recovery path (the primary
  // login is by password; see login() below).
  if (!accountExists) {
    res.json({ accountExists: false });
    return;
  }
  const resetToken = signPurposeToken({ phone, role: 'vendor', purpose: 'password_reset' }, '10m');
  res.json({ accountExists: true, resetToken });
}

export async function register(req: Request, res: Response) {
  let purpose: ReturnType<typeof verifyPurposeToken>;
  try {
    purpose = verifyPurposeToken(req.body.verifiedPhoneToken);
    if (purpose.purpose !== 'signup' || purpose.role !== 'vendor') throw new Error('wrong purpose');
  } catch {
    res.status(401).json({ error: 'Phone verification expired — please verify your OTP again' });
    return;
  }

  const existingByEmail = await Vendor.findOne({ email: req.body.email });
  if (existingByEmail) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(req.body.password, 10);
  const vendor = await Vendor.findOneAndUpdate(
    { phone: purpose.phone },
    { $set: { email: req.body.email, fullName: req.body.fullName, passwordHash, status: 'pending' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  const tokens = await issueTokenPair(String(vendor._id), 'vendor');
  res.status(201).json({ ...tokens, vendor: toSafeJson(vendor, ['passwordHash']) });
}

export async function login(req: Request, res: Response) {
  const identifier = req.body.identifier as string;
  const isEmail = identifier.includes('@');
  const vendor = isEmail
    ? await Vendor.findOne({ email: identifier.toLowerCase() })
    : await Vendor.findOne({ phone: normalizePhone(identifier) });

  if (!vendor?.passwordHash || !(await bcrypt.compare(req.body.password, vendor.passwordHash))) {
    res.status(401).json({ error: 'Incorrect mobile number/email or password' });
    return;
  }

  const tokens = await issueTokenPair(String(vendor._id), 'vendor');
  res.json({ ...tokens, vendor: toSafeJson(vendor, ['passwordHash']) });
}

export async function resetPassword(req: Request, res: Response) {
  let purpose: ReturnType<typeof verifyPurposeToken>;
  try {
    purpose = verifyPurposeToken(req.body.resetToken);
    if (purpose.purpose !== 'password_reset' || purpose.role !== 'vendor') throw new Error('wrong purpose');
  } catch {
    res.status(401).json({ error: 'Reset link expired — please verify your OTP again' });
    return;
  }

  const passwordHash = await bcrypt.hash(req.body.newPassword, 10);
  await Vendor.updateOne({ phone: purpose.phone }, { $set: { passwordHash } });
  res.json({ message: 'Password updated — please log in with your new password' });
}

export async function getMe(req: Request, res: Response) {
  const vendor = await Vendor.findById(req.user!.id);
  if (!vendor) throw new HttpError(404, 'Vendor not found');
  res.json(toSafeJson(vendor, ['passwordHash']));
}

export async function uploadAvatar(req: Request, res: Response) {
  if (!req.file) throw new HttpError(400, 'No file uploaded — field name must be "avatar"');
  const avatarUrl = publicUrlFor(req.file.filename);
  await Vendor.findByIdAndUpdate(req.user!.id, { $set: { avatarUrl } });
  res.json({ avatarUrl });
}
