import { VendorNotification, type VendorNotificationCategory } from '../models/VendorNotification';

export async function notifyVendor(
  vendorId: unknown,
  category: VendorNotificationCategory,
  title: string,
  subtitle: string,
  refs?: { orderId?: unknown; productId?: unknown; productName?: string },
) {
  await VendorNotification.create({
    vendorId: vendorId as never,
    category,
    title,
    subtitle,
    orderId: refs?.orderId as never,
    productId: refs?.productId as never,
    productName: refs?.productName,
  });
}
