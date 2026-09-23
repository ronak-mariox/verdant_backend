import type { Request, Response } from 'express';
import { SupportTicket } from '../models/SupportTicket';
import { toSafeJson } from '../lib/sanitize';

export async function listTickets(req: Request, res: Response) {
  const { status, priority, page: pageRaw, limit: limitRaw } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (priority) filter.priority = priority;

  const page = Math.max(1, Number(pageRaw) || 1);
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 50));

  const [items, total] = await Promise.all([
    SupportTicket.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    SupportTicket.countDocuments(filter),
  ]);
  res.json({ items: items.map((t) => toSafeJson(t)), page, limit, total, totalPages: Math.ceil(total / limit) });
}
