import { Schema, model, Types } from 'mongoose';

export type SupportTicketRaisedByType = 'customer' | 'vendor' | 'driver';
export type SupportTicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'escalated';

export interface SupportTicketNote {
  text: string;
  at: Date;
}

export interface SupportTicketDoc {
  _id: unknown;
  raisedByType: SupportTicketRaisedByType;
  raisedById: Types.ObjectId;
  raisedByName: string;
  subject: string;
  description?: string;
  category: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  orderId?: Types.ObjectId;
  notes: SupportTicketNote[];
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const supportTicketNoteSchema = new Schema<SupportTicketNote>(
  {
    text: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const supportTicketSchema = new Schema<SupportTicketDoc>(
  {
    raisedByType: { type: String, enum: ['customer', 'vendor', 'driver'], required: true },
    raisedById: { type: Schema.Types.ObjectId, required: true },
    raisedByName: { type: String, required: true },
    subject: { type: String, required: true },
    description: String,
    category: { type: String, required: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], required: true, default: 'medium' },
    status: { type: String, enum: ['open', 'in_progress', 'resolved', 'escalated'], required: true, default: 'open' },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    notes: { type: [supportTicketNoteSchema], default: [] },
    resolvedAt: Date,
  },
  { timestamps: true },
);

supportTicketSchema.index({ status: 1, createdAt: -1 });

export const SupportTicket = model<SupportTicketDoc>('SupportTicket', supportTicketSchema);
