import { DriverNotification, type DriverNotificationCategory } from '../models/DriverNotification';

export async function notifyDriver(
  driverId: unknown,
  category: DriverNotificationCategory,
  title: string,
  subtitle: string,
  refs?: { relatedEntityType?: string; relatedEntityId?: unknown; data?: Record<string, unknown> },
) {
  await DriverNotification.create({
    driverId: driverId as never,
    category,
    title,
    subtitle,
    relatedEntityType: refs?.relatedEntityType,
    relatedEntityId: refs?.relatedEntityId as never,
    data: refs?.data,
  });
}

export type DriverOrderEvent = 'order-assigned' | 'order-cancelled' | 'order-unassigned';

type OrderEventNotificationBuilder = (orderNumber: string, note?: string) => { title: string; subtitle: string };

const DRIVER_STATUS_NOTIFICATIONS: Record<DriverOrderEvent, OrderEventNotificationBuilder> = {
  'order-assigned': (orderNumber) => ({
    title: 'New delivery assigned',
    subtitle: `Order #${orderNumber} is ready for pickup.`,
  }),
  'order-cancelled': (orderNumber, note) => ({
    title: 'Delivery cancelled',
    subtitle: note ? `Order #${orderNumber} was cancelled: ${note}` : `Order #${orderNumber} was cancelled.`,
  }),
  'order-unassigned': (orderNumber, note) => ({
    title: 'Delivery reassigned',
    subtitle: note ? `Order #${orderNumber} was reassigned: ${note}` : `Order #${orderNumber} was reassigned to another rider.`,
  }),
};

export async function notifyDriverOrderEvent(
  driverId: unknown,
  event: DriverOrderEvent,
  orderId: unknown,
  orderNumber: string,
  note?: string,
) {
  const { title, subtitle } = DRIVER_STATUS_NOTIFICATIONS[event](orderNumber, note);
  await notifyDriver(driverId, 'Orders', title, subtitle, {
    relatedEntityType: 'Order',
    relatedEntityId: orderId,
    data: { orderId: String(orderId), orderNumber },
  });
}

export type DriverAccountEvent = 'active' | 'rejected' | 'suspended';

const DRIVER_ACCOUNT_NOTIFICATIONS: Record<DriverAccountEvent, (reason?: string) => { title: string; subtitle: string }> = {
  active: () => ({ title: 'Application approved', subtitle: 'Your rider account is verified and active. Go online to start receiving orders.' }),
  rejected: (reason) => ({ title: 'Application rejected', subtitle: reason || 'Your registration was not approved.' }),
  suspended: (reason) => ({ title: 'Account suspended', subtitle: reason || 'Your account has been suspended. Contact support for help.' }),
};

export async function notifyDriverAccountEvent(driverId: unknown, event: DriverAccountEvent, reason?: string) {
  const { title, subtitle } = DRIVER_ACCOUNT_NOTIFICATIONS[event](reason);
  await notifyDriver(driverId, 'Account', title, subtitle, { relatedEntityType: 'Driver', relatedEntityId: driverId });
}
