const { Pool, types } = require('pg');

types.setTypeParser(20, Number);

const databaseUrl = process.env.DATABASE_URL;
const isLocalDatabase = databaseUrl && /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(databaseUrl);

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: isLocalDatabase || process.env.DATABASE_SSL === 'false'
    ? false
    : { rejectUnauthorized: false },
  max: process.env.VERCEL ? 1 : 10,
  idleTimeoutMillis: 30000,
});

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    first_name VARCHAR(150) NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'seller', 'admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    seller_requested BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'customer';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS seller_requested BOOLEAN NOT NULL DEFAULT FALSE;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'seller', 'admin'));
    END IF;
  END;
  $$;
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email));

  CREATE TABLE IF NOT EXISTS stores (
    id BIGSERIAL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(160) NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  UPDATE users SET role = 'seller'
    WHERE role = 'customer' AND EXISTS (SELECT 1 FROM stores WHERE stores.owner_id = users.id);

  CREATE TABLE IF NOT EXISTS products (
    id BIGSERIAL PRIMARY KEY,
    store_id BIGINT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    category VARCHAR(60) NOT NULL DEFAULT 'Other',
    description TEXT NOT NULL DEFAULT '',
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    image_url TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE products ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE INDEX IF NOT EXISTS products_store_active_idx ON products (store_id, is_active);

  CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    order_number UUID NOT NULL UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    payment_status VARCHAR(24) NOT NULL DEFAULT 'unpaid',
    payment_checkout_request_id TEXT,
    payment_merchant_request_id TEXT,
    payment_receipt_number TEXT,
    payment_phone_number VARCHAR(16),
    payment_result_description TEXT NOT NULL DEFAULT '',
    currency CHAR(3) NOT NULL DEFAULT 'KES',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(24) NOT NULL DEFAULT 'unpaid';
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_checkout_request_id TEXT;
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_merchant_request_id TEXT;
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_receipt_number TEXT;
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_phone_number VARCHAR(16);
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_result_description TEXT NOT NULL DEFAULT '';
  CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_checkout_request_idx
    ON orders (payment_checkout_request_id) WHERE payment_checkout_request_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders (customer_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    fulfillment_status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (fulfillment_status IN ('pending', 'processing', 'shipped', 'delivered')),
    UNIQUE (order_id, product_id)
  );
  ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fulfillment_status VARCHAR(20) NOT NULL DEFAULT 'pending';

  CREATE TABLE IF NOT EXISTS product_reviews (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment VARCHAR(1000) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, customer_id)
  );
  CREATE INDEX IF NOT EXISTS product_reviews_product_created_idx
    ON product_reviews (product_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS categories_name_lower_unique ON categories (LOWER(name));
  INSERT INTO categories (name)
    SELECT DISTINCT ON (LOWER(category)) category
    FROM products
    WHERE BTRIM(category) <> ''
    ORDER BY LOWER(category), category
    ON CONFLICT DO NOTHING;
`;

let schemaReady;

async function ensureSchema() {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to use the MarketFlow API.');
  }

  if (!schemaReady) {
    schemaReady = pool.query(schema).catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }

  await schemaReady;
}

async function query(text, values) {
  await ensureSchema();
  return pool.query(text, values);
}

module.exports = { ensureSchema, pool, query };