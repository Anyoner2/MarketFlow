# MarketFlow

MarketFlow is a marketplace project with a Django REST API and a React, TypeScript, and Vite storefront.

## Backend

From `backend`, create and activate a virtual environment, then install dependencies and initialize the database:

```powershell
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

The API is available at `http://127.0.0.1:8000/`. In development, Django uses a local-only fallback secret. For deployments, set `DJANGO_DEBUG=false` and provide a unique `DJANGO_SECRET_KEY` through the environment.

## Frontend

From `frontend`, install packages and start Vite:

```powershell
npm install
npm run dev
```

The storefront runs at `http://localhost:5173/` and proxies `/api` requests to Django on port 8000.

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

Other API views require JWT authentication by default. Authenticated requests send `Authorization: Bearer <access-token>`.

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

## Deploy to Render

The root `render.yaml` defines a Django API, PostgreSQL database, and static Vite storefront. To create the services, connect this GitHub repository in the Render dashboard and create a new Blueprint from the repository. Render will prompt you to review the services and environment before provisioning them.

The Blueprint uses the free plans by default. Render free web services can spin down when idle, and free PostgreSQL databases are temporary and expire. Do not use this configuration for real customer or order data; choose a paid persistent database and suitable web plans before a production launch.

The API service runs migrations on startup, serves collected static files with WhiteNoise, and gets a generated Django secret. The Blueprint dynamically reads Render's service URLs for `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and the frontend's `VITE_API_BASE_URL`. For a paid API plan, move migrations from `startCommand` to Render's `preDeployCommand` to avoid running migrations on every process restart. If you add custom domains, add their host/origin values to the corresponding environment variables and redeploy the frontend after changing `VITE_API_BASE_URL`.