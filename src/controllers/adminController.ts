import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Admin } from '../models/Admin';
import { Vendor, type RegistrationStepKey } from '../models/Vendor';
import { Driver } from '../models/Driver';
import { Customer } from '../models/Customer';
import { Order } from '../models/Order';
import { Product } from '../models/Product';
import { VendorSettlement } from '../models/VendorSettlement';
import { issueTokenPair } from '../lib/tokens';
import { toSafeJson } from '../lib/sanitize';
import { notifyVendor } from '../lib/vendorNotify';
import { HttpError } from '../lib/httpError';

export async function login(req: Request, res: Response) {
  const admin = await Admin.findOne({ email: req.body.email });
  if (!admin || !(await bcrypt.compare(req.body.password, admin.passwordHash))) {
    res.status(401).json({ error: 'Incorrect email or password' });
    return;
  }

  const tokens = await issueTokenPair(String(admin._id), 'admin');
  res.json({ ...tokens, admin: toSafeJson(admin, ['passwordHash']) });
}

export async function getMe(req: Request, res: Response) {
  const admin = await Admin.findById(req.user!.id);
  if (!admin) throw new HttpError(404, 'Admin not found');
  res.json(toSafeJson(admin, ['passwordHash']));
}

export async function getPendingVendors(_req: Request, res: Response) {
  const vendors = await Vendor.find({ status: 'pending', registrationStep: 'submitted' }).sort({ updatedAt: -1 });
  res.json(vendors.map((v) => toSafeJson(v, ['passwordHash'])));
}

export async function updateVendorStatus(req: Request, res: Response) {
  const vendor = await Vendor.findByIdAndUpdate(
    String(req.params.id),
    {
      $set: {
        status: req.body.status,
        kycStatus: req.body.kycStatus ?? (req.body.status === 'active' ? 'verified' : 'rejected'),
        rejectionReason: req.body.rejectionReason ?? null,
      },
    },
    { new: true },
  );
  if (!vendor) throw new HttpError(404, 'Vendor not found');

  if (req.body.status === 'active') {
    await notifyVendor(vendor._id, 'kyc-status', 'Application Approved', 'Your account is fully verified and active.');
  } else if (req.body.status === 'rejected') {
    await notifyVendor(
      vendor._id,
      'kyc-status',
      'Application Rejected',
      req.body.rejectionReason || 'Your registration was not approved.',
    );
  }

  res.json(toSafeJson(vendor, ['passwordHash']));
}

const REGISTRATION_STEP_KEYS: RegistrationStepKey[] = [
  'businessType',
  'businessInfo',
  'ownerInfo',
  'storeInfo',
  'gstDetails',
  'panDetails',
  'businessProof',
  'bankDetails',
];

/** Lets an admin verify/reject one registration step at a time (with a note),
 * ahead of the final overall approve/reject via updateVendorStatus above. */
export async function updateVendorStepReview(req: Request, res: Response) {
  const stepKey = req.params.stepKey as RegistrationStepKey;
  if (!REGISTRATION_STEP_KEYS.includes(stepKey)) {
    throw new HttpError(400, `Unknown registration step: ${req.params.stepKey}`);
  }

  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) throw new HttpError(404, 'Vendor not found');

  vendor.stepReviews = {
    ...(vendor.stepReviews ?? {}),
    [stepKey]: {
      status: req.body.status,
      note: req.body.note || undefined,
      reviewedAt: new Date(),
    },
  };
  await vendor.save();

  if (req.body.status === 'verified' || req.body.status === 'rejected') {
    await notifyVendor(
      vendor._id,
      'kyc-status',
      req.body.status === 'verified' ? `${stepKey} verified` : `${stepKey} needs attention`,
      req.body.status === 'rejected' && req.body.note ? req.body.note : `Your ${stepKey} step was ${req.body.status}.`,
    );
  }

  res.json(toSafeJson(vendor, ['passwordHash']));
}

export async function getPendingBankRequests(_req: Request, res: Response) {
  const vendors = await Vendor.find({ 'pendingBankDetails.status': 'pending' }).sort({ updatedAt: -1 });
  res.json(vendors.map((v) => toSafeJson(v, ['passwordHash'])));
}

export async function reviewBankRequest(req: Request, res: Response) {
  const vendor = await Vendor.findById(req.params.vendorId);
  if (!vendor) throw new HttpError(404, 'Vendor not found');
  if (vendor.pendingBankDetails?.status !== 'pending') {
    throw new HttpError(400, 'No pending bank details request for this vendor');
  }

  const { approve, note } = req.body as { approve: boolean; note?: string };

  if (approve) {
    vendor.bankDetails = vendor.pendingBankDetails.data;
    vendor.pendingBankDetails.status = 'approved';
    vendor.pendingBankDetails.reviewedAt = new Date();
    vendor.stepReviews = {
      ...(vendor.stepReviews ?? {}),
      bankDetails: { status: 'verified', reviewedAt: new Date() },
    };
    vendor.markModified('stepReviews');
  } else {
    vendor.pendingBankDetails.status = 'rejected';
    vendor.pendingBankDetails.reviewNote = note || undefined;
    vendor.pendingBankDetails.reviewedAt = new Date();
  }
  vendor.markModified('pendingBankDetails');
  await vendor.save();

  await notifyVendor(
    vendor._id,
    'kyc-status',
    approve ? 'Bank details updated' : 'Bank details change request rejected',
    approve ? 'Your bank details change request was approved.' : note || 'Your bank details change request was rejected.',
  );

  res.json(toSafeJson(vendor, ['passwordHash']));
}

export async function getVendorSettlements(req: Request, res: Response) {
  const settlements = await VendorSettlement.find({ vendorId: req.params.id })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(settlements.map((s) => toSafeJson(s)));
}

export async function getPendingDrivers(_req: Request, res: Response) {
  const drivers = await Driver.find({ status: 'pending', registrationStep: 'submitted' }).sort({ updatedAt: -1 });
  res.json(drivers);
}

export async function updateDriverStatus(req: Request, res: Response) {
  const driver = await Driver.findByIdAndUpdate(
    String(req.params.id),
    {
      $set: {
        status: req.body.status,
        kycStatus: req.body.kycStatus ?? (req.body.status === 'active' ? 'verified' : 'rejected'),
        rejectionReason: req.body.rejectionReason ?? null,
      },
    },
    { new: true },
  );
  if (!driver) throw new HttpError(404, 'Driver not found');
  res.json(driver);
}

// ---------------------------------------------------------------------------
// Directory listings — the full (not just pending) vendor/driver/customer
// rosters the admin panel's list/detail pages need.
// ---------------------------------------------------------------------------

export async function getAllVendors(req: Request, res: Response) {
  const { status, search } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { 'businessInfo.displayName': { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }
  const vendors = await Vendor.find(filter).sort({ createdAt: -1 });
  res.json(vendors.map((v) => toSafeJson(v, ['passwordHash'])));
}

export async function getVendorById(req: Request, res: Response) {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) throw new HttpError(404, 'Vendor not found');
  res.json(toSafeJson(vendor, ['passwordHash']));
}

export async function getAllDrivers(req: Request, res: Response) {
  const { status, search } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (search) {
    filter.$or = [{ fullName: { $regex: search, $options: 'i' } }, { phone: { $regex: search, $options: 'i' } }];
  }
  const drivers = await Driver.find(filter).sort({ createdAt: -1 });
  res.json(drivers.map((d) => toSafeJson(d)));
}

export async function getDriverById(req: Request, res: Response) {
  const driver = await Driver.findById(req.params.id);
  if (!driver) throw new HttpError(404, 'Driver not found');
  res.json(toSafeJson(driver));
}

export async function getAllCustomers(req: Request, res: Response) {
  const { status, search } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  const customers = await Customer.find(filter).sort({ createdAt: -1 });
  res.json(customers.map((c) => toSafeJson(c)));
}

export async function getCustomerById(req: Request, res: Response) {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new HttpError(404, 'Customer not found');
  res.json(toSafeJson(customer));
}

export async function updateCustomerStatus(req: Request, res: Response) {
  const customer = await Customer.findByIdAndUpdate(
    req.params.id,
    { $set: { status: req.body.status } },
    { new: true },
  );
  if (!customer) throw new HttpError(404, 'Customer not found');
  res.json(toSafeJson(customer));
}

// ---------------------------------------------------------------------------
// Dashboard — real aggregates over Order/Product/Vendor/Customer instead of
// the admin panel's previous client-side seeded-random numbers.
// ---------------------------------------------------------------------------

export async function getDashboard(_req: Request, res: Response) {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalOrders,
    ordersByStatusRaw,
    revenueAgg,
    pendingVendors,
    pendingProducts,
    totalCustomers,
    totalVendors,
    recentOrders,
    revenueByCategoryRaw,
  ] = await Promise.all([
    Order.countDocuments(),
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: since30d } } },
      { $group: { _id: null, revenue: { $sum: '$pricing.grandTotal' }, orders: { $sum: 1 } } },
    ]),
    Vendor.countDocuments({ status: 'pending', registrationStep: 'submitted' }),
    Product.countDocuments({ status: 'pending' }),
    Customer.countDocuments(),
    Vendor.countDocuments({ status: 'active' }),
    Order.find().sort({ createdAt: -1 }).limit(10),
    Order.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.productId', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $lookup: { from: 'categories', localField: 'product.categoryId', foreignField: '_id', as: 'category' } },
      { $unwind: '$category' },
      { $group: { _id: '$category.name', revenue: { $sum: '$items.subtotal' } } },
      { $sort: { revenue: -1 } },
      { $limit: 8 },
    ]),
  ]);

  const ordersByStatus = Object.fromEntries(ordersByStatusRaw.map((r) => [r._id, r.count]));

  res.json({
    totalOrders,
    ordersByStatus,
    last30Days: { revenue: revenueAgg[0]?.revenue ?? 0, orders: revenueAgg[0]?.orders ?? 0 },
    pendingVendorApprovals: pendingVendors,
    pendingProductApprovals: pendingProducts,
    totalCustomers,
    totalActiveVendors: totalVendors,
    recentOrders: recentOrders.map((o) => toSafeJson(o, ['deliveryOtpHash'])),
    revenueByCategory: revenueByCategoryRaw.map((r) => ({ category: r._id, revenue: r.revenue })),
  });
}
