# MarketFlow

MarketFlow is a marketplace project with an Express REST API, PostgreSQL database, and React, TypeScript, and Vite storefront.

## Backend

The API requires PostgreSQL and JWT secrets. Copy `api/.env.example` to `api/.env`, set `DATABASE_URL`, `JWT_SECRET`, and `JWT_REFRESH_SECRET`, then run:

```sh
cd api
npm install
npm run dev
```

The API listens at `http://127.0.0.1:3000/`. It creates its PostgreSQL tables on first request. Set `DATABASE_SSL=false` for local PostgreSQL only; hosted databases generally require SSL.

## Frontend

From `frontend`, install packages and start Vite:

```powershell
npm install
npm run dev
```

The storefront runs at `http://localhost:5173/` and proxies `/api` requests to the hosted API. Local sign-ins, account creation, and marketplace changes therefore use the live service. To use a local API instead, change the proxy target in `frontend/vite.config.ts` to `http://127.0.0.1:3000`.

## API routes

- `POST /api/auth/register/` creates an account and returns access and refresh tokens.
- `POST /api/auth/login/` accepts email and password and returns access and refresh tokens.
- `POST /api/auth/refresh/` exchanges a refresh token for a new access token.
- `GET /api/auth/me/` returns the signed-in user's current role and seller application status.
- `POST /api/seller/apply/` requests admin approval for seller access.
- `POST /api/admin/bootstrap/` securely provisions the first allowlisted administrator using a one-time setup token.
- `GET /api/products/` lists active products from active stores without authentication.
- `GET /api/products/<id>/reviews/` lists reviews for an active product.
- `POST /api/products/<id>/reviews/` creates one review for a product the signed-in customer has paid for.
- `GET, POST /api/stores/` lists the current user's stores or creates a store owned by that user.
- `GET, PATCH /api/stores/<id>/` retrieves or updates one of the current user's stores.
- `GET, POST /api/seller/products/` lists or creates products in stores owned by the current user.
- `GET, PATCH, DELETE /api/seller/products/<id>/` manages one of the current user's products.
- `GET /api/seller/orders/` lists paid order items from stores owned by the current user.
- `PATCH /api/seller/order-items/<id>/` advances an owned paid item through processing, shipped, and delivered.
- `GET /api/seller/dashboard/` returns listing, paid-order, sales, and fulfillment counts for the current user.
- `/api/admin/summary/`, `/api/admin/users/`, `/api/admin/categories/`, `/api/admin/orders/`, and `/api/admin/products/` provide admin analytics and platform management.
- Admin user and product `PATCH` routes approve sellers, suspend accounts, and suspend or reinstate products.
- `GET /api/orders/` lists the current user's orders.
- `POST /api/orders/checkout/` validates inventory and starts either an M-Pesa STK Push or Stripe card checkout for the current user's order.
- `POST /api/payments/mpesa/callback/` receives Daraja payment confirmations.
- `POST /api/payments/stripe/webhook/` receives signed Stripe Checkout events.
- `GET /api/orders/<id>/` retrieves one of the current user's orders.

Customers can view order/payment progress in **My orders**. Product reviews are limited to one per customer and product, and can only be submitted after a successful purchase.
Sellers can review paid orders and sales totals in Seller Studio. Fulfillment updates are scoped to the seller's own order items and must follow the processing → shipped → delivered sequence; customer order tracking reflects item fulfillment progress.
Public registration always creates a customer account. Set `ADMIN_EMAILS` and a long random `ADMIN_BOOTSTRAP_TOKEN` in the API environment; sign up or sign in with the allowlisted account, choose **Set up admin**, and enter the one-time token. The server only accepts this bootstrap while no active administrator exists. Remove the token from Vercel after initial setup. Admin permissions are rechecked from the database on every authenticated request.

Authenticated requests send `Authorization: Bearer <access-token>`. Access tokens last 15 minutes; refresh tokens last 30 days.

Checkout requests contain a payment method and product IDs and quantities. The M-Pesa option also requires the customer's Kenyan phone number; for backward compatibility, omitting `payment_method` selects M-Pesa:

```json
{
	"payment_method": "mpesa",
	"phone_number": "+254712345678",
	"items": [
		{ "product_id": 1, "quantity": 2 }
	]
}
```

To use Stripe card checkout, send `"payment_method": "stripe"` and omit `phone_number`. The API creates the Checkout Session from server-verified product prices, reserves inventory while payment is pending, marks the order paid only after a signed webhook confirms the amount and currency, and restores stock when payment fails or the session expires. Card charges settle to the platform's Stripe account; seller account routing and payouts are not automated by this integration. M-Pesa continues to use Daraja STK Push and its callback. Both methods require a whole-number KES total. The production catalog must contain active seller listings; the storefront's sample preview listings are not purchasable. Order fulfillment and shipping notifications still require a shipping workflow.

## Currency

Catalog prices, new orders, and payments use Kenyan shillings (`KES`). The storefront preview prices were converted from USD at approximately KSh 129.54 per USD (rate checked October 4, 2026) and rounded to the nearest KSh 100. Existing order and payment records keep their originally stored amount and currency.

## Deploy with Vercel

Deploy the `api` and `frontend` directories as separate Vercel projects from the same repository. Configure the backend project's root directory as `/api`, with `api/vercel.json` as its deployment configuration.

### API project

Set these environment variables for Production and Preview:

```text
DATABASE_URL=<managed PostgreSQL connection string>
JWT_SECRET=<long random secret>
JWT_REFRESH_SECRET=<different long random secret>
CORS_ORIGIN=https://<your-frontend-vercel-domain>
ADMIN_EMAILS=<initial-admin-email>
ADMIN_BOOTSTRAP_TOKEN=<long-random-one-time-token>
MPESA_ENV=sandbox
MPESA_CONSUMER_KEY=<Daraja sandbox consumer key>
MPESA_CONSUMER_SECRET=<Daraja sandbox consumer secret>
MPESA_SHORTCODE=174379
MPESA_PASSKEY=<Daraja sandbox passkey>
MPESA_CALLBACK_URL=https://<your-api-vercel-domain>/api/payments/mpesa/callback/
FRONTEND_URL=https://<your-storefront-vercel-domain>
STRIPE_SECRET_KEY=<Stripe secret API key>
STRIPE_WEBHOOK_SECRET=<Stripe webhook signing secret>
```

The API requires a persistent PostgreSQL database; Vercel's function filesystem and process memory are not persistent. The API initializes the schema automatically.
Use Daraja sandbox credentials and test numbers first. For Stripe, configure a webhook endpoint at `https://<your-api-vercel-domain>/api/payments/stripe/webhook/` for `checkout.session.completed`, `checkout.session.expired`, and `checkout.session.async_payment_failed`, then copy its signing secret to `STRIPE_WEBHOOK_SECRET`. Use Stripe test keys before switching to live keys. Stripe requires an account eligible to accept payments in the business's registered country. Set these variables in Vercel's API project environment settings; never commit them or paste them into chat. The M-Pesa callback URL and Stripe webhook URL must be public HTTPS endpoints. Sandbox callbacks cannot reach a localhost-only backend.

### Storefront project

1. Import the same repository as a second Vercel project and set the project root directory to `frontend` (framework: Vite).
2. Set `VITE_API_BASE_URL` to the API project's URL, including `https://` and without a trailing slash.
3. Deploy the project. `frontend/vercel.json` provides SPA rewrites so direct navigation works.

Verify `https://<api-vercel-domain>/api/health` reports `ok: true` and `GET /api/products/` returns `200`.