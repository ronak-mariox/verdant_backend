import { Schema, model, Types } from 'mongoose';

export interface LocationShareDoc {
  _id: unknown;
  driverId: Types.ObjectId;
  orderId?: Types.ObjectId;
  incidentId?: Types.ObjectId;
  lat: number;
  lng: number;
  accuracy?: number;
  sharedWithEmergency: boolean;
  sharedWithSupport: boolean;
  sharedWithContact: boolean;
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const locationShareSchema = new Schema<LocationShareDoc>(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    incidentId: { type: Schema.Types.ObjectId, ref: 'EmergencyIncident' },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: Number,
    sharedWithEmergency: { type: Boolean, default: false },
    sharedWithSupport: { type: Boolean, default: false },
    sharedWithContact: { type: Boolean, default: false },
    startedAt: { type: Date, required: true },
    endedAt: Date,
  },
  { timestamps: true },
);

locationShareSchema.index({ driverId: 1, createdAt: -1 });

export const LocationShare = model<LocationShareDoc>('LocationShare', locationShareSchema);
