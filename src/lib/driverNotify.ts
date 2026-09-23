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

export type DriverOrderEvent = 'order-assigned' | 'order-cancelled';

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
};

export async function notifyDriverOrderEvent(
  driverId: unknown,
  event: DriverOrderEvent,
  orderId: unknown,
  orderNumber: string,
  note?: string,
) {
  const { title, subtitle } = DRIVER_STATUS_NOTIFICATIONS[event](orderNumber, note);
  await notifyDriver(driverId, 'Orders', title, subtitle, { relatedEntityType: 'Order', relatedEntityId: orderId });
}
