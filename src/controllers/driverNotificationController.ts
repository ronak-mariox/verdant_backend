import type { Request, Response } from 'express';
import { DriverNotification } from '../models/DriverNotification';
import { toSafeJson } from '../lib/sanitize';
import { HttpError } from '../lib/httpError';

export async function listNotifications(req: Request, res: Response) {
  const notifications = await DriverNotification.find({ driverId: req.user!.id }).sort({ createdAt: -1 }).limit(100);
  res.json(notifications.map((n) => toSafeJson(n)));
}

export async function getUnreadCount(req: Request, res: Response) {
  const count = await DriverNotification.countDocuments({ driverId: req.user!.id, isRead: false });
  res.json({ count });
}

export async function markRead(req: Request, res: Response) {
  const notification = await DriverNotification.findOneAndUpdate(
    { _id: req.params.id, driverId: req.user!.id },
    { isRead: true },
    { new: true },
  );
  if (!notification) throw new HttpError(404, 'Notification not found');
  res.json(toSafeJson(notification));
}

export async function markAllRead(req: Request, res: Response) {
  await DriverNotification.updateMany({ driverId: req.user!.id, isRead: false }, { isRead: true });
  res.json({ ok: true });
}

export async function markUnread(req: Request, res: Response) {
  const { ids } = req.body as { ids: string[] };
  await DriverNotification.updateMany({ _id: { $in: ids }, driverId: req.user!.id }, { isRead: false });
  res.json({ ok: true });
}

export async function dismissNotification(req: Request, res: Response) {
  const result = await DriverNotification.findOneAndDelete({ _id: req.params.id, driverId: req.user!.id });
  if (!result) throw new HttpError(404, 'Notification not found');
  res.status(204).end();
}

export async function clearAll(req: Request, res: Response) {
  await DriverNotification.deleteMany({ driverId: req.user!.id });
  res.status(204).end();
}
