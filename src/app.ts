import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { env } from './lib/env';
import { authRouter } from './routes/auth';
import { customerRouter } from './routes/customer';
import { vendorRouter } from './routes/vendor';
import { driverRouter } from './routes/driver';
import { adminRouter } from './routes/admin';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export function createApp() {
  const app = express();

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.corsOrigins.length === 0 || env.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        // Vite picks the next free port when its default is taken, so any local dev origin is allowed outside production.
        if (!env.isProd && LOCAL_DEV_ORIGIN.test(origin)) return callback(null, true);
        callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.isProd ? 'combined' : 'dev'));

  app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'verdant-backend' }));

  app.use('/api/auth', authRouter);
  app.use('/api/customer', customerRouter);
  app.use('/api/vendor', vendorRouter);
  app.use('/api/driver', driverRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
