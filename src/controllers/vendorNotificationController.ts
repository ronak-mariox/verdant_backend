import type { Request, Response } from 'express';
import { VendorNotification } from '../models/VendorNotification';
import { toSafeJson } from '../lib/sanitize';
import { HttpError } from '../lib/httpError';

export async function listNotifications(req: Request, res: Response) {
  const notifications = await VendorNotification.find({ vendorId: req.user!.id }).sort({ createdAt: -1 }).limit(100);
  res.json(notifications.map((n) => toSafeJson(n)));
}

export async function getUnreadCount(req: Request, res: Response) {
  const count = await VendorNotification.countDocuments({ vendorId: req.user!.id, isRead: false });
  res.json({ count });
}

export async function markRead(req: Request, res: Response) {
  const notification = await VendorNotification.findOneAndUpdate(
    { _id: req.params.id, vendorId: req.user!.id },
    { isRead: true },
    { new: true },
  );
  if (!notification) throw new HttpError(404, 'Notification not found');
  res.json(toSafeJson(notification));
}

export async function markAllRead(req: Request, res: Response) {
  await VendorNotification.updateMany({ vendorId: req.user!.id, isRead: false }, { isRead: true });
  res.json({ ok: true });
}

/** Powers the "Undo" toast after mark-all-read — restores unread state for the
 * specific notifications the client knows it just marked read, rather than
 * guessing which ones to revert. */
export async function markUnread(req: Request, res: Response) {
  const { ids } = req.body as { ids: string[] };
  await VendorNotification.updateMany({ _id: { $in: ids }, vendorId: req.user!.id }, { isRead: false });
  res.json({ ok: true });
}

export async function dismissNotification(req: Request, res: Response) {
  const result = await VendorNotification.findOneAndDelete({ _id: req.params.id, vendorId: req.user!.id });
  if (!result) throw new HttpError(404, 'Notification not found');
  res.status(204).end();
}

export async function clearAll(req: Request, res: Response) {
  await VendorNotification.deleteMany({ vendorId: req.user!.id });
  res.status(204).end();
}
