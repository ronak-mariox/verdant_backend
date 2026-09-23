import { Schema, model, Types } from 'mongoose';

export type EmergencyIncidentType =
  | 'accident'
  | 'medical'
  | 'harassment'
  | 'theft'
  | 'vehicle_breakdown'
  | 'other';

export type EmergencyIncidentStatus = 'notified' | 'reviewing' | 'follow_up_scheduled' | 'resolved';

export interface EmergencyIncidentDoc {
  _id: unknown;
  driverId: Types.ObjectId;
  orderId?: Types.ObjectId;
  type: EmergencyIncidentType;
  description?: string;
  medicalNeeded: boolean;
  evidenceUrls: string[];
  location?: { lat: number; lng: number; address?: string };
  occurredAt: Date;
  status: EmergencyIncidentStatus;
  resolvedAt?: Date;
  actionTaken?: string;
  earningsProtectedAmount?: number;
  orderReassigned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const emergencyIncidentSchema = new Schema<EmergencyIncidentDoc>(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    type: {
      type: String,
      enum: ['accident', 'medical', 'harassment', 'theft', 'vehicle_breakdown', 'other'],
      required: true,
    },
    description: String,
    medicalNeeded: { type: Boolean, default: false },
    evidenceUrls: { type: [String], default: [] },
    location: { type: Schema.Types.Mixed },
    occurredAt: { type: Date, required: true },
    status: { type: String, enum: ['notified', 'reviewing', 'follow_up_scheduled', 'resolved'], default: 'notified' },
    resolvedAt: Date,
    actionTaken: String,
    earningsProtectedAmount: Number,
    orderReassigned: { type: Boolean, default: false },
  },
  { timestamps: true },
);

emergencyIncidentSchema.index({ driverId: 1, createdAt: -1 });

export const EmergencyIncident = model<EmergencyIncidentDoc>('EmergencyIncident', emergencyIncidentSchema);
