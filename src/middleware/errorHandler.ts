import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `No route matches ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, msg: e.message }));
    res.status(422).json({ error: 'Validation failed', details });
    return;
  }
  if (err instanceof Error) {
    const status = (err as Error & { status?: number }).status ?? 500;
    const details = (err as Error & { details?: unknown }).details;
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    const topLevel = details && typeof details === 'object' && !Array.isArray(details) ? (details as Record<string, unknown>) : {};
    res.status(status).json({ ...topLevel, error: err.message || 'Internal server error', ...(details ? { details } : {}) });
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
