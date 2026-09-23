import { Schema, model } from 'mongoose';

export interface DriverAddressData {
  line1: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  addressType: 'home' | 'work' | 'other';
}

export interface EmergencyContactData {
  name: string;
  relationship: string;
  mobile: string;
  altMobile?: string;
}

export interface VehicleDetailsData {
  registrationNumber: string;
  brand: string;
  model: string;
  year: number;
  fuelType: string;
  color: string;
  capacity?: string;
}

export interface InsuranceDetailsData {
  insuranceType: string;
  policyNumber: string;
  validFrom: string;
  validUntil: string;
}

export interface DriverBankDetailsData {
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  upiId?: string;
}

export type DriverDocumentType = 'license_front' | 'license_back' | 'rc' | 'insurance';

export interface DriverDoc {
  _id: unknown;
  phone: string;
  fullName?: string;
  email?: string;
  dob?: string;
  gender?: 'female' | 'male' | 'other';
  avatarUrl?: string;

  status: 'pending' | 'active' | 'suspended' | 'rejected';
  kycStatus: 'pending' | 'verified' | 'rejected';
  registrationStep: string;
  referenceId?: string;

  address?: DriverAddressData;
  emergencyContact?: EmergencyContactData;
  vehicleType?: 'motorbike' | 'scooter' | 'bicycle' | 'other';
  vehicleDetails?: VehicleDetailsData;
  documents?: Partial<Record<DriverDocumentType, string>>;
  insuranceDetails?: InsuranceDetailsData;
  bankDetails?: DriverBankDetailsData;

  rejectionReason?: string;

  isOnline: boolean;
  currentLocation?: { lat: number; lng: number; updatedAt: Date };

  createdAt: Date;
  updatedAt: Date;
}

const driverSchema = new Schema<DriverDoc>(
  {
    phone: { type: String, required: true, unique: true },
    fullName: String,
    email: String,
    dob: String,
    gender: { type: String, enum: ['female', 'male', 'other'] },
    avatarUrl: String,

    status: { type: String, enum: ['pending', 'active', 'suspended', 'rejected'], default: 'pending' },
    kycStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    registrationStep: { type: String, default: 'mobile' },
    referenceId: String,

    address: { type: Schema.Types.Mixed },
    emergencyContact: { type: Schema.Types.Mixed },
    vehicleType: { type: String, enum: ['motorbike', 'scooter', 'bicycle', 'other'] },
    vehicleDetails: { type: Schema.Types.Mixed },
    documents: { type: Schema.Types.Mixed },
    insuranceDetails: { type: Schema.Types.Mixed },
    bankDetails: { type: Schema.Types.Mixed },

    rejectionReason: String,

    isOnline: { type: Boolean, default: false },
    currentLocation: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export const Driver = model<DriverDoc>('Driver', driverSchema);
