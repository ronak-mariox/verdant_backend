# Verdant Backend

A single Node.js + Express + TypeScript backend providing authentication and
authorization for all four clients in this repo: the **Verdant** customer app,
**vender_app** (vendor app), **DeliveryApp** (driver app), and the **admin_panel**
web app.

## Stack

- **Express 5** (TypeScript)
- **MongoDB + Mongoose** — models in `src/models/`; multi-step registration data (business info, owner info, vehicle details, etc.) is stored as native nested documents, not stringified JSON
- **JWT** (`jsonwebtoken`) — short-lived access tokens (15m) + rotating refresh tokens (30d)
- **bcryptjs** — password and OTP hashing (bcrypt-compatible, pure JS — no native build step)
- **express-validator** — request validation on every route
- **express-rate-limit** — throttles OTP request endpoints
- **multer** — file uploads (profile photos, KYC documents), served from `/uploads`
- **helmet**, **cors**, **morgan** — standard security/logging middleware

## Code layout

```
src/
  routes/        Route registration only — path, HTTP method, express-validator
                 chains, middleware. No business logic.
  controllers/   All business logic — DB reads/writes, branching, responses.
                 One controller file per routes file (e.g. routes/vendor.ts ->
                 controllers/vendorController.ts).
  models/        Mongoose schemas.
  middleware/    authenticate/authorize, validation-error handling, error handler.
  lib/           Small shared utilities (jwt, otp, tokens, upload, sanitize, env).
```

## Getting started

```bash
cd backend
npm install
npm run seed   # connects to MongoDB and creates the default admin user
npm run dev    # starts the API on http://localhost:4000
```

### Database

Set `MONGODB_URI` in `.env` to a real MongoDB connection string — a local
`mongod` (`mongodb://127.0.0.1:27017/verdant`) or a MongoDB Atlas URI both work
as-is, no schema migration step needed (Mongoose creates collections/indexes on
first write).

For zero-setup local development/CI, you can instead set `MONGODB_URI="memory"`
— on startup the server downloads and runs a real local `mongod` binary in a
temp directory automatically (via `mongodb-memory-server`), no system-wide
MongoDB install required. **Data does not persist across restarts in this mode**
— use a real `MONGODB_URI` for anything you want to keep.

Default admin login (change `DEFAULT_ADMIN_PASSWORD` in `.env` for anything real):
- email: `admin@verdant.com`
- password: `verdant@123`

### Environment variables

See `.env.example`. A working `.env` is already checked in for local development
with dev-only secrets — **do not reuse those secrets in production.**

### OTP delivery (dev mode)

No SMS gateway is configured (would need a paid provider like Twilio/MSG91 with
real credentials). In development, every OTP-request response includes a `devOtp`
field with the plaintext code, the code is logged to the server console, and the
fixed `DEV_MASTER_OTP` (default `123456`) always verifies. In production
(`NODE_ENV=production`) `devOtp` is omitted and nothing is logged — wire a real
SMS provider inside `src/lib/otp.ts#createOtp` at the marked spot.

The **delivery OTP** is dummy too: on pickup it is stored on the order and shown
to the customer in-app (`GET /api/customer/orders/:id` -> `deliveryOtp`, plus the
out-for-delivery notification) while the order is `out_for_delivery`; the rider
types it in. Five wrong attempts lock the order (429) until an admin resolves it.

Payments are **COD only** — `paymentStatus` flips to `paid` when the order is
delivered. No payment gateway, push service or SMS provider is integrated.

## Auth model

Four independent identity types, one shared token/refresh mechanism:

| Role | Login method | Notes |
|---|---|---|
| `customer` (Verdant) | phone + OTP | OTP verify on an unknown number returns a signup token instead of creating the account — see `register` below |
| `vendor` (vender_app) | phone OTP to verify → password account, then phone/email + password | OTP-verify with `intent: "login"` doubles as password-reset |
| `driver` (DeliveryApp) | phone + OTP | first OTP verify auto-creates the account, then multi-step registration |
| `admin` (admin_panel) | email + password | seed one with `npm run seed` |

All tokens are JWTs signed with role-specific claims (`{ sub, role }`). Access
tokens are short-lived (15 min); refresh tokens rotate on every use via
`POST /api/auth/refresh` — the old refresh token is revoked the moment a new one
is issued, so replaying a stolen refresh token fails after the legitimate client
has refreshed once.

Passwords and OTP codes are **never stored in plaintext** — both are bcrypt-hashed
before hitting the database.

## Multi-step registration

Vendor and driver registration (matching vender_app's `RegistrationContext` and
DeliveryApp's Registration wizard) is persisted **server-side, step by step**, via
`PATCH` requests per screen — so the flow is resumable if the app is closed
mid-registration (`GET /api/vendor/registration` / `GET /api/driver/registration`
return everything filled in so far, to pre-fill the UI on return).

Admin approval is real: `PATCH /api/admin/vendors/:id/status` and
`PATCH /api/admin/drivers/:id/status` set the actual `status`/`kycStatus` fields
that `GET /api/vendor/registration/status` / `GET /api/driver/registration/status`
report (both include `nextStep`, the first unfilled step key, or `null`).

Once a registration is submitted (or approved) every step `PATCH` returns
`409 { reason: "registration_locked" }`; only a `rejected` account may edit and
resubmit. Post-approval profile edits go through `PATCH /api/vendor/me`, which
accepts only display fields — PAN/GST/business-proof/bank details are 422'd there
and change via the document-replace / bank-details-request review flows.

### Account status enforcement

`authenticate` loads the account behind every token: a `blocked` customer or a
`suspended`/`rejected` vendor/driver gets
`403 { error, reason: "account_restricted", status }` on every request (and on
`POST /api/auth/refresh` and vendor login). Driver order endpoints additionally
require `status: "active"`, and `accept` requires the driver to be online.

## Order lifecycle

`src/lib/orderStatus.ts` is the single state machine:

```
placed -> accepted -> preparing -> ready_for_pickup -> out_for_delivery -> delivered
   \        \             \              \                  \
    rejected  cancelled     cancelled      cancelled          cancelled / back to ready_for_pickup (reassignment)
```

- Vendors move orders up to `ready_for_pickup` (and reject/cancel before pickup).
- Drivers (active + online) accept from the pool, `pickup-confirm` (-> `out_for_delivery`,
  generates the delivery OTP) and `verify-otp` (-> `delivered`, atomic; ledger,
  incentive and settlement rows are written once).
- Customers may cancel only while `placed` or `accepted`.
- Reassignment (driver issue, emergency, or admin `out_for_delivery -> ready_for_pickup`)
  clears the driver, pickup time and OTP and returns the order to the pool.
- Cancel/reject restores stock and releases the coupon use; a `refund`
  notification is sent only if the order was already `paid`.

**Money:** drivers earn a flat `DRIVER_BASE_PAY` (₹30) per delivery plus
distance/on-time bonuses (`src/lib/driverEarnings.ts`). Vendor settlement per
delivered order = `itemsTotal + taxTotal` gross, 8% commission on `itemsTotal`
(`commissionRate` is the fraction `0.08`), 18% GST on the commission; platform
coupons, delivery and platform fees never touch the vendor payout
(`src/lib/commission.ts`). Settlements roll into Mon-Sun payout batches that are
re-totalled while `pending` (`src/lib/settlementBatches.ts`).

## Route list

See each router file under `src/routes/` for exact validation rules. All `:id`
params must be Mongo ObjectIds (422 otherwise; a stray CastError maps to 400).
List endpoints marked `[]` return a bare array (optionally sliced with
`?page&limit`, capped at 200 rows); those marked `{}` return
`{ items, page, limit, total, totalPages }`.

```
GET  /api/health

POST /api/auth/refresh                       { refreshToken }
POST /api/auth/logout                        { refreshToken }

POST /api/customer/auth/otp/request          { phone }
POST /api/customer/auth/otp/verify           { phone, otp }   -> existing number: tokens + user; new number: { isNewUser: true, verifiedPhoneToken }
POST /api/customer/auth/register             { verifiedPhoneToken, name, email? }
GET  /api/customer/me                        (auth: customer)
PATCH /api/customer/me                       { name?, email?, dob?, gender? }
POST /api/customer/me/avatar                 multipart "avatar"
GET  /api/customer/categories | /vendors | /products | /products/:id | /search   catalog
GET|POST|PATCH|DELETE /api/customer/addresses[/:id][/default]
GET  /api/customer/cart · POST /cart/items · PATCH /cart/items/:productId/:variantId · coupon apply/remove
GET  /api/customer/orders                    [] each with deliveryOtp (while out_for_delivery) + driver card
POST /api/customer/orders                    { addressId, paymentMethod: "cod" }
GET  /api/customer/orders/:id
POST /api/customer/orders/:id/cancel         only while placed/accepted
POST /api/customer/orders/:id/rate           { stars, reviewText? } -> rates driver (if any) + vendor
GET  /api/customer/notifications             [] (orderId + orderNumber + data on order notifications)
GET|POST /api/customer/wishlist[/:productId/toggle]

POST /api/vendor/auth/otp/request            { phone }
POST /api/vendor/auth/otp/verify             { phone, otp, intent: "login"|"create-account" }
POST /api/vendor/auth/register               { verifiedPhoneToken, fullName, email, password, confirmPassword }
POST /api/vendor/auth/login                  { identifier, password }
POST /api/vendor/auth/reset-password         { resetToken, newPassword }
GET  /api/vendor/me                          (auth: vendor)
POST /api/vendor/me/avatar                   multipart "avatar"
PATCH /api/vendor/registration/business-type
PATCH /api/vendor/registration/business-info
PATCH /api/vendor/registration/owner-info
PATCH /api/vendor/registration/store-info
PATCH /api/vendor/registration/gst-details
PATCH /api/vendor/registration/pan-details
PATCH /api/vendor/registration/business-proof
PATCH /api/vendor/registration/bank-details
POST /api/vendor/registration/documents      multipart "file" -> { url }
GET  /api/vendor/registration                full saved state so far
GET  /api/vendor/registration/status         { status, kycStatus, registrationStep, nextStep, storeSetupCompleted, referenceId, rejectionReason, stepReviews }
POST /api/vendor/registration/submit         409 registration_locked once submitted (unless rejected)
PATCH /api/vendor/me                         display fields only (ownerInfo/businessInfo/storeInfo/storeProfile)
GET  /api/vendor/me/stats                    { orders, revenue, rating, ratingCount }
GET|POST|PATCH|DELETE /api/vendor/me/addresses, /me/documents/*, /me/bank-details/request, /me/notification-prefs
GET  /api/vendor/me/settlements · /me/payout-batches[/:id]
PATCH /api/vendor/store-setup/*  · POST /api/vendor/store-setup/complete
GET  /api/vendor/products                    [] ?status&search&page&limit
POST /api/vendor/products · PATCH /products/:id   validated body (variants, price <= mrp, active category)
PATCH /api/vendor/products/:id/stock | /availability · DELETE /products/:id
GET  /api/vendor/orders                      [] ?status&page&limit
PATCH /api/vendor/orders/:id/status          accepted|rejected|cancelled|preparing|ready_for_pickup
GET|POST /api/vendor/offers · PATCH /offers/:id · PATCH /offers/:id/pause|resume · DELETE   (productIds + categoryIds)
GET  /api/vendor/notifications               [] (new-order is the poll trigger; carries orderNumber)
GET  /api/vendor/analytics/*

POST /api/driver/auth/otp/request            { phone }
POST /api/driver/auth/otp/verify             { phone, otp }
GET  /api/driver/me                          (auth: driver) toSafeJson: id, status, kycStatus, registrationStep, isOnline, ...
POST /api/driver/me/avatar                   multipart "avatar"
PATCH /api/driver/status                     { isOnline, lat?, lng? }
PATCH /api/driver/location                   { lat, lng }
GET  /api/driver/home-summary
POST /api/driver/uploads/evidence            multipart "file" (image) -> { url }
PATCH /api/driver/registration/personal-info
PATCH /api/driver/registration/address
PATCH /api/driver/registration/emergency-contact
PATCH /api/driver/registration/vehicle-type
PATCH /api/driver/registration/vehicle-details
POST /api/driver/registration/documents      multipart "file" + body "type" ∈ license_front|license_back|rc|insurance
PATCH /api/driver/registration/insurance-details
PATCH /api/driver/registration/bank-details
GET  /api/driver/registration
GET  /api/driver/registration/status         { status, kycStatus, registrationStep, nextStep, referenceId, rejectionReason }
POST /api/driver/registration/submit         needs every step + license_front/license_back/rc/insurance
GET  /api/driver/orders/available            [] ready_for_pickup pool minus orders this driver rejected (active drivers)
GET  /api/driver/orders/active · /orders/history?tab&page&limit []
POST /api/driver/orders/:id/accept           active + online
POST /api/driver/orders/:id/reject · /pickup-confirm · /verify-otp { otp } (5 wrong -> 429) · /issue
GET  /api/driver/earnings/* · /incentives/* · /performance/* · /notifications
POST /api/driver/emergency/activate | /incidents | /share-location | /support-contact

POST /api/admin/auth/login                   { email, password }
GET  /api/admin/me                           (auth: admin)
GET  /api/admin/dashboard                    delivered-only revenue; pendingVendorApprovals/pendingVendorRegistrations
GET  /api/admin/vendors [] · /vendors/pending · /vendors/:id · /vendors/:id/settlements
PATCH /api/admin/vendors/:id/status          { status, kycStatus?, rejectionReason? } (kyc: verified on active, rejected on rejected, unchanged on suspended)
GET  /api/admin/drivers [] · /drivers/pending · /drivers/:id
PATCH /api/admin/drivers/:id/status          same rules; notifies the driver
GET  /api/admin/customers [] · /customers/:id · PATCH /customers/:id/status
GET|POST|PATCH|DELETE /api/admin/categories[/:id][/subcategories/:subId]
GET  /api/admin/products {} · PATCH /products/:id (validated) · PATCH /products/:id/status
GET  /api/admin/orders {} ?status&vendorId&customerId&driverId&page&limit
PATCH /api/admin/orders/:id/status           any transition allowed to admin, incl. out_for_delivery -> ready_for_pickup
GET|POST|PATCH|DELETE /api/admin/coupons     (PATCH accepts code)
GET  /api/admin/support-tickets {} · PATCH /support-tickets/:id { status?, priority?, note? }
GET  /api/admin/settlements/vendors · /settlements/drivers
GET  /api/admin/settlements/batches {} ?status&page&limit (vendorName embedded)
PATCH /api/admin/settlements/batches/:id/paid | /failed
GET|POST /api/admin/incentives · PATCH|DELETE /incentives/:id
```

## Scope note

This backend is the real data source for all four clients: auth/registration,
catalog, cart/orders, delivery, earnings, settlements, coupons/offers,
notifications, support tickets and admin moderation. What is intentionally
**dummy/absent**: SMS (OTPs are dev-visible), online payments (COD only), push
notifications (clients poll the notification endpoints), and third-party
providers of any kind.

Dev seeds: `npm run seed` (admin), `npm run seed:catalog` (demo vendor +
products), `npm run seed:delivery` (demo driver, orders, two incentives).
`npm run test:e2e` drives a running server through the full lifecycle
(`E2E_BASE_URL` to point it elsewhere). It is self-seeding (the server creates
the admin on boot; the test creates its own category/vendor/drivers/customer),
so it also runs against `MONGODB_URI=memory`, e.g.
`MONGODB_URI=memory PORT=4100 npm run dev` then
`E2E_BASE_URL=http://localhost:4100/api npm run test:e2e`.

## Connecting from a device / emulator

The apps default to `http://localhost:4000` in development. If you test on a
physical phone or an Android emulator, `localhost` refers to the device itself,
not your computer:

- **Android emulator**: use `http://10.0.2.2:4000`
- **Physical device on the same Wi-Fi**: use your computer's LAN IP, e.g. `http://192.168.1.23:4000`
- **iOS Simulator**: `http://localhost:4000` works as-is
