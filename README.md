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
- `GET /api/orders/` lists the current user's orders.
- `POST /api/orders/checkout/` validates inventory and starts an M-Pesa STK Push for the current user's order.
- `POST /api/payments/mpesa/callback/` receives Daraja payment confirmations.
- `GET /api/orders/<id>/` retrieves one of the current user's orders.

Customers can view order/payment progress in **My orders**. Product reviews are limited to one per customer and product, and can only be submitted after a successful purchase.
Sellers can review paid orders and sales totals in Seller Studio. Fulfillment updates are scoped to the seller's own order items and must follow the processing → shipped → delivered sequence; customer order tracking reflects item fulfillment progress.

Authenticated requests send `Authorization: Bearer <access-token>`. Access tokens last 15 minutes; refresh tokens last 30 days.

Checkout requests contain the customer's Kenyan M-Pesa phone number plus product IDs and quantities. Product availability, price, and inventory are checked by the server:

```json
{
	"phone_number": "+254712345678",
	"items": [
		{ "product_id": 1, "quantity": 2 }
	]
}
```

The API reserves inventory while the Daraja STK Push is pending, marks an order paid only after a successful callback, and restores stock if payment fails. Daraja requires a whole-number KES total. The production catalog must contain active seller listings; the storefront's sample preview listings are not purchasable. Order fulfillment and shipping notifications still require a shipping workflow.

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
MPESA_ENV=sandbox
MPESA_CONSUMER_KEY=<Daraja sandbox consumer key>
MPESA_CONSUMER_SECRET=<Daraja sandbox consumer secret>
MPESA_SHORTCODE=174379
MPESA_PASSKEY=<Daraja sandbox passkey>
MPESA_CALLBACK_URL=https://<your-api-vercel-domain>/api/payments/mpesa/callback/
```

The API requires a persistent PostgreSQL database; Vercel's function filesystem and process memory are not persistent. The API initializes the schema automatically.
Use Daraja sandbox credentials and test numbers first. Set these variables in Vercel's API project environment settings; never commit them or paste them into chat. The callback URL must be a public HTTPS endpoint. Sandbox phone prompts and callbacks cannot reach a localhost-only backend.

### Storefront project

1. Import the same repository as a second Vercel project and set the project root directory to `frontend` (framework: Vite).
2. Set `VITE_API_BASE_URL` to the API project's URL, including `https://` and without a trailing slash.
3. Deploy the project. `frontend/vercel.json` provides SPA rewrites so direct navigation works.

Verify `https://<api-vercel-domain>/api/health` reports `ok: true` and `GET /api/products/` returns `200`.