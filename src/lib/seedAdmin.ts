import bcrypt from 'bcryptjs';
import { Admin } from '../models/Admin';
import { env } from './env';

/** Idempotent — only fills in the default admin if none exists yet with that email. */
export async function ensureDefaultAdmin(): Promise<void> {
  const existing = await Admin.findOne({ email: env.defaultAdmin.email });
  if (existing) return;

  const passwordHash = await bcrypt.hash(env.defaultAdmin.password, 10);
  await Admin.create({
    name: env.defaultAdmin.name,
    email: env.defaultAdmin.email,
    passwordHash,
    role: 'super_admin',
  });
  // eslint-disable-next-line no-console
  console.log(`[seed] Created default admin: ${env.defaultAdmin.email}`);
}
