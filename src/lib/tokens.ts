import crypto from 'node:crypto';
import type { HydratedDocument } from 'mongoose';
import { RefreshToken, type RefreshTokenDoc } from '../models/RefreshToken';
import { env } from './env';
import { signAccessToken, signRefreshToken, verifyRefreshToken, type Role } from './jwt';

/** How long a just-rotated (revoked) refresh token is still tolerated for one retry —
 * covers a client that successfully rotated on the server but never received/persisted
 * the response (killed mid-request, dropped connection right as the response arrived).
 * Without this, that single lost response permanently locks the user out, since their
 * only stored refresh token is one the server already revoked. */
const REUSE_GRACE_MS = 60_000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Issues a fresh access+refresh pair and persists the refresh token (hashed). */
export async function issueTokenPair(userId: string, role: Role): Promise<TokenPair> {
  const accessToken = signAccessToken({ sub: userId, role });
  const refreshToken = signRefreshToken({ sub: userId, role });

  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  await RefreshToken.create({ tokenHash: hashToken(refreshToken), userId, role, expiresAt });

  return { accessToken, refreshToken };
}

async function rotateFrom(stored: HydratedDocument<RefreshTokenDoc>): Promise<TokenPair> {
  const next = await issueTokenPair(stored.userId, stored.role);
  stored.revokedAt = new Date();
  stored.replacedBy = hashToken(next.refreshToken);
  await stored.save();
  return next;
}

/**
 * Verifies a refresh token, rotates it (revokes the old row, issues a new pair),
 * and returns the new pair. Throws if the token is invalid, expired, or revoked
 * outside the reuse-grace window (which signals possible token theft).
 */
export async function rotateTokenPair(refreshToken: string): Promise<TokenPair> {
  verifyRefreshToken(refreshToken);
  const tokenHash = hashToken(refreshToken);

  const stored = await RefreshToken.findOne({ tokenHash });
  if (!stored) {
    throw new Error('Refresh token is invalid or has expired');
  }

  if (stored.revokedAt) {
    const withinGrace = Date.now() - stored.revokedAt.getTime() < REUSE_GRACE_MS;
    if (withinGrace && stored.replacedBy) {
      const replacement = await RefreshToken.findOne({ tokenHash: stored.replacedBy });
      if (replacement && !replacement.revokedAt && replacement.expiresAt > new Date()) {
        // The server already rotated this token once; the client just never got (or
        // never saved) that response. Advance the still-valid replacement forward
        // one more step and hand back a fresh pair rather than rejecting outright.
        return rotateFrom(replacement);
      }
    }
    throw new Error('Refresh token is invalid or has expired');
  }

  if (stored.expiresAt < new Date()) {
    throw new Error('Refresh token is invalid or has expired');
  }

  return rotateFrom(stored);
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await RefreshToken.updateOne({ tokenHash, revokedAt: null }, { revokedAt: new Date() });
}

/** Logs a user out of every device — e.g. after a password reset. */
export async function revokeAllRefreshTokens(userId: string, role: Role): Promise<void> {
  await RefreshToken.updateMany({ userId, role, revokedAt: null }, { revokedAt: new Date() });
}

/** Decodes a refresh token's subject/role without rotating it. Throws if invalid. */
export function peekRefreshToken(refreshToken: string): { userId: string; role: Role } {
  const payload = verifyRefreshToken(refreshToken);
  return { userId: payload.sub, role: payload.role };
}
