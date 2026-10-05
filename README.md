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

The storefront runs at `http://localhost:5173/` and proxies `/api` requests to the Node API on port 3000.

## API routes

- `POST /api/auth/register/` creates an account and returns access and refresh tokens.
- `POST /api/auth/login/` accepts email and password and returns access and refresh tokens.
- `POST /api/auth/refresh/` exchanges a refresh token for a new access token.
- `GET /api/products/` lists active products from active stores without authentication.
- `GET, POST /api/stores/` lists the current user's stores or creates a store owned by that user.
- `GET, PATCH /api/stores/<id>/` retrieves or updates one of the current user's stores.
- `GET, POST /api/seller/products/` lists or creates products in stores owned by the current user.
- `GET, PATCH, DELETE /api/seller/products/<id>/` manages one of the current user's products.
- `GET, POST /api/orders/` lists the current user's orders or places an order.
- `GET /api/orders/<id>/` retrieves one of the current user's orders.

Authenticated requests send `Authorization: Bearer <access-token>`. Access tokens last 15 minutes; refresh tokens last 30 days.

Order requests contain product IDs and quantities only. Product availability, price, and inventory are checked by the server when the order is created:

```json
{
	"items": [
		{ "product_id": 1, "quantity": 2 }
	]
}
```

The API currently records pending orders; payment capture and fulfillment require a payment provider and shipping workflow to be selected.

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
```

The API requires a persistent PostgreSQL database; Vercel's function filesystem and process memory are not persistent. The API initializes the schema automatically.

### Storefront project

1. Import the same repository as a second Vercel project and set the project root directory to `frontend` (framework: Vite).
2. Set `VITE_API_BASE_URL` to the API project's URL, including `https://` and without a trailing slash.
3. Deploy the project. `frontend/vercel.json` provides SPA rewrites so direct navigation works.

Verify `https://<api-vercel-domain>/api/health` reports `ok: true` and `GET /api/products/` returns `200`.