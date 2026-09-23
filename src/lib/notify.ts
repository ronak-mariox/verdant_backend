import { Notification, type NotificationKind } from '../models/Notification';
import type { OrderStatus } from '../models/Order';

export async function notifyCustomer(
  customerId: unknown,
  kind: NotificationKind,
  title: string,
  body: string,
  orderId?: unknown,
) {
  await Notification.create({ customerId: customerId as never, kind, title, body, orderId: orderId as never });
}

type StatusNotificationBuilder = (orderNumber: string, note?: string) => { kind: NotificationKind; title: string; body: string };

/** Only statuses worth interrupting the customer for get an entry here — routine
 * internal steps (e.g. "preparing") don't. */
const STATUS_NOTIFICATIONS: Partial<Record<OrderStatus, StatusNotificationBuilder>> = {
  accepted: (orderNumber) => ({
    kind: 'order',
    title: 'Order confirmed',
    body: `Your order #${orderNumber} has been confirmed and is being prepared.`,
  }),
  out_for_delivery: (orderNumber) => ({
    kind: 'order',
    title: 'Out for delivery',
    body: `Your order #${orderNumber} is on its way!`,
  }),
  delivered: (orderNumber) => ({
    kind: 'delivered',
    title: 'Order delivered',
    body: `Your order #${orderNumber} has been delivered. Enjoy!`,
  }),
  rejected: (orderNumber, note) => ({
    kind: 'order',
    title: 'Order rejected',
    body: note ? `Your order #${orderNumber} was rejected: ${note}` : `Your order #${orderNumber} was rejected by the store.`,
  }),
  cancelled: (orderNumber, note) => ({
    kind: 'refund',
    title: 'Order cancelled',
    body: note ? `Your order #${orderNumber} was cancelled: ${note}` : `Your order #${orderNumber} has been cancelled.`,
  }),
};

export async function notifyOrderStatusChange(
  customerId: unknown,
  orderId: unknown,
  orderNumber: string,
  status: OrderStatus,
  note?: string,
) {
  const build = STATUS_NOTIFICATIONS[status];
  if (!build) return;
  const { kind, title, body } = build(orderNumber, note);
  await notifyCustomer(customerId, kind, title, body, orderId);
}
