import { Notification, type NotificationKind } from '../models/Notification';
import type { OrderDoc, OrderStatus } from '../models/Order';

export async function notifyCustomer(
  customerId: unknown,
  kind: NotificationKind,
  title: string,
  body: string,
  order?: { _id: unknown; orderNumber: string } | null,
  data?: Record<string, unknown>,
) {
  await Notification.create({
    customerId: customerId as never,
    kind,
    title,
    body,
    orderId: order?._id as never,
    orderNumber: order?.orderNumber,
    data: order ? { orderId: String(order._id), orderNumber: order.orderNumber, ...data } : data,
  });
}

type OrderForNotification = Pick<OrderDoc, '_id' | 'customerId' | 'orderNumber' | 'paymentStatus'> & { deliveryOtp?: string };

type StatusNotificationBuilder = (
  order: OrderForNotification,
  note?: string,
) => { kind: NotificationKind; title: string; body: string; data?: Record<string, unknown> };

/** Only statuses worth interrupting the customer for get an entry here — routine
 * internal steps (e.g. "preparing") don't. */
const STATUS_NOTIFICATIONS: Partial<Record<OrderStatus, StatusNotificationBuilder>> = {
  accepted: ({ orderNumber }) => ({
    kind: 'order',
    title: 'Order confirmed',
    body: `Your order #${orderNumber} has been confirmed and is being prepared.`,
  }),
  out_for_delivery: ({ orderNumber, deliveryOtp }) => ({
    kind: 'order',
    title: 'Out for delivery',
    body: deliveryOtp
      ? `Your order #${orderNumber} is on its way! Share OTP ${deliveryOtp} with your delivery partner to receive it.`
      : `Your order #${orderNumber} is on its way!`,
    data: deliveryOtp ? { deliveryOtp } : undefined,
  }),
  delivered: ({ orderNumber }) => ({
    kind: 'delivered',
    title: 'Order delivered',
    body: `Your order #${orderNumber} has been delivered. Enjoy!`,
  }),
  rejected: ({ orderNumber, paymentStatus }, note) => ({
    kind: paymentStatus === 'paid' ? 'refund' : 'order',
    title: 'Order rejected',
    body: note ? `Your order #${orderNumber} was rejected: ${note}` : `Your order #${orderNumber} was rejected by the store.`,
  }),
  cancelled: ({ orderNumber, paymentStatus }, note) => ({
    kind: paymentStatus === 'paid' ? 'refund' : 'order',
    title: 'Order cancelled',
    body:
      (note ? `Your order #${orderNumber} was cancelled: ${note}` : `Your order #${orderNumber} has been cancelled.`) +
      (paymentStatus === 'paid' ? ' Your refund is being processed.' : ''),
  }),
};

export async function notifyOrderStatusChange(order: OrderForNotification, status: OrderStatus, note?: string) {
  const build = STATUS_NOTIFICATIONS[status];
  if (!build) return;
  const { kind, title, body, data } = build(order, note);
  await notifyCustomer(order.customerId, kind, title, body, order, data);
}
