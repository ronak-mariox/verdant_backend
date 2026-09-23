import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',

  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/verdant'),

  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),

  otpLength: Number(process.env.OTP_LENGTH ?? 6),
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES ?? 5),
  // Fixed OTP that always verifies successfully outside production — see lib/otp.ts.
  devMasterOtp: process.env.DEV_MASTER_OTP ?? '123456',

  defaultAdmin: {
    name: process.env.DEFAULT_ADMIN_NAME ?? 'Admin',
    email: process.env.DEFAULT_ADMIN_EMAIL ?? 'admin@verdant.com',
    password: process.env.DEFAULT_ADMIN_PASSWORD ?? 'verdant@123',
  },

  corsOrigins: (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};
