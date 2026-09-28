/**
 * End-to-end order-lifecycle test.
 *
 * Drives the REAL running backend (http://localhost:4000/api by default) over
 * plain HTTP — exactly like the customer/vendor app, DeliveryApp, and admin
 * panel do — through a full dummy customer + vendor + 2 drivers onboarding,
 * then every order scenario: happy path, cancellations, rejections, refunds,
 * reassignments, emergencies, and every invalid/negative case we could think of.
 *
 * Contract under test: vendors move orders up to ready_for_pickup only; drivers
 * (active + online) accept/pick up/deliver against the dummy OTP the customer
 * sees on their order; customers can cancel only while placed/accepted; drivers
 * earn a flat DRIVER_BASE_PAY (₹30) per delivery; registration locks once
 * submitted.
 *
 * Requires the backend dev server to already be running (`npm run dev`) and
 * the admin account to exist (`npm run seed`, if not already done).
 *
 * All test data is tagged with an "E2E_" prefix / a dedicated phone block
 * (8990000001-8990000004) and is deliberately LEFT in the database afterward
 * (per the user's choice) for manual inspection via the admin panel / apps.
 *
 * Run: npm run test:e2e
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4000/api';
const DEV_OTP = '123456';

// ---------------------------------------------------------------------------
// Tagged E2E identities — dedicated phone block, never used by seed*.ts
// ---------------------------------------------------------------------------
const CUSTOMER_PHONE = '8990000001';
const VENDOR_PHONE = '8990000002';
const DRIVER_A_PHONE = '8990000003';
const DRIVER_B_PHONE = '8990000004';

const VENDOR_EMAIL = 'e2e.vendor@verdant-test.com';
const VENDOR_PASSWORD = 'E2ETest@1234';
const CUSTOMER_EMAIL = 'e2e.customer@verdant-test.com';

const ADMIN_EMAIL = 'admin@verdant.com';
const ADMIN_PASSWORD = 'verdant@123';

// Priced below MIN_ORDER_VALUE (₹99) at qty 1 so test orders carry a non-zero
// customer delivery fee — which must NOT leak into the driver's flat base pay.
const PRODUCT_PRICE = 49;
const DRIVER_BASE_PAY = 30;
const COMMISSION_RATE = 0.08;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`HTTP ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function call(method: string, path: string, body?: unknown, token?: string): Promise<any> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed;
}

/** Calls `call` and throws with a labeled message on failure — for the "this must work" path. */
async function ok(method: string, path: string, body: unknown, token: string | undefined, label: string): Promise<any> {
  try {
    return await call(method, path, body, token);
  } catch (err) {
    if (err instanceof ApiError) {
      throw new Error(`[${label}] expected success but got HTTP ${err.status}: ${JSON.stringify(err.body)}`);
    }
    throw err;
  }
}

/** Asserts a call FAILS with (optionally) a specific status — for negative tests. */
async function expectFail(
  method: string,
  path: string,
  body: unknown,
  token: string | undefined,
  label: string,
  expectedStatus?: number,
): Promise<{ status: number; body: unknown }> {
  try {
    const result = await call(method, path, body, token);
    throw new Error(`[${label}] expected failure but got HTTP 200: ${JSON.stringify(result)}`);
  } catch (err) {
    if (err instanceof ApiError) {
      if (expectedStatus && err.status !== expectedStatus) {
        throw new Error(`[${label}] expected HTTP ${expectedStatus} but got HTTP ${err.status}: ${JSON.stringify(err.body)}`);
      }
      return { status: err.status, body: err.body };
    }
    throw err;
  }
}

/** Uploads a tiny in-memory PNG as multipart/form-data to a `upload.single('file')` route. */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function uploadFile(
  path: string,
  token: string,
  extraFields: Record<string, string> = {},
  filename = 'e2e-test-image.png',
  label = path,
): Promise<any> {
  const buf = Buffer.from(TINY_PNG_BASE64, 'base64');
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'image/png' }), filename);
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v);

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`[${label}] upload failed HTTP ${res.status}: ${JSON.stringify(parsed)}`);
  return parsed;
}

function id(obj: any): string {
  return obj?.id ?? obj?._id ?? obj;
}

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

type ScenarioResult = { name: string; passed: boolean; detail: string };
const results: ScenarioResult[] = [];

async function scenario(name: string, fn: () => Promise<string>) {
  process.stdout.write(`\n▶ ${name} ... `);
  try {
    const detail = await fn();
    results.push({ name, passed: true, detail });
    console.log(`✅ PASS — ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, detail });
    console.log(`❌ FAIL — ${detail}`);
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

interface Ctx {
  adminToken: string;
  vendorToken: string;
  vendorId: string;
  categoryId: string;
  productId: string;
  variantId: string;
  driverAToken: string;
  driverAId: string;
  driverBToken: string;
  driverBId: string;
  customerToken: string;
  customerId: string;
  addressId: string;
}

async function adminLogin(): Promise<string> {
  const res = await ok('POST', '/admin/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, undefined, 'Admin login');
  return res.accessToken;
}

async function ensureCategory(adminToken: string): Promise<string> {
  const categories = await ok('GET', '/admin/categories', undefined, adminToken, 'List categories');
  if (Array.isArray(categories) && categories.length > 0) return id(categories[0]);
  const created = await ok(
    'POST',
    '/admin/categories',
    { name: 'E2E_Test Category' },
    adminToken,
    'Create category',
  );
  return id(created);
}

async function setupVendor(adminToken: string, categoryId: string): Promise<{ vendorToken: string; vendorId: string; productId: string; variantId: string }> {
  await call('POST', '/vendor/auth/otp/request', { phone: VENDOR_PHONE });
  const verify = await ok(
    'POST',
    '/vendor/auth/otp/verify',
    { phone: VENDOR_PHONE, otp: DEV_OTP, intent: 'create-account' },
    undefined,
    'Vendor OTP verify',
  );

  let vendorToken: string;
  let vendorId: string;
  if (verify.accountExists) {
    // Re-running against a previous E2E run's data (script is idempotent) — log in instead.
    const login = await ok(
      'POST',
      '/vendor/auth/login',
      { identifier: VENDOR_EMAIL, password: VENDOR_PASSWORD },
      undefined,
      'Vendor login (existing E2E account)',
    );
    vendorToken = login.accessToken;
    vendorId = id(login.vendor);
  } else {
    const reg = await ok(
      'POST',
      '/vendor/auth/register',
      {
        verifiedPhoneToken: verify.verifiedPhoneToken,
        fullName: 'E2E Test Vendor',
        email: VENDOR_EMAIL,
        password: VENDOR_PASSWORD,
        confirmPassword: VENDOR_PASSWORD,
      },
      undefined,
      'Vendor register',
    );
    vendorToken = reg.accessToken;
    vendorId = id(reg.vendor);
  }

  // --- 8-step registration -------------------------------------------------
  // Registration locks once submitted/approved, so a re-run against a previous
  // run's vendor must skip straight past it.
  const regStatus = await ok('GET', '/vendor/registration/status', undefined, vendorToken, 'Vendor registration status');
  const registrationLocked = regStatus.status === 'active' || regStatus.registrationStep === 'submitted';
  if (!registrationLocked) {
  await ok('PATCH', '/vendor/registration/business-type', { businessType: 'proprietorship' }, vendorToken, 'reg:business-type');
  await ok(
    'PATCH',
    '/vendor/registration/business-info',
    {
      legalName: 'E2E Test Enterprises',
      displayName: 'E2E Test Store',
      category: 'Grocery',
      addressLine1: '221B Test Street',
      addressLine2: 'Near Test Circle',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      country: 'India',
    },
    vendorToken,
    'reg:business-info',
  );
  await ok(
    'PATCH',
    '/vendor/registration/owner-info',
    { fullName: 'E2E Test Vendor', mobile: VENDOR_PHONE, email: VENDOR_EMAIL, dob: '1990-01-01', pan: 'ABCDE1234F' },
    vendorToken,
    'reg:owner-info',
  );
  await ok(
    'PATCH',
    '/vendor/registration/store-info',
    {
      storeName: 'E2E Test Store',
      storeAddress: '221B Test Street, Bengaluru',
      landmark: 'Near Test Circle',
      contactNumber: VENDOR_PHONE,
      storeType: 'Grocery',
      operatingHours: '9:00 AM - 9:00 PM',
      location: { address: '221B Test Street, Bengaluru', cityState: 'Bengaluru, Karnataka', latitude: 12.9716, longitude: 77.5946 },
    },
    vendorToken,
    'reg:store-info',
  );
  await ok('PATCH', '/vendor/registration/gst-details', { registered: false }, vendorToken, 'reg:gst-details');
  await ok(
    'PATCH',
    '/vendor/registration/pan-details',
    {
      panNumber: 'ABCDE1234F',
      holderName: 'E2E Test Vendor',
      dob: '1990-01-01',
      panType: 'Individual',
      documentUrl: 'https://example.com/e2e/pan.pdf',
    },
    vendorToken,
    'reg:pan-details',
  );
  await ok(
    'PATCH',
    '/vendor/registration/business-proof',
    {
      documentType: 'Aadhaar Card',
      documentNumber: '123412341234',
      issueDate: '2015-01-01',
      expiryDate: '2035-01-01',
      frontUrl: 'https://example.com/e2e/aadhaar-front.jpg',
    },
    vendorToken,
    'reg:business-proof',
  );
  await ok(
    'PATCH',
    '/vendor/registration/bank-details',
    {
      accountHolderName: 'E2E Test Vendor',
      accountNumber: '123456789012',
      confirmAccountNumber: '123456789012',
      ifsc: 'HDFC0001234',
      bankName: 'HDFC Bank',
      branch: 'Bengaluru Main',
      accountType: 'Savings',
    },
    vendorToken,
    'reg:bank-details',
  );

  await ok('POST', '/vendor/registration/submit', undefined, vendorToken, 'Vendor registration submit');
  }
  if (regStatus.status !== 'active') {
    await ok('PATCH', `/admin/vendors/${vendorId}/status`, { status: 'active' }, adminToken, 'Admin approve vendor');
  }
  const afterApproval = await ok('GET', '/vendor/registration/status', undefined, vendorToken, 'Vendor registration status (post-approval)');
  assert(afterApproval.status === 'active', `expected vendor status active, got ${afterApproval.status}`);
  assert(afterApproval.nextStep === null, `expected nextStep null after submit, got ${afterApproval.nextStep}`);

  // --- 7-step store setup ---------------------------------------------------
  if (!afterApproval.storeSetupCompleted) {
  await ok(
    'PATCH',
    '/vendor/store-setup/profile',
    {
      storeName: 'E2E Test Store',
      description: 'E2E automated test store — grocery essentials',
      primaryCategory: 'Grocery',
      subCategory: 'Daily Essentials',
      tags: ['grocery', 'daily-essentials'],
      minimumOrderValue: '100',
      avgPrepTime: '20 mins',
    },
    vendorToken,
    'setup:profile',
  );

  await uploadFile('/vendor/store-setup/logo', vendorToken, {}, 'logo.png', 'setup:logo upload');
  await uploadFile('/vendor/store-setup/cover-image', vendorToken, {}, 'cover.png', 'setup:cover-image upload');

  await ok(
    'PATCH',
    '/vendor/store-setup/address',
    {
      buildingShopNo: '12A',
      street: '221B Test Street',
      landmark: 'Near Test Circle',
      area: 'Test Nagar',
      pincode: '560001',
      city: 'Bengaluru',
      state: 'Karnataka',
      contactNumber: VENDOR_PHONE,
      sameAsBusinessAddress: true,
      location: { address: '221B Test Street, Bengaluru', cityState: 'Bengaluru, Karnataka', latitude: 12.9716, longitude: 77.5946 },
    },
    vendorToken,
    'setup:address',
  );

  const weeklySchedule = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({
    day,
    open: '09:00',
    close: '21:00',
    isOpen: true,
  }));
  await ok(
    'PATCH',
    '/vendor/store-setup/hours',
    { sameEveryDay: true, defaultOpen: '09:00', defaultClose: '21:00', breakEnabled: false, weeklySchedule },
    vendorToken,
    'setup:hours',
  );

  await ok(
    'PATCH',
    '/vendor/store-setup/delivery',
    {
      fulfillmentType: 'delivery',
      deliveryRadiusKm: 5,
      minimumOrderForDelivery: '100',
      chargeType: 'Distance-based slab',
      slabs: [
        { range: '0 - 2 km', charge: '₹ 20' },
        { range: '2 - 5 km', charge: '₹ 40' },
      ],
      freeDeliveryAbove: '500',
    },
    vendorToken,
    'setup:delivery',
  );

  await ok(
    'PATCH',
    '/vendor/store-setup/availability',
    {
      slotsEnabled: false,
      slots: [{ label: 'Anytime', window: '09:00-21:00', totalSlots: 50, usedSlots: 0 }],
      maxSimultaneousOrders: '10',
      autoPauseAtCapacity: false,
    },
    vendorToken,
    'setup:availability',
  );

  await ok('PATCH', '/vendor/store-setup/status', { storeStatus: 'open' }, vendorToken, 'setup:status');
  await ok('POST', '/vendor/store-setup/complete', undefined, vendorToken, 'Store setup complete');
  }

  // --- product -----------------------------------------------------------
  // Reuse a previous run's product if one already exists for this vendor
  // (keeps the script idempotent instead of piling up duplicate products).
  const PRODUCT_NAME = 'E2E Test Product — Instant Noodles';
  const existingProducts = await ok('GET', '/vendor/products', undefined, vendorToken, 'List vendor products');
  const existingList: any[] = Array.isArray(existingProducts) ? existingProducts : existingProducts.items ?? [];
  let product = existingList.find((p: any) => p.name === PRODUCT_NAME);

  if (!product) {
    product = await ok(
      'POST',
      '/vendor/products',
      {
        categoryId,
        name: PRODUCT_NAME,
        description: 'Automated test product used by the E2E order-lifecycle script',
        brand: 'E2E Test Brand',
        unit: 'pack',
        images: [],
        variants: [{ label: 'Single Pack', mrp: 59, price: PRODUCT_PRICE, stock: 1000 }],
        tags: ['test', 'grocery'],
      },
      vendorToken,
      'Create product',
    );
  }
  const productId = id(product);
  const variantId = product.variants[0].id;

  await ok('PATCH', `/admin/products/${productId}/status`, { status: 'active' }, adminToken, 'Admin approve product');

  return { vendorToken, vendorId, productId, variantId };
}

async function setupDriver(adminToken: string, phone: string, label: string): Promise<{ driverToken: string; driverId: string }> {
  await call('POST', '/driver/auth/otp/request', { phone });
  const verify = await ok('POST', '/driver/auth/otp/verify', { phone, otp: DEV_OTP }, undefined, `${label} OTP verify`);
  const driverToken: string = verify.accessToken;
  const driverId: string = id(verify.driver);

  const regStatus = await ok('GET', '/driver/registration/status', undefined, driverToken, `${label} registration status`);
  const registrationLocked = regStatus.status === 'active' || regStatus.registrationStep === 'submitted';
  if (!registrationLocked) {
  assert(regStatus.nextStep === 'personal-info', `fresh driver nextStep should be personal-info, got ${regStatus.nextStep}`);
  await ok(
    'PATCH',
    '/driver/registration/personal-info',
    { fullName: `E2E Test Driver ${label}`, email: `e2e.driver.${label.toLowerCase()}@verdant-test.com`, dob: '1995-01-01', gender: 'other' },
    driverToken,
    `${label}:personal-info`,
  );
  await ok(
    'PATCH',
    '/driver/registration/address',
    { line1: '45 Test Lane', area: 'Test Nagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', addressType: 'home' },
    driverToken,
    `${label}:address`,
  );
  await ok(
    'PATCH',
    '/driver/registration/emergency-contact',
    { name: 'E2E Emergency Contact', relationship: 'Friend', mobile: '9988776655' },
    driverToken,
    `${label}:emergency-contact`,
  );
  await ok('PATCH', '/driver/registration/vehicle-type', { vehicleType: 'motorbike' }, driverToken, `${label}:vehicle-type`);
  await ok(
    'PATCH',
    '/driver/registration/vehicle-details',
    { registrationNumber: `KA01E2E${label}`, brand: 'Honda', model: 'Activa', year: 2022, fuelType: 'Petrol', color: 'Black' },
    driverToken,
    `${label}:vehicle-details`,
  );

  // Submit requires every one of the four documents.
  for (const type of ['license_front', 'license_back', 'rc', 'insurance']) {
    await uploadFile('/driver/registration/documents', driverToken, { type }, `${type}.png`, `${label}:${type} upload`);
  }

  await ok(
    'PATCH',
    '/driver/registration/insurance-details',
    { insuranceType: 'Third Party', policyNumber: `POL-E2E-${label}`, validFrom: '2024-01-01', validUntil: '2027-01-01' },
    driverToken,
    `${label}:insurance-details`,
  );
  await ok(
    'PATCH',
    '/driver/registration/bank-details',
    { accountHolderName: `E2E Test Driver ${label}`, accountNumber: '998877665544', confirmAccountNumber: '998877665544', ifsc: 'ICIC0001234' },
    driverToken,
    `${label}:bank-details`,
  );

  const beforeSubmit = await ok('GET', '/driver/registration/status', undefined, driverToken, `${label} registration status (pre-submit)`);
  assert(beforeSubmit.nextStep === 'submit', `expected nextStep=submit once every step is filled, got ${beforeSubmit.nextStep}`);
  await ok('POST', '/driver/registration/submit', undefined, driverToken, `${label} registration submit`);

  // A pending (unapproved) driver must not be able to touch orders.
  await expectFail('GET', '/driver/orders/available', undefined, driverToken, `${label} available orders while pending (should fail)`, 403);
  }
  if (regStatus.status !== 'active') {
    const approved = await ok('PATCH', `/admin/drivers/${driverId}/status`, { status: 'active' }, adminToken, `Admin approve ${label}`);
    assert(approved.id === driverId, 'admin driver status response should be toSafeJson (id, not _id)');
    assert(approved.kycStatus === 'verified', `approval should verify KYC, got ${approved.kycStatus}`);
  }

  const me = await ok('GET', '/driver/me', undefined, driverToken, `${label} GET /driver/me`);
  assert(me.id === driverId && me.status === 'active' && me.registrationStep === 'submitted', `unexpected /driver/me shape: ${JSON.stringify({ id: me.id, status: me.status, registrationStep: me.registrationStep })}`);
  assert(typeof me.isOnline === 'boolean' && me.kycStatus === 'verified', '/driver/me should expose isOnline + kycStatus');

  await ok('PATCH', '/driver/location', { lat: 12.9716, lng: 77.5946 }, driverToken, `${label} update location`);
  await ok('PATCH', '/driver/status', { isOnline: true, lat: 12.9716, lng: 77.5946 }, driverToken, `${label} go online`);

  return { driverToken, driverId };
}

async function setupCustomer(): Promise<{ customerToken: string; customerId: string; addressId: string }> {
  await call('POST', '/customer/auth/otp/request', { phone: CUSTOMER_PHONE });
  const verify = await ok('POST', '/customer/auth/otp/verify', { phone: CUSTOMER_PHONE, otp: DEV_OTP }, undefined, 'Customer OTP verify');

  let customerToken: string;
  let customerId: string;
  if (verify.isNewUser) {
    const reg = await ok(
      'POST',
      '/customer/auth/register',
      { verifiedPhoneToken: verify.verifiedPhoneToken, name: 'E2E Test Customer', email: CUSTOMER_EMAIL },
      undefined,
      'Customer register',
    );
    customerToken = reg.accessToken;
    customerId = id(reg.user);
  } else {
    customerToken = verify.accessToken;
    customerId = id(verify.user);
  }

  const address = await ok(
    'POST',
    '/customer/addresses',
    {
      label: 'home',
      contactName: 'E2E Test Customer',
      contactPhone: CUSTOMER_PHONE,
      line1: '77 Test Residency',
      line2: 'Flat 4B',
      landmark: 'Opposite Test Park',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560002',
      latitude: 12.9352,
      longitude: 77.6146,
      isDefault: true,
    },
    customerToken,
    'Create address',
  );

  return { customerToken, customerId, addressId: id(address) };
}

// ---------------------------------------------------------------------------
// Order helpers
// ---------------------------------------------------------------------------

async function placeFreshOrder(ctx: Ctx): Promise<any> {
  await ok(
    'POST',
    '/customer/cart/items',
    { productId: ctx.productId, variantId: ctx.variantId, quantity: 1 },
    ctx.customerToken,
    'Add to cart',
  );
  return ok('POST', '/customer/orders', { addressId: ctx.addressId, paymentMethod: 'cod' }, ctx.customerToken, 'Create order');
}

async function vendorStatus(ctx: Ctx, orderId: string, status: string) {
  return ok('PATCH', `/vendor/orders/${orderId}/status`, { status }, ctx.vendorToken, `Vendor status -> ${status}`);
}

async function getOrderAdmin(ctx: Ctx, orderId: string) {
  return ok('GET', `/admin/orders/${orderId}`, undefined, ctx.adminToken, 'Get order (admin)');
}

async function getOrderCustomer(ctx: Ctx, orderId: string) {
  return ok('GET', `/customer/orders/${orderId}`, undefined, ctx.customerToken, 'Get order (customer)');
}

/** The delivery OTP is dummy (no SMS) and shown to the customer on their order
 * while it's out for delivery — the driver reads it from them. */
async function customerDeliveryOtp(ctx: Ctx, orderId: string): Promise<string> {
  const order = await getOrderCustomer(ctx, orderId);
  assert(order.status === 'out_for_delivery', `expected out_for_delivery before reading OTP, got ${order.status}`);
  assert(typeof order.deliveryOtp === 'string' && /^\d{6}$/.test(order.deliveryOtp), `customer order should expose a 6-digit deliveryOtp, got ${order.deliveryOtp}`);
  return order.deliveryOtp;
}

async function driverDeliver(ctx: Ctx, orderId: string, driverToken: string, label: string) {
  await ok('POST', `/driver/orders/${orderId}/accept`, undefined, driverToken, `${label} accept`);
  await ok('POST', `/driver/orders/${orderId}/pickup-confirm`, undefined, driverToken, `${label} pickup-confirm`);
  const otp = await customerDeliveryOtp(ctx, orderId);
  return ok('POST', `/driver/orders/${orderId}/verify-otp`, { otp }, driverToken, `${label} verify-otp`);
}

async function advanceToReadyForPickup(ctx: Ctx): Promise<any> {
  const order = await placeFreshOrder(ctx);
  await vendorStatus(ctx, id(order), 'accepted');
  await vendorStatus(ctx, id(order), 'preparing');
  await vendorStatus(ctx, id(order), 'ready_for_pickup');
  return getOrderAdmin(ctx, id(order));
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function s1_happyPath(ctx: Ctx) {
  await scenario('S1 — Happy path: placed -> ... -> delivered, settlement + full earnings ledger', async () => {
    const order = await advanceToReadyForPickup(ctx);
    const orderId = id(order);

    const available = await ok('GET', '/driver/orders/available', undefined, ctx.driverAToken, 'List available orders');
    assert(
      available.some((o: any) => id(o) === orderId),
      'fresh ready_for_pickup order should appear in driver A\'s available list',
    );

    const beforePickup = await getOrderCustomer(ctx, orderId);
    assert(beforePickup.deliveryOtp === undefined || beforePickup.deliveryOtp === null, 'OTP must not be exposed before pickup');
    assert(beforePickup.driver === null, 'driver should be null before assignment');

    await ok('POST', `/driver/orders/${orderId}/accept`, undefined, ctx.driverAToken, 'Driver A accept');
    const pickup = await ok('POST', `/driver/orders/${orderId}/pickup-confirm`, undefined, ctx.driverAToken, 'Driver A pickup-confirm');
    assert(pickup.status === 'out_for_delivery', `expected out_for_delivery, got ${pickup.status}`);
    assert(pickup.deliveryOtp === undefined && pickup.deliveryOtpHash === undefined, 'driver response must not leak the OTP');

    const outForDelivery = await getOrderCustomer(ctx, orderId);
    assert(outForDelivery.driver?.id === ctx.driverAId, `customer order should carry the assigned driver, got ${JSON.stringify(outForDelivery.driver)}`);
    assert(outForDelivery.driver.name === 'E2E Test Driver A' && outForDelivery.driver.phone === DRIVER_A_PHONE, 'driver card should have name + phone');
    const otp = await customerDeliveryOtp(ctx, orderId);

    const notifications = await ok('GET', '/customer/notifications', undefined, ctx.customerToken, 'Customer notifications');
    const otpNotif = notifications.find((n: any) => n.title === 'Out for delivery' && id(n.orderId) === orderId);
    assert(!!otpNotif, 'expected an out-for-delivery notification');
    assert(otpNotif.body.includes(otp) && otpNotif.data?.deliveryOtp === otp, 'out-for-delivery notification must carry the OTP');
    assert(otpNotif.orderNumber === order.orderNumber && otpNotif.data?.orderNumber === order.orderNumber, 'notification must carry orderNumber');

    const delivered = await ok('POST', `/driver/orders/${orderId}/verify-otp`, { otp }, ctx.driverAToken, 'Driver A verify-otp');
    assert(delivered.status === 'delivered', `expected delivered, got ${delivered.status}`);
    assert(!!delivered.deliveredAt, 'deliveredAt should be set');
    assert(delivered.paymentStatus === 'paid', `COD should be marked paid on delivery, got ${delivered.paymentStatus}`);
    assert(delivered.driverEarnings?.base === DRIVER_BASE_PAY, `driver base pay should be ${DRIVER_BASE_PAY}, got ${delivered.driverEarnings?.base}`);

    const afterDelivery = await getOrderCustomer(ctx, orderId);
    assert(afterDelivery.deliveryOtp === undefined || afterDelivery.deliveryOtp === null, 'OTP must disappear once delivered');

    const replay = await expectFail('POST', `/driver/orders/${orderId}/verify-otp`, { otp }, ctx.driverAToken, 'Replay verify-otp (should fail)', 409);

    const breakdown = await ok('GET', `/driver/earnings/breakdown/${orderId}`, undefined, ctx.driverAToken, 'Earnings breakdown');
    const types = breakdown.ledger.map((l: any) => l.type);
    assert(types.includes('delivery_fee'), `expected a delivery_fee ledger entry, got types: ${types}`);
    const feeRows = breakdown.ledger.filter((l: any) => l.type === 'delivery_fee');
    assert(feeRows.length === 1 && feeRows[0].amount === DRIVER_BASE_PAY, `expected exactly one delivery_fee row of ${DRIVER_BASE_PAY}, got ${JSON.stringify(feeRows)}`);

    const settlements = await ok('GET', `/admin/vendors/${ctx.vendorId}/settlements`, undefined, ctx.adminToken, 'Vendor settlements');
    const settlement = settlements.find((s: any) => id(s.orderId) === orderId || s.orderId === orderId);
    assert(!!settlement, 'a VendorSettlement should exist for this delivered order');
    const { itemsTotal, taxTotal } = delivered.pricing;
    const expectedCommission = Math.round(itemsTotal * COMMISSION_RATE * 100) / 100;
    assert(settlement.commissionRate === COMMISSION_RATE, `commissionRate should be the fraction ${COMMISSION_RATE}, got ${settlement.commissionRate}`);
    assert(settlement.grossAmount === Math.round((itemsTotal + taxTotal) * 100) / 100, `gross should be items+tax, got ${settlement.grossAmount}`);
    assert(settlement.commissionAmount === expectedCommission, `commission should be 8% of items, got ${settlement.commissionAmount}`);

    const batches = await ok('GET', '/admin/settlements/batches?status=pending', undefined, ctx.adminToken, 'Admin payout batches');
    const batch = batches.items.find((b: any) => id(b.vendorId) === ctx.vendorId);
    assert(!!batch && batch.settlementCount >= 1 && typeof batch.vendorName === 'string', 'a pending payout batch with vendorName should exist for this vendor');

    const vendorPayment = await ok('GET', '/vendor/notifications', undefined, ctx.vendorToken, 'Vendor notifications');
    const paymentNotif = vendorPayment.find((n: any) => n.category === 'payment' && id(n.orderId) === orderId);
    assert(!!paymentNotif && paymentNotif.orderNumber === order.orderNumber, 'vendor payment notification should carry orderNumber');

    return `order ${order.orderNumber} delivered with customer-visible OTP, replay -> ${replay.status}, base pay ${DRIVER_BASE_PAY}, settlement @${COMMISSION_RATE} recorded`;
  });
}

async function s2_customerCancelWhilePlaced(ctx: Ctx) {
  await scenario('S2 — Customer cancels while placed (stock + coupon restored, plain cancel notification for unpaid COD)', async () => {
    const order = await placeFreshOrder(ctx);
    const orderId = id(order);

    const product = await ok('GET', `/vendor/products/${ctx.productId}`, undefined, ctx.vendorToken, 'Get product (pre-cancel stock)');
    const stockBefore = product.variants.find((v: any) => v.id === ctx.variantId).stock;

    const cancelled = await ok('POST', `/customer/orders/${orderId}/cancel`, { reason: 'E2E test cancel' }, ctx.customerToken, 'Customer cancel');
    assert(cancelled.status === 'cancelled', `expected cancelled, got ${cancelled.status}`);
    assert(cancelled.cancelledBy === 'customer', `expected cancelledBy=customer, got ${cancelled.cancelledBy}`);

    const productAfter = await ok('GET', `/vendor/products/${ctx.productId}`, undefined, ctx.vendorToken, 'Get product (post-cancel stock)');
    const stockAfter = productAfter.variants.find((v: any) => v.id === ctx.variantId).stock;
    assert(stockAfter === stockBefore + 1, `expected stock restored to ${stockBefore + 1}, got ${stockAfter}`);

    const notifications = await ok('GET', '/customer/notifications', undefined, ctx.customerToken, 'Customer notifications');
    const cancelNotif = notifications.find((n: any) => n.title === 'Order cancelled' && (n.orderId === orderId || id(n.orderId) === orderId));
    assert(!!cancelNotif, 'expected an order-cancelled notification referencing this order');
    assert(cancelNotif.kind === 'order', `unpaid COD cancel should be kind=order (not refund), got ${cancelNotif.kind}`);
    assert(cancelNotif.orderNumber === order.orderNumber, 'notification should carry orderNumber');

    return `order ${order.orderNumber} cancelled by customer, stock restored ${stockBefore}->${stockAfter}, kind=order notification present`;
  });
}

async function s3_customerCancelBlockedAfterReady(ctx: Ctx) {
  await scenario('S3 — Customer cancel allowed at accepted, blocked from preparing onwards (negative test)', async () => {
    const accepted = await placeFreshOrder(ctx);
    await vendorStatus(ctx, id(accepted), 'accepted');
    const cancelledAtAccepted = await ok('POST', `/customer/orders/${id(accepted)}/cancel`, { reason: 'changed my mind' }, ctx.customerToken, 'Customer cancel at accepted');
    assert(cancelledAtAccepted.status === 'cancelled', `expected cancelled at accepted, got ${cancelledAtAccepted.status}`);

    const preparing = await placeFreshOrder(ctx);
    await vendorStatus(ctx, id(preparing), 'accepted');
    await vendorStatus(ctx, id(preparing), 'preparing');
    await expectFail('POST', `/customer/orders/${id(preparing)}/cancel`, { reason: 'should fail' }, ctx.customerToken, 'Customer cancel at preparing (should fail)', 409);
    await vendorStatus(ctx, id(preparing), 'cancelled');

    const order = await advanceToReadyForPickup(ctx);
    const orderId = id(order);

    const fail = await expectFail('POST', `/customer/orders/${orderId}/cancel`, { reason: 'should fail' }, ctx.customerToken, 'Customer cancel (should fail)', 409);

    const after = await getOrderAdmin(ctx, orderId);
    assert(after.status === 'ready_for_pickup', `expected order to remain ready_for_pickup, got ${after.status}`);
    await vendorStatus(ctx, orderId, 'cancelled');

    return `cancel allowed at accepted, rejected with HTTP ${fail.status} at preparing/ready_for_pickup`;
  });
}

async function s4_vendorRejectsAtPlaced(ctx: Ctx) {
  await scenario('S4 — Vendor rejects order at placed', async () => {
    const order = await placeFreshOrder(ctx);
    const orderId = id(order);

    const rejected = await vendorStatus(ctx, orderId, 'rejected');
    assert(rejected.status === 'rejected', `expected rejected, got ${rejected.status}`);
    assert(rejected.cancelledBy === 'vendor', `expected cancelledBy=vendor, got ${rejected.cancelledBy}`);

    const notifications = await ok('GET', '/customer/notifications', undefined, ctx.customerToken, 'Customer notifications');
    const rejectNotif = notifications.find((n: any) => (n.orderId === orderId || id(n.orderId) === orderId) && n.title?.toLowerCase().includes('rejected'));
    assert(!!rejectNotif, 'expected an order-rejected notification');

    return `order ${order.orderNumber} rejected by vendor, notification present`;
  });
}

async function s5_vendorCancelsAtPreparing(ctx: Ctx) {
  await scenario('S5 — Vendor cancels order at preparing', async () => {
    const order = await placeFreshOrder(ctx);
    const orderId = id(order);
    await vendorStatus(ctx, orderId, 'accepted');
    await vendorStatus(ctx, orderId, 'preparing');

    const cancelled = await vendorStatus(ctx, orderId, 'cancelled');
    assert(cancelled.status === 'cancelled', `expected cancelled, got ${cancelled.status}`);
    assert(cancelled.cancelledBy === 'vendor', `expected cancelledBy=vendor, got ${cancelled.cancelledBy}`);

    return `order ${order.orderNumber} cancelled by vendor from preparing`;
  });
}

async function s6_adminForceCancels(ctx: Ctx) {
  await scenario('S6 — Admin force-cancels an accepted order', async () => {
    const order = await placeFreshOrder(ctx);
    const orderId = id(order);
    await vendorStatus(ctx, orderId, 'accepted');

    const cancelled = await ok('PATCH', `/admin/orders/${orderId}/status`, { status: 'cancelled', note: 'E2E admin force-cancel' }, ctx.adminToken, 'Admin cancel');
    assert(cancelled.status === 'cancelled', `expected cancelled, got ${cancelled.status}`);
    assert(cancelled.cancelledBy === 'admin', `expected cancelledBy=admin, got ${cancelled.cancelledBy}`);

    return `order ${order.orderNumber} force-cancelled by admin`;
  });
}

async function s7_driverReassignmentViaIssue(ctx: Ctx) {
  await scenario('S7 — Driver A reports vehicle_problem -> reassigned -> driver B completes it', async () => {
    const order = await advanceToReadyForPickup(ctx);
    const orderId = id(order);

    await ok('POST', `/driver/orders/${orderId}/accept`, undefined, ctx.driverAToken, 'Driver A accept');
    const issueRes = await ok(
      'POST',
      `/driver/orders/${orderId}/issue`,
      { type: 'vehicle_problem', description: 'E2E test: simulated vehicle problem' },
      ctx.driverAToken,
      'Driver A report issue',
    );
    assert(issueRes.order.status === 'ready_for_pickup', `expected reassigned to ready_for_pickup, got ${issueRes.order.status}`);
    assert(!issueRes.order.driverId, 'driverId should be cleared after unassign-type issue');

    const available = await ok('GET', '/driver/orders/available', undefined, ctx.driverBToken, 'Driver B list available');
    assert(available.some((o: any) => id(o) === orderId), 'reassigned order should now be available to driver B');

    const delivered = await driverDeliver(ctx, orderId, ctx.driverBToken, 'Driver B');
    assert(delivered.status === 'delivered', `expected delivered, got ${delivered.status}`);
    assert(id(delivered.driverId) === ctx.driverBId, 'driver B should be the driver of record');

    return `order ${order.orderNumber} reassigned from driver A to driver B after vehicle_problem, then delivered`;
  });
}

async function s8_driverEmergencyReassignment(ctx: Ctx) {
  await scenario('S8 — Driver A emergency (vehicle_breakdown) -> reassigned + earnings_protection ledger', async () => {
    const order = await advanceToReadyForPickup(ctx);
    const orderId = id(order);

    await ok('POST', `/driver/orders/${orderId}/accept`, undefined, ctx.driverAToken, 'Driver A accept');
    await ok(
      'POST',
      '/driver/emergency/incidents',
      { type: 'vehicle_breakdown', orderId, description: 'E2E test: simulated breakdown' },
      ctx.driverAToken,
      'Driver A emergency incident',
    );

    const after = await getOrderAdmin(ctx, orderId);
    assert(after.status === 'ready_for_pickup', `expected reassigned to ready_for_pickup, got ${after.status}`);
    assert(!after.driverId, 'driverId should be cleared after emergency unassign');

    const history = await ok('GET', '/driver/earnings/history', undefined, ctx.driverAToken, 'Driver A earnings history');
    const protectionEntry = history.items.find((l: any) => l.type === 'earnings_protection' && (l.orderId === orderId || id(l.orderId) === orderId));
    assert(!!protectionEntry, 'expected an earnings_protection ledger entry for driver A');
    assert(protectionEntry.amount === DRIVER_BASE_PAY, `earnings protection should be the base pay ${DRIVER_BASE_PAY}, got ${protectionEntry.amount}`);

    // Clean completion via driver B so the order doesn't dangle mid-flow.
    await driverDeliver(ctx, orderId, ctx.driverBToken, 'Driver B');

    return `order ${order.orderNumber} reassigned after emergency, earnings_protection entry amount=${protectionEntry.amount}, later delivered by driver B`;
  });
}

async function s9_deliveryFailure(ctx: Ctx) {
  await scenario('S9 — Delivery failure -> order cancelled, stock restored', async () => {
    const order = await advanceToReadyForPickup(ctx);
    const orderId = id(order);

    const product = await ok('GET', `/vendor/products/${ctx.productId}`, undefined, ctx.vendorToken, 'Get product (pre-fail stock)');
    const stockBefore = product.variants.find((v: any) => v.id === ctx.variantId).stock;

    await ok('POST', `/driver/orders/${orderId}/accept`, undefined, ctx.driverAToken, 'Driver A accept');
    await ok('POST', `/driver/orders/${orderId}/pickup-confirm`, undefined, ctx.driverAToken, 'Driver A pickup-confirm');

    const issueRes = await ok(
      'POST',
      `/driver/orders/${orderId}/issue`,
      { type: 'delivery_failed', description: 'E2E test: simulated delivery failure' },
      ctx.driverAToken,
      'Driver A report delivery_failed',
    );
    assert(issueRes.order.status === 'cancelled', `expected cancelled, got ${issueRes.order.status}`);
    assert(issueRes.order.cancelledBy === 'driver', `expected cancelledBy=driver, got ${issueRes.order.cancelledBy}`);

    const productAfter = await ok('GET', `/vendor/products/${ctx.productId}`, undefined, ctx.vendorToken, 'Get product (post-fail stock)');
    const stockAfter = productAfter.variants.find((v: any) => v.id === ctx.variantId).stock;
    assert(stockAfter === stockBefore + 1, `expected stock restored to ${stockBefore + 1}, got ${stockAfter}`);

    return `order ${order.orderNumber} cancelled after delivery_failed issue, stock restored ${stockBefore}->${stockAfter}`;
  });
}

async function s10_invalidTransitionRejected(ctx: Ctx) {
  await scenario('S10 — Invalid transitions rejected (vendor placed -> ready_for_pickup; vendor can never mark out_for_delivery/delivered)', async () => {
    const order = await placeFreshOrder(ctx);
    const orderId = id(order);

    const fail = await expectFail(
      'PATCH',
      `/vendor/orders/${orderId}/status`,
      { status: 'ready_for_pickup' },
      ctx.vendorToken,
      'Vendor invalid transition (should fail)',
      409,
    );
    await expectFail('PATCH', `/vendor/orders/${orderId}/status`, { status: 'out_for_delivery' }, ctx.vendorToken, 'Vendor out_for_delivery (should fail)', 422);
    await expectFail('PATCH', `/vendor/orders/${orderId}/status`, { status: 'delivered' }, ctx.vendorToken, 'Vendor delivered (should fail)', 422);

    const after = await getOrderAdmin(ctx, orderId);
    assert(after.status === 'placed', `expected order to remain placed, got ${after.status}`);
    await vendorStatus(ctx, orderId, 'rejected');

    return `invalid transition correctly rejected with HTTP ${fail.status}, vendor out_for_delivery/delivered -> 422, order still placed`;
  });
}

async function s11_wrongDeliveryOtpRejected(ctx: Ctx) {
  await scenario('S11 — Wrong delivery OTP rejected', async () => {
    const order = await advanceToReadyForPickup(ctx);
    const orderId = id(order);

    await ok('POST', `/driver/orders/${orderId}/accept`, undefined, ctx.driverAToken, 'Driver A accept');
    await ok('POST', `/driver/orders/${orderId}/pickup-confirm`, undefined, ctx.driverAToken, 'Driver A pickup-confirm');

    const otp = await customerDeliveryOtp(ctx, orderId);
    const wrong = otp === '000000' ? '111111' : '000000';
    const fail = await expectFail('POST', `/driver/orders/${orderId}/verify-otp`, { otp: wrong }, ctx.driverAToken, 'Driver A wrong OTP (should fail)', 422);
    assert((fail.body as any)?.attemptsRemaining === 4, `expected attemptsRemaining=4 after one miss, got ${JSON.stringify(fail.body)}`);

    const stillOut = await getOrderAdmin(ctx, orderId);
    assert(stillOut.status === 'out_for_delivery', `expected order to remain out_for_delivery, got ${stillOut.status}`);

    // Clean completion with the correct OTP so the order doesn't dangle.
    const delivered = await ok('POST', `/driver/orders/${orderId}/verify-otp`, { otp }, ctx.driverAToken, 'Driver A correct OTP');
    assert(delivered.status === 'delivered', `expected delivered after correct OTP, got ${delivered.status}`);

    return `wrong OTP correctly rejected with HTTP ${fail.status}, correct OTP then delivered order`;
  });
}

async function s12_doubleAcceptRace(ctx: Ctx) {
  await scenario('S12 — Double-accept race: two drivers accept the same order simultaneously', async () => {
    const order = await advanceToReadyForPickup(ctx);
    const orderId = id(order);

    const [a, b] = await Promise.allSettled([
      call('POST', `/driver/orders/${orderId}/accept`, undefined, ctx.driverAToken),
      call('POST', `/driver/orders/${orderId}/accept`, undefined, ctx.driverBToken),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    assert(fulfilled.length === 1, `expected exactly one accept to succeed, got ${fulfilled.length}`);
    assert(rejected.length === 1, `expected exactly one accept to fail, got ${rejected.length}`);
    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
    assert(
      rejectedReason instanceof ApiError && rejectedReason.status === 409,
      `expected the losing accept to fail with HTTP 409, got: ${rejectedReason}`,
    );

    return `race resolved cleanly — exactly one driver won, the other got HTTP 409`;
  });
}

async function s13_otpLockoutThenAdminDelivers(ctx: Ctx) {
  await scenario('S13 — Five wrong OTPs lock the order (429); admin completes it as delivered', async () => {
    const order = await advanceToReadyForPickup(ctx);
    const orderId = id(order);

    await ok('POST', `/driver/orders/${orderId}/accept`, undefined, ctx.driverAToken, 'Driver A accept');
    await ok('POST', `/driver/orders/${orderId}/pickup-confirm`, undefined, ctx.driverAToken, 'Driver A pickup-confirm');
    const otp = await customerDeliveryOtp(ctx, orderId);
    const wrong = otp === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i += 1) {
      await expectFail('POST', `/driver/orders/${orderId}/verify-otp`, { otp: wrong }, ctx.driverAToken, `wrong OTP #${i + 1}`, 422);
    }
    const locked = await expectFail('POST', `/driver/orders/${orderId}/verify-otp`, { otp }, ctx.driverAToken, 'correct OTP after lockout (should fail)', 429);

    const delivered = await ok('PATCH', `/admin/orders/${orderId}/status`, { status: 'delivered', note: 'E2E: completed by support after OTP lockout' }, ctx.adminToken, 'Admin mark delivered');
    assert(delivered.status === 'delivered' && delivered.paymentStatus === 'paid', `expected delivered+paid, got ${delivered.status}/${delivered.paymentStatus}`);

    return `locked out with HTTP ${locked.status} after 5 misses, admin delivered order ${order.orderNumber}`;
  });
}

async function s14_offlineAndRejectedDriverRules(ctx: Ctx) {
  await scenario('S14 — Offline driver cannot accept (403); rejected orders vanish from that driver\'s list only', async () => {
    const order = await advanceToReadyForPickup(ctx);
    const orderId = id(order);

    await ok('PATCH', '/driver/status', { isOnline: false }, ctx.driverBToken, 'Driver B go offline');
    const offline = await expectFail('POST', `/driver/orders/${orderId}/accept`, undefined, ctx.driverBToken, 'Offline accept (should fail)', 403);
    assert((offline.body as any)?.reason === 'driver_offline', `expected reason=driver_offline, got ${JSON.stringify(offline.body)}`);
    await ok('PATCH', '/driver/status', { isOnline: true, lat: 12.9716, lng: 77.5946 }, ctx.driverBToken, 'Driver B go online');

    await ok('POST', `/driver/orders/${orderId}/reject`, { reasonCode: 'too_far' }, ctx.driverAToken, 'Driver A reject');
    const availableA = await ok('GET', '/driver/orders/available', undefined, ctx.driverAToken, 'Driver A available');
    assert(!availableA.some((o: any) => id(o) === orderId), 'rejected order must not be offered to driver A again');
    const availableB = await ok('GET', '/driver/orders/available', undefined, ctx.driverBToken, 'Driver B available');
    assert(availableB.some((o: any) => id(o) === orderId), 'rejected order must still be offered to driver B');

    const delivered = await driverDeliver(ctx, orderId, ctx.driverBToken, 'Driver B');
    assert(delivered.status === 'delivered', `expected delivered, got ${delivered.status}`);
    await expectFail('POST', `/driver/orders/${orderId}/reject`, {}, ctx.driverAToken, 'Reject a delivered order (should fail)', 409);

    return `offline accept -> 403, reject hid order ${order.orderNumber} from A only, B delivered it`;
  });
}

async function s15_adminReassignsOutForDelivery(ctx: Ctx) {
  await scenario('S15 — Admin pulls an out_for_delivery order back to ready_for_pickup; driver B redelivers with a fresh OTP', async () => {
    const order = await advanceToReadyForPickup(ctx);
    const orderId = id(order);

    await ok('POST', `/driver/orders/${orderId}/accept`, undefined, ctx.driverAToken, 'Driver A accept');
    await ok('POST', `/driver/orders/${orderId}/pickup-confirm`, undefined, ctx.driverAToken, 'Driver A pickup-confirm');
    await customerDeliveryOtp(ctx, orderId);

    const reassigned = await ok('PATCH', `/admin/orders/${orderId}/status`, { status: 'ready_for_pickup', note: 'E2E admin reassignment' }, ctx.adminToken, 'Admin reassign');
    assert(reassigned.status === 'ready_for_pickup' && !reassigned.driverId, `expected unassigned ready_for_pickup, got ${reassigned.status}/${reassigned.driverId}`);
    const customerView = await getOrderCustomer(ctx, orderId);
    assert(customerView.driver === null && (customerView.deliveryOtp === undefined || customerView.deliveryOtp === null), 'driver + OTP must be cleared after reassignment');

    await expectFail('POST', `/driver/orders/${orderId}/verify-otp`, { otp: '000000' }, ctx.driverAToken, 'Driver A verify after reassignment (should fail)', 404);

    const delivered = await driverDeliver(ctx, orderId, ctx.driverBToken, 'Driver B');
    assert(delivered.status === 'delivered', `expected delivered, got ${delivered.status}`);

    return `order ${order.orderNumber} reassigned by admin, delivered by driver B`;
  });
}

async function s16_registrationLocked(ctx: Ctx) {
  await scenario('S16 — Registration steps are locked once submitted/approved (409 registration_locked)', async () => {
    const vendorFail = await expectFail('PATCH', '/vendor/registration/business-type', { businessType: 'partnership' }, ctx.vendorToken, 'Vendor edit locked step (should fail)', 409);
    assert((vendorFail.body as any)?.reason === 'registration_locked', `expected reason=registration_locked, got ${JSON.stringify(vendorFail.body)}`);
    const driverFail = await expectFail('PATCH', '/driver/registration/vehicle-type', { vehicleType: 'bicycle' }, ctx.driverAToken, 'Driver edit locked step (should fail)', 409);
    assert((driverFail.body as any)?.reason === 'registration_locked', `expected reason=registration_locked, got ${JSON.stringify(driverFail.body)}`);

    const invalidId = await expectFail('GET', '/admin/orders/not-an-id', undefined, ctx.adminToken, 'Non-Mongo id (should fail)', 422);
    return `vendor+driver locked steps -> 409 registration_locked; malformed :id -> ${invalidId.status}`;
  });
}

async function s17_ratingAndProfileGuards(ctx: Ctx) {
  await scenario('S17 — Customer rates a delivered order (driver + vendor); vendor cannot edit KYC via PATCH /vendor/me', async () => {
    const order = await advanceToReadyForPickup(ctx);
    const orderId = id(order);
    await driverDeliver(ctx, orderId, ctx.driverAToken, 'Driver A');

    const rating = await ok('POST', `/customer/orders/${orderId}/rate`, { stars: 5, reviewText: 'E2E great delivery' }, ctx.customerToken, 'Rate order');
    assert(rating.vendorRating === 5, `expected vendorRating=5, got ${rating.vendorRating}`);
    await expectFail('POST', `/customer/orders/${orderId}/rate`, { stars: 4 }, ctx.customerToken, 'Rate twice (should fail)', 409);

    const stats = await ok('GET', '/vendor/me/stats', undefined, ctx.vendorToken, 'Vendor stats');
    assert(typeof stats.rating === 'number' && stats.rating >= 1 && stats.rating <= 5, `vendor rating should be a 1-5 average, got ${stats.rating}`);

    const kycFail = await expectFail('PATCH', '/vendor/me', { panDetails: { panNumber: 'ZZZZZ9999Z' } }, ctx.vendorToken, 'Edit PAN via profile (should fail)', 422);
    const updated = await ok('PATCH', '/vendor/me', { storeInfo: { landmark: 'E2E updated landmark' } }, ctx.vendorToken, 'Edit store landmark');
    assert(updated.storeInfo?.landmark === 'E2E updated landmark', 'editable storeInfo field should update');

    return `order ${order.orderNumber} rated (vendor avg ${stats.rating}), PAN edit -> ${kycFail.status}, landmark edit ok`;
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(80));
  console.log('Verdant E2E order-lifecycle test');
  console.log(`Target: ${BASE}`);
  console.log('='.repeat(80));

  console.log('\n--- Setup phase ---');

  console.log('Logging in as admin...');
  const adminToken = await adminLogin();

  console.log('Ensuring a product category exists...');
  const categoryId = await ensureCategory(adminToken);

  console.log('Onboarding E2E vendor (registration -> approval -> store setup -> product)...');
  const { vendorToken, vendorId, productId, variantId } = await setupVendor(adminToken, categoryId);

  console.log('Onboarding E2E driver A...');
  const { driverToken: driverAToken, driverId: driverAId } = await setupDriver(adminToken, DRIVER_A_PHONE, 'A');

  console.log('Onboarding E2E driver B...');
  const { driverToken: driverBToken, driverId: driverBId } = await setupDriver(adminToken, DRIVER_B_PHONE, 'B');

  console.log('Onboarding E2E customer...');
  const { customerToken, customerId, addressId } = await setupCustomer();

  const ctx: Ctx = {
    adminToken,
    vendorToken,
    vendorId,
    categoryId,
    productId,
    variantId,
    driverAToken,
    driverAId,
    driverBToken,
    driverBId,
    customerToken,
    customerId,
    addressId,
  };

  console.log('Setup complete.\n');

  console.log('--- Running scenarios ---');
  await s1_happyPath(ctx);
  await s2_customerCancelWhilePlaced(ctx);
  await s3_customerCancelBlockedAfterReady(ctx);
  await s4_vendorRejectsAtPlaced(ctx);
  await s5_vendorCancelsAtPreparing(ctx);
  await s6_adminForceCancels(ctx);
  await s7_driverReassignmentViaIssue(ctx);
  await s8_driverEmergencyReassignment(ctx);
  await s9_deliveryFailure(ctx);
  await s10_invalidTransitionRejected(ctx);
  await s11_wrongDeliveryOtpRejected(ctx);
  await s12_doubleAcceptRace(ctx);
  await s13_otpLockoutThenAdminDelivers(ctx);
  await s14_offlineAndRejectedDriverRules(ctx);
  await s15_adminReassignsOutForDelivery(ctx);
  await s16_registrationLocked(ctx);
  await s17_ratingAndProfileGuards(ctx);

  // --- Summary ---------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  for (const r of results) {
    console.log(`${r.passed ? '✅' : '❌'} ${r.name}\n   ${r.detail}`);
  }
  const passCount = results.filter((r) => r.passed).length;
  console.log(`\n${passCount}/${results.length} scenarios passed.`);

  console.log('\n' + '='.repeat(80));
  console.log('TEST ACCOUNT CREDENTIALS (left in the database — not cleaned up)');
  console.log('='.repeat(80));
  console.log(`Customer  | phone: ${CUSTOMER_PHONE} | OTP: ${DEV_OTP} | id: ${customerId}`);
  console.log(`Vendor    | phone: ${VENDOR_PHONE} | email: ${VENDOR_EMAIL} | password: ${VENDOR_PASSWORD} | id: ${vendorId}`);
  console.log(`Driver A  | phone: ${DRIVER_A_PHONE} | OTP: ${DEV_OTP} | id: ${driverAId}`);
  console.log(`Driver B  | phone: ${DRIVER_B_PHONE} | OTP: ${DEV_OTP} | id: ${driverBId}`);
  console.log(`Admin     | email: ${ADMIN_EMAIL} | password: ${ADMIN_PASSWORD}`);
  console.log(`Product   | id: ${productId} | variant: ${variantId}`);
  console.log('='.repeat(80));

  if (passCount < results.length) process.exit(1);
}

main().catch((err) => {
  console.error('\nFATAL — setup or an unrecoverable error occurred:');
  console.error(err);
  process.exit(1);
});
