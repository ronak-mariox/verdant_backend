import type { Request, Response } from 'express';
import { rotateTokenPair, revokeRefreshToken, peekRefreshToken } from '../lib/tokens';
import { checkAccountStatus, restrictedBody } from '../lib/accountStatus';

/** Shared across all four roles — the refresh token itself carries the role/subject. */
export async function refresh(req: Request, res: Response) {
  let subject: ReturnType<typeof peekRefreshToken>;
  try {
    subject = peekRefreshToken(req.body.refreshToken);
  } catch {
    res.status(401).json({ error: 'Refresh token is invalid or has expired — please log in again' });
    return;
  }

  const check = await checkAccountStatus(subject.role, subject.userId);
  if (!check.ok) {
    if (check.reason === 'account_restricted') {
      res.status(403).json(restrictedBody(subject.role, check.status));
      return;
    }
    res.status(401).json({ error: 'This account no longer exists' });
    return;
  }

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
