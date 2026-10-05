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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS products_store_active_idx ON products (store_id, is_active);

  CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    order_number UUID NOT NULL UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    currency CHAR(3) NOT NULL DEFAULT 'KES',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders (customer_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    UNIQUE (order_id, product_id)
  );
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