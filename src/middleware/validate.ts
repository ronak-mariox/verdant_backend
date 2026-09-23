import type { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';

/** Run after express-validator chains; returns 422 with field errors if any failed. */
export function handleValidation(req: Request, res: Response, next: NextFunction) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    res.status(422).json({ error: 'Validation failed', details: result.array() });
    return;
  }
  next();
}
