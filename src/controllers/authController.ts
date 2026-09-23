import type { Request, Response } from 'express';
import { rotateTokenPair, revokeRefreshToken } from '../lib/tokens';

/** Shared across all four roles — the refresh token itself carries the role/subject. */
export async function refresh(req: Request, res: Response) {
  try {
    const tokens = await rotateTokenPair(req.body.refreshToken);
    res.json(tokens);
  } catch {
    res.status(401).json({ error: 'Refresh token is invalid or has expired — please log in again' });
  }
}

export async function logout(req: Request, res: Response) {
  await revokeRefreshToken(req.body.refreshToken);
  res.status(204).end();
}
