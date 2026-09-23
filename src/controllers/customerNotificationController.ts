import type { Request, Response } from 'express';
import { Notification } from '../models/Notification';
import { toSafeJson } from '../lib/sanitize';
import { HttpError } from '../lib/httpError';

export async function listNotifications(req: Request, res: Response) {
  const notifications = await Notification.find({ customerId: req.user!.id }).sort({ createdAt: -1 }).limit(100);
  res.json(notifications.map((n) => toSafeJson(n)));
}

export async function getNotification(req: Request, res: Response) {
  const notification = await Notification.findOne({ _id: req.params.id, customerId: req.user!.id });
  if (!notification) throw new HttpError(404, 'Notification not found');
  res.json(toSafeJson(notification));
}

export async function getUnreadCount(req: Request, res: Response) {
  const count = await Notification.countDocuments({ customerId: req.user!.id, isRead: false });
  res.json({ count });
}

export async function markRead(req: Request, res: Response) {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, customerId: req.user!.id },
    { isRead: true },
    { new: true },
  );
  if (!notification) throw new HttpError(404, 'Notification not found');
  res.json(toSafeJson(notification));
}

export async function markAllRead(req: Request, res: Response) {
  await Notification.updateMany({ customerId: req.user!.id, isRead: false }, { isRead: true });
  res.json({ ok: true });
}
