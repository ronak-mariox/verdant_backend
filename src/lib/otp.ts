import bcrypt from 'bcryptjs';
import { OtpRequest } from '../models/OtpRequest';
import { env } from './env';
import type { Role } from './jwt';

function generateCode(): string {
  const max = 10 ** env.otpLength;
  const min = 10 ** (env.otpLength - 1);
  return String(Math.floor(min + Math.random() * (max - min)));
}

/**
 * Creates and stores a new OTP (bcrypt-hashed, never persisted in plaintext) for a
 * phone+role pair. In dev mode the plaintext code is also returned so the client can
 * be tested without a real SMS gateway — a real integration would send it via SMS
 * here instead and drop the `devOtp` field entirely.
 */
export async function createOtp(phone: string, role: Role): Promise<{ devOtp?: string }> {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.otpTtlMinutes * 60 * 1000);

  await OtpRequest.create({ phone, role, codeHash, expiresAt });

  if (env.isProd) return {};
  // eslint-disable-next-line no-console
  console.log(`[otp] ${role} ${phone} -> ${code} (expires in ${env.otpTtlMinutes}m)`);
  return { devOtp: code };
}

export type OtpVerifyResult = { ok: true } | { ok: false; reason: 'not_found' | 'expired' | 'too_many_attempts' | 'incorrect' };

const MAX_ATTEMPTS = 5;

export async function verifyOtp(phone: string, role: Role, code: string): Promise<OtpVerifyResult> {
  // Dev-only master OTP — no real SMS provider is wired up yet, so this lets anyone
  // testing the apps always get in with a fixed code instead of having to read the
  // real generated one out of `devOtp`/server logs every time. Hard-gated to non-prod:
  // this must never be reachable once a real SMS provider replaces createOtp's log line.
  if (!env.isProd && code === env.devMasterOtp) {
    return { ok: true };
  }

  const otp = await OtpRequest.findOne({ phone, role, consumedAt: null }).sort({ createdAt: -1 });

  if (!otp) return { ok: false, reason: 'not_found' };
  if (otp.expiresAt < new Date()) return { ok: false, reason: 'expired' };
  if (otp.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

  const matches = await bcrypt.compare(code, otp.codeHash);
  if (!matches) {
    otp.attempts += 1;
    await otp.save();
    return { ok: false, reason: 'incorrect' };
  }

  otp.consumedAt = new Date();
  await otp.save();
  return { ok: true };
}

/**
 * Delivery-confirmation OTP — same bcrypt-hash/dev-log pattern as `createOtp`, but
 * stored directly on the order (`Order.deliveryOtpHash`) rather than in `OtpRequest`,
 * since it's scoped to a single order rather than a phone+role login.
 */
export async function createDeliveryOtp(): Promise<{ code: string; hash: string; devOtp?: string }> {
  const code = generateCode();
  const hash = await bcrypt.hash(code, 10);

  if (env.isProd) return { code, hash };
  // eslint-disable-next-line no-console
  console.log(`[delivery-otp] -> ${code}`);
  return { code, hash, devOtp: code };
}

export async function compareDeliveryOtp(code: string, hash: string): Promise<boolean> {
  if (!env.isProd && code === env.devMasterOtp) return true;
  return bcrypt.compare(code, hash);
}
