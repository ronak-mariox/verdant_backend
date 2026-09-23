import { Schema, model } from 'mongoose';

// Shapes match vender_app's RegistrationContext exactly — stored as native nested
// documents (not stringified JSON) so Mongo can query into them if ever needed.
export interface BusinessInfoData {
  legalName: string;
  displayName: string;
  category: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
}

export interface OwnerInfoData {
  fullName: string;
  mobile: string;
  email: string;
  dob: string;
  pan: string;
}

export interface StoreInfoData {
  storeName: string;
  storeAddress: string;
  landmark?: string;
  contactNumber: string;
  storeType: string;
  operatingHours: string;
  location: { address: string; cityState: string; latitude: number; longitude: number };
}

export interface GstDetailsData {
  registered: boolean;
  gstin?: string;
  businessName?: string;
  registrationDate?: string;
  category?: string;
  certificateUrl?: string;
}

export interface PanDetailsData {
  panNumber: string;
  holderName: string;
  dob: string;
  panType: string;
  documentUrl?: string;
}

export interface BusinessProofData {
  documentType: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  frontUrl: string;
  backUrl?: string;
}

export interface BankDetailsData {
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  bankName?: string;
  branch?: string;
  accountType: string;
  upiId?: string;
}

/** Additional pickup/warehouse addresses a vendor keeps on file, distinct from
 * the single registration business address and store-setup address above. */
export interface VendorAddressData {
  id: string;
  label: string;
  line1: string;
  line2?: string;
  isPrimary: boolean;
  lat?: number;
  lng?: number;
}

/** Arbitrary KYC/supporting documents beyond the fixed businessProof/gst/pan
 * uploads — e.g. FSSAI license, shop act license — managed from the Profile tab. */
export interface AdditionalDocumentData {
  id: string;
  name: string;
  url: string;
  uploadedAt: Date;
}

export type BankDetailsRequestStatus = 'pending' | 'approved' | 'rejected';

/** A vendor-submitted request to change their live bank details. It never
 * applies automatically — an admin must approve it before `bankDetails` changes. */
export interface PendingBankDetailsData {
  data: BankDetailsData;
  status: BankDetailsRequestStatus;
  submittedAt: Date;
  reviewNote?: string;
  reviewedAt?: Date;
}

// ---------------------------------------------------------------------------
// Store setup — the post-approval wizard (StoreSetupContext in vender_app),
// separate from the pre-approval business-registration wizard above.
// ---------------------------------------------------------------------------

export interface StoreProfileData {
  storeName: string;
  description: string;
  primaryCategory: string;
  subCategory: string;
  tags: string[];
  minimumOrderValue: string;
  avgPrepTime: string;
}

export interface StoreSetupLocationData {
  address: string;
  cityState: string;
  latitude: number;
  longitude: number;
}

export interface StoreSetupAddressData {
  buildingShopNo: string;
  street: string;
  landmark: string;
  area: string;
  pincode: string;
  city: string;
  state: string;
  contactNumber: string;
  sameAsBusinessAddress: boolean;
  location: StoreSetupLocationData;
}

export interface DayScheduleData {
  day: string;
  open: string;
  close: string;
  isOpen: boolean;
}

export interface OperatingHoursData {
  sameEveryDay: boolean;
  defaultOpen: string;
  defaultClose: string;
  breakEnabled: boolean;
  weeklySchedule: DayScheduleData[];
}

export interface HolidayClosureItem {
  id: string;
  title: string;
  date: string;
  daysClosed: number;
  note: string;
}

export interface DeliverySlabData {
  id: string;
  range: string;
  charge: string;
}

export interface DeliverySettingsData {
  fulfillmentType: 'delivery' | 'pickup' | 'both';
  deliveryRadiusKm: number;
  minimumOrderForDelivery: string;
  chargeType: string;
  slabs: DeliverySlabData[];
  freeDeliveryAbove: string;
}

export interface DeliverySlotData {
  id: string;
  label: string;
  window: string;
  totalSlots: number;
  usedSlots: number;
}

export interface ServiceAvailabilityData {
  slotsEnabled: boolean;
  slots: DeliverySlotData[];
  maxSimultaneousOrders: string;
  autoPauseAtCapacity: boolean;
}

export type StoreStatusValue = 'open' | 'closed' | 'temporarily-closed';

export interface TempClosureData {
  reason: string;
  customMessage: string;
  fromDate: string;
  toDate: string;
  closeFromTime: string;
  reopenAt: string;
  notifyCustomers: boolean;
}

export type RegistrationStepKey =
  | 'businessType'
  | 'businessInfo'
  | 'ownerInfo'
  | 'storeInfo'
  | 'gstDetails'
  | 'panDetails'
  | 'businessProof'
  | 'bankDetails';

export type StepReviewStatus = 'pending' | 'verified' | 'rejected';

export interface StepReview {
  status: StepReviewStatus;
  note?: string;
  reviewedAt?: Date;
}

export interface VendorDoc {
  _id: unknown;
  phone: string;
  email?: string;
  passwordHash?: string;
  fullName?: string;
  avatarUrl?: string;

  status: 'pending' | 'active' | 'suspended' | 'rejected';
  kycStatus: 'pending' | 'verified' | 'rejected';
  registrationStep: string;
  referenceId?: string;

  businessType?: 'individual' | 'proprietorship' | 'partnership' | 'private-limited' | 'other';
  businessInfo?: BusinessInfoData;
  ownerInfo?: OwnerInfoData;
  storeInfo?: StoreInfoData;
  gstDetails?: GstDetailsData;
  panDetails?: PanDetailsData;
  businessProof?: BusinessProofData;
  bankDetails?: BankDetailsData;

  /** Per-step admin review, keyed by the same step names as the fields above —
   * lets an admin verify/reject individual registration steps (with a note) as
   * they work through an application, ahead of the final overall approve/reject. */
  stepReviews?: Partial<Record<RegistrationStepKey, StepReview>>;

  rejectionReason?: string;

  /** Extra addresses (e.g. a separate warehouse) beyond the single business/store
   * addresses above — managed post-approval from the Profile tab. */
  addresses: VendorAddressData[];

  /** Arbitrary supporting documents beyond the fixed KYC uploads. */
  additionalDocuments: AdditionalDocumentData[];

  /** Outstanding request to change live bank details — set by the vendor,
   * cleared/applied only by admin approval. Only one may be pending at a time. */
  pendingBankDetails?: PendingBankDetailsData;

  /** Which notification categories this vendor wants — keyed the same as
   * vender_app's NotificationPref list. Missing keys default to enabled. */
  notificationPrefs?: Record<string, boolean>;

  // Store setup (post-approval wizard)
  storeSetupStep: string;
  storeSetupCompletedAt?: Date;
  storeProfile?: StoreProfileData;
  storeLogoUrl?: string;
  storeCoverImageUrl?: string;
  storeSetupAddress?: StoreSetupAddressData;
  operatingHours?: OperatingHoursData;
  holidays: HolidayClosureItem[];
  deliverySettings?: DeliverySettingsData;
  serviceAvailability?: ServiceAvailabilityData;
  storeStatus: StoreStatusValue;
  storeStatusSetAt?: Date;
  tempClosure?: TempClosureData;

  createdAt: Date;
  updatedAt: Date;
}

const vendorSchema = new Schema<VendorDoc>(
  {
    phone: { type: String, required: true, unique: true },
    email: { type: String, unique: true, sparse: true },
    passwordHash: String,
    fullName: String,
    avatarUrl: String,

    status: { type: String, enum: ['pending', 'active', 'suspended', 'rejected'], default: 'pending' },
    kycStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    registrationStep: { type: String, default: 'account' },
    referenceId: String,

    businessType: { type: String, enum: ['individual', 'proprietorship', 'partnership', 'private-limited', 'other'] },
    businessInfo: { type: Schema.Types.Mixed },
    ownerInfo: { type: Schema.Types.Mixed },
    storeInfo: { type: Schema.Types.Mixed },
    gstDetails: { type: Schema.Types.Mixed },
    panDetails: { type: Schema.Types.Mixed },
    businessProof: { type: Schema.Types.Mixed },
    bankDetails: { type: Schema.Types.Mixed },
    stepReviews: { type: Schema.Types.Mixed, default: {} },

    rejectionReason: String,

    addresses: { type: [Schema.Types.Mixed] as unknown as VendorAddressData[], default: [] },
    additionalDocuments: { type: [Schema.Types.Mixed] as unknown as AdditionalDocumentData[], default: [] },
    pendingBankDetails: { type: Schema.Types.Mixed },
    notificationPrefs: { type: Schema.Types.Mixed, default: {} },

    storeSetupStep: { type: String, default: 'profile' },
    storeSetupCompletedAt: Date,
    storeProfile: { type: Schema.Types.Mixed },
    storeLogoUrl: String,
    storeCoverImageUrl: String,
    storeSetupAddress: { type: Schema.Types.Mixed },
    operatingHours: { type: Schema.Types.Mixed },
    holidays: { type: [Schema.Types.Mixed] as unknown as HolidayClosureItem[], default: [] },
    deliverySettings: { type: Schema.Types.Mixed },
    serviceAvailability: { type: Schema.Types.Mixed },
    storeStatus: { type: String, enum: ['open', 'closed', 'temporarily-closed'], default: 'open' },
    storeStatusSetAt: Date,
    tempClosure: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export const Vendor = model<VendorDoc>('Vendor', vendorSchema);
