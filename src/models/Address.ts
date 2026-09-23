import { Schema, model, Types } from 'mongoose';

export interface AddressDoc {
  _id: unknown;
  customerId: Types.ObjectId;
  label: 'home' | 'work' | 'other';
  contactName?: string;
  contactPhone?: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema<AddressDoc>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    label: { type: String, enum: ['home', 'work', 'other'], default: 'home' },
    contactName: String,
    contactPhone: String,
    line1: { type: String, required: true },
    line2: String,
    landmark: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    latitude: Number,
    longitude: Number,
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

addressSchema.index({ customerId: 1 });

export const Address = model<AddressDoc>('Address', addressSchema);
