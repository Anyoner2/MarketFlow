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

Other API views require JWT authentication by default.