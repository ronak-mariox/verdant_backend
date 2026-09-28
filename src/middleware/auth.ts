import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, type Role } from '../lib/jwt';
import { checkAccountStatus, restrictedBody } from '../lib/accountStatus';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: Role };
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice('Bearer '.length);
  let payload: ReturnType<typeof verifyAccessToken>;
  try {
    payload = verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token' });
    return;
  }

  // A blocked/suspended/rejected account is cut off immediately, not when its
  // access token happens to expire.
  checkAccountStatus(payload.role, payload.sub)
    .then((check) => {
      if (!check.ok) {
        if (check.reason === 'not_found') {
          res.status(401).json({ error: 'This account no longer exists' });
          return;
        }
        res.status(403).json(restrictedBody(payload.role, check.status));
        return;
      }
      req.user = { id: payload.sub, role: payload.role };
      next();
    })
    .catch(next);
}

export function authorize(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'You do not have permission to perform this action' });
      return;
    }
    next();
  };
}
