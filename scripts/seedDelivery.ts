import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { connectDb, mongoose } from '../src/lib/db';
import { Vendor } from '../src/models/Vendor';
import { Product, type ProductDoc } from '../src/models/Product';
import { Customer } from '../src/models/Customer';
import { Address } from '../src/models/Address';
import { Driver } from '../src/models/Driver';
import { Order, type OrderItemSnapshot, type OrderPricing, type OrderStatus } from '../src/models/Order';
import { EarningsLedger } from '../src/models/EarningsLedger';
import { Incentive } from '../src/models/Incentive';
import { priceLine, computeOrderPricing } from '../src/lib/pricing';
import { DRIVER_BASE_PAY, getDriverBalance } from '../src/lib/driverEarnings';

declare const process: {
  exitCode?: number;
};

function generateOrderNumber(): string {
  const year = new Date().getFullYear();
  return `VR-${year}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function minutesAgo(mins: number): Date {
  return new Date(Date.now() - mins * 60 * 1000);
}

/**
 * Dev-only convenience seed for the delivery-partner order flow (available →
 * accepted → picked up → delivered/cancelled), so the DeliveryApp has real
 * orders to render instead of dummy/hardcoded arrays. Idempotent — safe to
 * re-run. Depends on `npm run seed:catalog` having been run first (reuses its
 * demo vendor + products); run `npm run seed:catalog && npm run seed:delivery`.
 */
async function main() {
  await connectDb();

  const vendor = await Vendor.findOne({ phone: '9876500001' });
  if (!vendor) {
    throw new Error('Demo vendor not found — run `npm run seed:catalog` first.');
  }

  // The catalog seed never sets a store location, but the driver flow needs one
  // (pickup address shown to the driver, distance sorting, distance-based earnings
  // bonus) — backfill it onto the same demo vendor rather than inventing a new one.
  if (!vendor.storeSetupAddress) {
    vendor.storeSetupAddress = {
      buildingShopNo: '12/A',
      street: '80 Feet Road',
      landmark: 'Near Forum Mall',
      area: 'Koramangala 5th Block',
      pincode: '560095',
      city: 'Bengaluru',
      state: 'Karnataka',
      contactNumber: vendor.phone,
      sameAsBusinessAddress: false,
      location: { address: '80 Feet Road, Koramangala', cityState: 'Bengaluru, Karnataka', latitude: 12.9352, longitude: 77.6146 },
    };
    await vendor.save();
    console.log('Backfilled storeSetupAddress onto demo vendor.');
  }
  const vendorLoc = vendor.storeSetupAddress.location;

  const products = await Product.find({ vendorId: vendor._id }).limit(6);
  if (products.length === 0) {
    throw new Error('No demo products found — run `npm run seed:catalog` first.');
  }

  // --- Demo driver -----------------------------------------------------------
  const driverPhone = '9876511111';
  let driver = await Driver.findOne({ phone: driverPhone });
  if (!driver) {
    driver = await Driver.create({
      phone: driverPhone,
      fullName: 'Demo Driver',
      email: 'demo.driver@verdant.com',
      dob: '1998-05-14',
      gender: 'male',
      status: 'active',
      kycStatus: 'verified',
      registrationStep: 'submitted',
      referenceId: 'VR-2026-100001',
      isOnline: true,
      currentLocation: { lat: vendorLoc.latitude + 0.01, lng: vendorLoc.longitude + 0.01, updatedAt: new Date() },
      address: {
        line1: '221 Church Street', area: 'MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', addressType: 'home',
      },
      emergencyContact: { name: 'Ramesh Kumar', relationship: 'Father', mobile: '9876522222' },
      vehicleType: 'motorbike',
      vehicleDetails: { registrationNumber: 'KA-05-AB-1234', brand: 'Honda', model: 'Activa 6G', year: 2022, fuelType: 'petrol', color: 'Black' },
      bankDetails: { accountHolderName: 'Demo Driver', accountNumber: '000123456789', ifsc: 'HDFC0000123' },
    });
    console.log(`Created demo driver ${driver.phone} (log in with OTP 123456 in dev mode).`);
  } else if (!driver.isOnline || !driver.currentLocation) {
    driver.isOnline = true;
    driver.currentLocation = { lat: vendorLoc.latitude + 0.01, lng: vendorLoc.longitude + 0.01, updatedAt: new Date() };
    await driver.save();
  }

  // --- Demo customer + address -------------------------------------------------
  const customerPhone = '9876533333';
  let customer = await Customer.findOne({ phone: customerPhone });
  if (!customer) {
    customer = await Customer.create({ phone: customerPhone, name: 'Demo Customer', status: 'active' });
    console.log(`Created demo customer ${customer.phone} (log in with OTP 123456 in dev mode).`);
  }

  let address = await Address.findOne({ customerId: customer._id });
  if (!address) {
    address = await Address.create({
      customerId: customer._id,
      label: 'home',
      contactName: customer.name,
      contactPhone: customer.phone,
      line1: '48, 4th Cross, Koramangala 6th Block',
      landmark: 'Opposite City Park',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560095',
      // A couple km from the store, so distance-based earnings/sort logic has something real to compute.
      latitude: vendorLoc.latitude + 0.02,
      longitude: vendorLoc.longitude + 0.015,
      isDefault: true,
    });
  }

  function buildItemsAndPricing(picks: { product: ProductDoc; quantity: number }[]): { items: OrderItemSnapshot[]; pricing: OrderPricing } {
    const pricedLines = picks.map(({ product, quantity }) => priceLine(product, product.variants[0], quantity));
    const items: OrderItemSnapshot[] = pricedLines.map((l) => ({
      productId: l.product._id as never,
      variantId: l.variant.id,
      name: l.product.name,
      variantLabel: l.variant.label,
      imageUrl: l.product.images[0],
      price: l.variant.price,
      mrp: l.variant.mrp,
      quantity: l.quantity,
      subtotal: l.subtotal,
    }));
    const pricing = computeOrderPricing(pricedLines, 0);
    return { items, pricing };
  }

  const addressSnapshot = {
    contactName: address.contactName,
    contactPhone: address.contactPhone,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    latitude: address.latitude,
    longitude: address.longitude,
  };

  type DemoOrderDef = {
    key: string;
    status: OrderStatus;
    assignToDriver: boolean;
    picks: { product: ProductDoc; quantity: number }[];
    placedMinsAgo: number;
    build?: (fields: Record<string, unknown>) => void;
  };

  const defs: DemoOrderDef[] = [
    { key: 'available-1', status: 'ready_for_pickup', assignToDriver: false, picks: [{ product: products[0], quantity: 2 }, { product: products[1], quantity: 1 }], placedMinsAgo: 12 },
    { key: 'available-2', status: 'ready_for_pickup', assignToDriver: false, picks: [{ product: products[2], quantity: 1 }], placedMinsAgo: 6 },
    { key: 'assigned-ready', status: 'ready_for_pickup', assignToDriver: true, picks: [{ product: products[3], quantity: 3 }, { product: products[0], quantity: 1 }], placedMinsAgo: 15 },
    { key: 'out-for-delivery', status: 'out_for_delivery', assignToDriver: true, picks: [{ product: products[1], quantity: 2 }], placedMinsAgo: 30 },
    { key: 'delivered-1', status: 'delivered', assignToDriver: true, picks: [{ product: products[0], quantity: 1 }, { product: products[4] ?? products[0], quantity: 2 }], placedMinsAgo: 180 },
    { key: 'delivered-2', status: 'delivered', assignToDriver: true, picks: [{ product: products[2], quantity: 4 }], placedMinsAgo: 1440 },
    { key: 'cancelled-1', status: 'cancelled', assignToDriver: true, picks: [{ product: products[1], quantity: 1 }], placedMinsAgo: 90 },
  ];

  for (const def of defs) {
    const orderNumber = `VR-DEMO-${def.key.toUpperCase()}`;
    const existing = await Order.findOne({ orderNumber });
    if (existing) continue;

    const { items, pricing } = buildItemsAndPricing(def.picks);
    const placedAt = minutesAgo(def.placedMinsAgo);
    const statusHistory: { status: OrderStatus; at: Date; note?: string }[] = [{ status: 'placed', at: placedAt }];
    let cursor = placedAt;
    const advance = (status: OrderStatus, afterMins: number, note?: string) => {
      cursor = new Date(cursor.getTime() + afterMins * 60 * 1000);
      statusHistory.push({ status, at: cursor, note });
    };

    advance('accepted', 1);
    advance('preparing', 2);
    advance('ready_for_pickup', 5);

    let driverId: unknown;
    let pickupConfirmedAt: Date | undefined;
    let deliveredAt: Date | undefined;
    let deliveryOtpHash: string | undefined;
    let deliveryOtp: string | undefined;
    let driverEarnings: { base: number; distance: number; onTimeBonus: number; incentiveBonus: number; total: number } | undefined;
    let cancelledBy: 'customer' | 'vendor' | 'admin' | 'driver' | undefined;
    let cancelReason: string | undefined;

    if (def.assignToDriver) driverId = driver._id;

    if (def.status === 'out_for_delivery' || def.status === 'delivered') {
      advance('out_for_delivery', 3);
      pickupConfirmedAt = cursor;
      // Dummy OTP flow: the plaintext is shown to the customer in-app (the dev
      // master OTP 123456 also always works via compareDeliveryOtp's bypass).
      deliveryOtp = '482913';
      deliveryOtpHash = await bcrypt.hash(deliveryOtp, 10);
    }

    if (def.status === 'delivered') {
      advance('delivered', 20);
      deliveredAt = cursor;
      deliveryOtpHash = undefined;
      deliveryOtp = undefined;
      const base = DRIVER_BASE_PAY;
      const distance = 10;
      const onTimeBonus = 10;
      driverEarnings = { base, distance, onTimeBonus, incentiveBonus: 0, total: base + distance + onTimeBonus };
    }

    if (def.status === 'cancelled') {
      advance('cancelled', 4, 'Customer changed their mind');
      cancelledBy = 'customer';
      cancelReason = 'Customer changed their mind';
      driverId = undefined;
    }

    const order = await Order.create({
      orderNumber,
      customerId: customer._id,
      vendorId: vendor._id,
      driverId,
      items,
      address: addressSnapshot,
      pricing,
      paymentMethod: 'cod',
      paymentStatus: def.status === 'delivered' ? 'paid' : def.status === 'cancelled' ? 'refunded' : 'pending',
      status: def.status,
      statusHistory,
      placedAt,
      deliveredAt,
      deliveryOtpHash,
      deliveryOtp,
      pickupConfirmedAt,
      driverEarnings,
      cancelledBy,
      cancelReason,
    });

    if (def.status === 'delivered' && driverEarnings) {
      let balance = await getDriverBalance(driver._id);
      for (const [type, amount] of [
        ['delivery_fee', driverEarnings.base],
        ['distance_bonus', driverEarnings.distance],
        ['ontime_bonus', driverEarnings.onTimeBonus],
      ] as const) {
        if (amount <= 0) continue;
        balance += amount;
        await EarningsLedger.create({
          driverId: driver._id as never,
          orderId: order._id as never,
          type,
          amount,
          balanceAfter: balance,
          status: 'settled',
          reason: `Order #${order.orderNumber}`,
        });
      }
    }

    console.log(`Created demo order ${orderNumber} (${def.status}${def.assignToDriver ? ', assigned to demo driver' : ''}).`);
  }

  await seedIncentives();

  console.log('Delivery seed complete. Demo driver OTP (dev mode): 123456.');
}

/** Two sample incentives so the DeliveryApp's Incentives tab has real rows. */
async function seedIncentives() {
  const now = new Date();
  const daysFromNow = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const samples = [
    {
      title: 'Weekend Warrior',
      description: 'Complete 20 deliveries between Friday and Sunday to earn a ₹300 bonus.',
      rewardAmount: 300,
      targetDeliveries: 20,
      startAt: daysFromNow(-1),
      expiresAt: daysFromNow(6),
      status: 'active' as const,
      conditions: [
        { label: 'Maintain a 4.5+ rating', type: 'min_rating', threshold: 4.5 },
        { label: 'Accept at least 90% of offered orders', type: 'min_acceptance_rate', threshold: 90 },
      ],
    },
    {
      title: 'Monthly Milestone',
      description: 'Hit 100 deliveries this month and unlock a ₹1,000 reward.',
      rewardAmount: 1000,
      targetDeliveries: 100,
      startAt: daysFromNow(-7),
      expiresAt: daysFromNow(23),
      status: 'active' as const,
      conditions: [{ label: 'No customer complaints this month', type: 'max_complaints', threshold: 0 }],
    },
  ];

  for (const sample of samples) {
    const existing = await Incentive.findOne({ title: sample.title });
    if (existing) {
      console.log(`Incentive "${sample.title}" already exists — skipping.`);
      continue;
    }
    await Incentive.create(sample);
    console.log(`Created incentive "${sample.title}".`);
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
