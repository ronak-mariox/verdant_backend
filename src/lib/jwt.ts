import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from './env';

export type Role = 'customer' | 'vendor' | 'driver' | 'admin';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.accessTokenTtl as jwt.SignOptions['expiresIn'] });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

export function signRefreshToken(payload: AccessTokenPayload): string {
  // `jti` guarantees two refresh tokens for the same user are never byte-identical.
  // Without it, two tokens issued in the same wall-clock second (jwt's `iat` only
  // has 1-second resolution) would be identical strings, and since RefreshToken.tokenHash
  // is uniquely indexed, the second insert would throw — surfacing to the client as a
  // hard "invalid refresh token" rejection and forcing a needless re-login.
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, env.jwtRefreshSecret, {
    expiresIn: `${env.refreshTokenTtlDays}d`,
  });
}

export function verifyRefreshToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as AccessTokenPayload;
}

/**
 * Short-lived single-purpose tokens (e.g. "this phone number was just OTP-verified,
 * safe to let the client create an account without re-sending the OTP" or
 * "this phone owns this password-reset request"). Distinct from session tokens.
 */
export interface PurposeTokenPayload {
  phone: string;
  role: Role;
  purpose: string;
}

export function signPurposeToken(payload: PurposeTokenPayload, ttl: string): string {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: ttl as jwt.SignOptions['expiresIn'] });
}

export function verifyPurposeToken(token: string): PurposeTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as PurposeTokenPayload;
}
