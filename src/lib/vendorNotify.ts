import { VendorNotification, type VendorNotificationCategory } from '../models/VendorNotification';
import { Vendor } from '../models/Vendor';

/** New-order alerts are what the vendor app polls for, so they can't be muted. */
const ALWAYS_ON: VendorNotificationCategory[] = ['new-order'];

/** The vendor app's settings screen uses its own key names for some categories. */
const PREF_KEY_ALIASES: Partial<Record<VendorNotificationCategory, string>> = {
  'order-cancellation': 'order-cancelled',
  payment: 'payment-received',
  settlement: 'settlement-credited',
};

function isMuted(prefs: Record<string, boolean> | undefined, category: VendorNotificationCategory): boolean {
  if (!prefs) return false;
  const alias = PREF_KEY_ALIASES[category];
  return prefs[category] === false || (alias !== undefined && prefs[alias] === false);
}

export async function notifyVendor(
  vendorId: unknown,
  category: VendorNotificationCategory,
  title: string,
  subtitle: string,
  refs?: { orderId?: unknown; orderNumber?: string; productId?: unknown; productName?: string },
) {
  if (!ALWAYS_ON.includes(category)) {
    const vendor = await Vendor.findById(vendorId).select('notificationPrefs');
    if (isMuted(vendor?.notificationPrefs, category)) return;
  }

  await VendorNotification.create({
    vendorId: vendorId as never,
    category,
    title,
    subtitle,
    orderId: refs?.orderId as never,
    orderNumber: refs?.orderNumber,
    productId: refs?.productId as never,
    productName: refs?.productName,
  });
}
