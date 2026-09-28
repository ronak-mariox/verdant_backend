import type { Request, Response } from 'express';
import { SupportTicket, type SupportTicketPriority, type SupportTicketStatus } from '../models/SupportTicket';
import { objectPagination, toSafeJson } from '../lib/sanitize';
import { HttpError } from '../lib/httpError';

export async function listTickets(req: Request, res: Response) {
  const { status, priority } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (priority) filter.priority = priority;

  const { page, limit, skip } = objectPagination(req.query as Record<string, unknown>);

  const [items, total] = await Promise.all([
    SupportTicket.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    SupportTicket.countDocuments(filter),
  ]);
  res.json({ items: items.map((t) => toSafeJson(t)), page, limit, total, totalPages: Math.ceil(total / limit) });
}

export async function updateTicket(req: Request, res: Response) {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw new HttpError(404, 'Support ticket not found');

  const { status, priority, note } = req.body as { status?: SupportTicketStatus; priority?: SupportTicketPriority; note?: string };
  if (status !== undefined) {
    ticket.status = status;
    ticket.resolvedAt = status === 'resolved' ? new Date() : undefined;
  }
  if (priority !== undefined) ticket.priority = priority;
  if (note) ticket.notes.push({ text: note, at: new Date() });
  await ticket.save();

  res.json(toSafeJson(ticket));
}
