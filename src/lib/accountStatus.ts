import { Customer } from '../models/Customer';
import { Vendor } from '../models/Vendor';
import { Driver } from '../models/Driver';
import { Admin } from '../models/Admin';
import type { Role } from './jwt';

export type AccountCheck =
  | { ok: true; status?: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'account_restricted'; status: string };

// Only a suspension locks an account out. A rejected applicant must still be able to sign in,
// read why they were rejected and resubmit; they can't trade or deliver because those
// features require status 'active'.
const RESTRICTED_VENDOR_DRIVER = new Set(['suspended']);

/** Loads the account behind a token and says whether it may still use the API. */
export async function checkAccountStatus(role: Role, id: string): Promise<AccountCheck> {
  if (role === 'customer') {
    const customer = await Customer.findById(id).select('status');
    if (!customer) return { ok: false, reason: 'not_found' };
    if (customer.status === 'blocked') return { ok: false, reason: 'account_restricted', status: customer.status };
    return { ok: true, status: customer.status };
  }
  if (role === 'vendor' || role === 'driver') {
    const account = role === 'vendor' ? await Vendor.findById(id).select('status') : await Driver.findById(id).select('status');
    if (!account) return { ok: false, reason: 'not_found' };
    if (RESTRICTED_VENDOR_DRIVER.has(account.status)) return { ok: false, reason: 'account_restricted', status: account.status };
    return { ok: true, status: account.status };
  }
  const admin = await Admin.findById(id).select('_id');
  if (!admin) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

export function restrictedMessage(role: Role): string {
  if (role === 'customer') return 'This account has been blocked. Contact support for help.';
  return 'This account has been suspended. Contact support for help.';
}

export function restrictedBody(role: Role, status: string) {
  return { error: restrictedMessage(role), reason: 'account_restricted' as const, status };
}
