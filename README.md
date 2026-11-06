# Virtual Rudra Restaurant Ordering

A restaurant ordering and administration app built with Next.js, TypeScript, Tailwind CSS, and Supabase.

## Requirements

- Node.js 20 or newer and npm.
- A Supabase project.
- An administrator email, a unique password, and a random session secret.

## Local setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set the variables described below. Never commit `.env.local` or expose the Supabase service-role key to the browser.

3. Apply the application migrations to the Supabase project in the listed order. In the Supabase Dashboard, open **SQL Editor**, create a query for each file, and run the complete file:

   1. `supabase/migrations/20261028000000_orders.sql`
   2. `supabase/migrations/20261030000000_admin_security_store.sql`
   3. `supabase/migrations/20261031000000_restaurant_profile_fields.sql`
   4. `supabase/migrations/20261031120000_order_tracking_tokens.sql`
   5. `supabase/migrations/20261031130000_restaurant_feedback.sql`
   6. `supabase/migrations/20261031140000_restaurant_qr_scan_analytics.sql`

   These migrations create the restaurant, menu, table, order, feedback, scan, and private admin-security storage structures used by the app. Do not run the unrelated `20261001*` migrations in this repository for this application.

4. Create an active restaurant row and configure `SUPABASE_RESTAURANT_ID` with its UUID. Add active tables, categories, and menu items for that restaurant before accepting customer orders. The order API validates tables and menu items in Supabase and calculates prices there; browser demo data is not used to create orders.

5. Start the development server:

   ```sh
   npm run dev
   ```

   Open `http://localhost:3000`. The admin login is available directly at `/admin/login`; sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Expo Go

The separate `mobile/` Expo app opens this existing website in a WebView, with a native QR scanner that opens valid table menu codes in the app. Menu, ordering, and tracking continue to use the existing website and Supabase APIs; the Next.js website remains unchanged. From the repository root, run:

```sh
cd mobile
npm install
npm run start
```

The Next.js website uses port `3000`; Expo Go and Expo Web use port `8082` through the provided mobile scripts. The Expo scripts use LAN mode so the QR code advertises the computer's detected LAN address. Open Expo Go on your phone and scan its QR code. The native app loads the hosted website by default. To test the local website on a phone, set `EXPO_PUBLIC_WEB_URL` to a LAN-reachable URL such as `http://192.168.1.10:3000` before starting Expo; `localhost` on the phone will not reach your computer. If your network blocks LAN connections, use the Expo tunnel script on port `8082`. To open the existing website in Expo Web, run `npm run web` from `mobile/`; Expo Web hands off to the Next.js admin login on port `3000`, using the same host you used to open Expo Web, and shows a sign-in link during handoff. It does not embed a second copy of the admin UI. If the Next.js site uses a different host (including for a web export), set `EXPO_PUBLIC_WEB_URL` to its reachable origin before starting or exporting.

The Supabase migrations enable row-level security and revoke direct public/authenticated access to application data. Server routes use the service-role key and explicitly scope reads and writes to `SUPABASE_RESTAURANT_ID`. This configuration serves **one restaurant per app deployment**; it is not a multi-restaurant admin account or tenant selector.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL used by server-side APIs. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only Supabase service-role key. Never use a `NEXT_PUBLIC_` prefix or commit its value. |
| `SUPABASE_RESTAURANT_ID` | Yes | UUID of the restaurant served by this deployment. |
| `ADMIN_EMAIL` | Yes | Email accepted by the app's environment-configured admin sign-in. |
| `ADMIN_PASSWORD` | Yes | Admin password. Production requires at least 16 characters, at least three character classes, and a non-default value. |
| `ADMIN_SESSION_SECRET` | Yes | Random secret of at least 32 characters used to sign admin sessions. |
| `NEXT_PUBLIC_MENU_ORIGIN` | For QR codes scanned on other devices | Public HTTPS origin embedded in table QR codes. Set before building for deployment. |
| `NEXT_PUBLIC_DEV_LAN_HOST` | Optional, development only | Reachable LAN host used when generating table QR codes locally; leave unset if unused. |

Generate a session secret locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Keep the generated value private and put it only in your local environment or hosting secret manager. `.env.example` contains placeholders, not usable credentials.

## Features

- Customer menu, cart, checkout, and order creation using Supabase-validated prices and active table/menu records.
- Idempotent order submissions and private tracking links. Tracking URLs contain a random bearer token; only its SHA-256 hash is stored. The tracking API returns order status and details without exposing the hash.
- Admin sign-in with an HTTP-only session cookie, session expiration/revocation, and database-backed login throttling.
- Restaurant-scoped category, menu item, table, and profile management.
- Admin dashboard with live restaurant order counts, served/completed orders, non-cancelled revenue, QR scan totals, current menu summaries, and recent orders.
- In-dashboard recent-order notifications with unread/read state persisted in browser storage under a restaurant-specific key.
- Restaurant Profile support for saving and testing a Google Review URL and generating/downloading a QR code that opens that URL. Reviews are not imported or filtered.
- Customer feedback with a 1–5 rating and optional comment, stored against the restaurant and order; admins can view the restaurant's feedback.
- Table QR scan analytics that store the restaurant/table association, QR type, and timestamp, without collecting personal data.
- Menu item image upload through the authenticated server route using the public Supabase Storage bucket named `product-images`. Configure that bucket with a 5 MiB limit and allow JPEG, PNG, WebP, and AVIF.

Order creation and QR scan recording are public customer operations; their APIs validate submitted data and derive tenant scope from server configuration. Order tracking and feedback submission require an order's private tracking token. Admin data APIs verify the admin session and scope Supabase operations to the configured restaurant.

For table QR codes to work on other devices, the app must be served from a publicly reachable HTTPS origin and `NEXT_PUBLIC_MENU_ORIGIN` must be set to that origin before building. Localhost QR codes only work on the device running the app; a LAN origin requires the phone and server to share a network.

Development builds ignore `NEXT_PUBLIC_MENU_ORIGIN` so local QR codes cannot accidentally point to the production site. They use the development app origin and, when opened on localhost, the detected `NEXT_PUBLIC_DEV_LAN_HOST`.

## Validation

Run the TypeScript check, lint, and production build:

```sh
npx tsc --noEmit
npm run lint
npm run build
```

For a focused lint check on the primary customer and admin flows:

```sh
npx eslint app/menu/menu-client.tsx app/api/orders/route.ts app/api/orders/track/route.ts app/api/feedback/route.ts app/api/qr-scans/route.ts app/api/admin/session/route.ts app/api/admin/feedback/route.ts app/api/admin/qr-analytics/route.ts app/admin/dashboard/dashboard-client.tsx
```
