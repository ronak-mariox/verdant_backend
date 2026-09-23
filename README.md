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
- email: `admin@verdant.app`
- password: `Verdant@123`

### Environment variables

See `.env.example`. A working `.env` is already checked in for local development
with dev-only secrets — **do not reuse those secrets in production.**

### OTP delivery (dev mode)

No SMS gateway is configured (would need a paid provider like Twilio/MSG91 with
real credentials). In development, every OTP-request response includes a `devOtp`
field with the plaintext code, and the code is also logged to the server console.
In production (`NODE_ENV=production`) `devOtp` is omitted — wire a real SMS
provider inside `src/lib/otp.ts#createOtp` at the marked spot.

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
report — no more client-side `Math.random()` approval rolls.

## Full route list

See each router file for exact validation rules: `src/routes/customer.ts`,
`src/routes/vendor.ts`, `src/routes/driver.ts`, `src/routes/admin.ts`, `src/routes/auth.ts`.

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
GET  /api/vendor/registration/status         { status, kycStatus, referenceId, rejectionReason }
POST /api/vendor/registration/submit

POST /api/driver/auth/otp/request            { phone }
POST /api/driver/auth/otp/verify             { phone, otp }
GET  /api/driver/me                          (auth: driver)
POST /api/driver/me/avatar                   multipart "avatar"
PATCH /api/driver/registration/personal-info
PATCH /api/driver/registration/address
PATCH /api/driver/registration/emergency-contact
PATCH /api/driver/registration/vehicle-type
PATCH /api/driver/registration/vehicle-details
POST /api/driver/registration/documents      multipart "file" + body "type" ∈ license_front|license_back|rc|insurance
PATCH /api/driver/registration/insurance-details
PATCH /api/driver/registration/bank-details
GET  /api/driver/registration
GET  /api/driver/registration/status
POST /api/driver/registration/submit

POST /api/admin/auth/login                   { email, password }
GET  /api/admin/me                           (auth: admin)
GET  /api/admin/vendors/pending
PATCH /api/admin/vendors/:id/status          { status, kycStatus?, rejectionReason? }
GET  /api/admin/drivers/pending
PATCH /api/admin/drivers/:id/status          { status, kycStatus?, rejectionReason? }
```

## Scope note

This backend covers **authentication, authorization, and registration** for all
four clients — the explicit ask. It intentionally does **not** replace the mock
data the admin panel/vendor/driver apps already use for orders, catalog,
analytics, etc. — that's a separate, much larger integration that wasn't part of
this request.

## Connecting from a device / emulator

The apps default to `http://localhost:4000` in development. If you test on a
physical phone or an Android emulator, `localhost` refers to the device itself,
not your computer:

- **Android emulator**: use `http://10.0.2.2:4000`
- **Physical device on the same Wi-Fi**: use your computer's LAN IP, e.g. `http://192.168.1.23:4000`
- **iOS Simulator**: `http://localhost:4000` works as-is
