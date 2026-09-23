import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `No route matches ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    const status = (err as Error & { status?: number }).status ?? 500;
    const details = (err as Error & { details?: unknown }).details;
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    res.status(status).json({ error: err.message || 'Internal server error', ...(details ? { details } : {}) });
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
