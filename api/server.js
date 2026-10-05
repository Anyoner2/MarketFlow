const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ensureSchema, pool, query } = require('./db');

const app = express();
const jwtSecret = process.env.JWT_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;
const accessLifetime = '15m';
const refreshLifetime = '30d';

if (!jwtSecret || !refreshSecret || jwtSecret === refreshSecret) {
  throw new Error('Set distinct JWT_SECRET and JWT_REFRESH_SECRET values before starting the API.');
}

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()) : true,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

function apiError(status, message, field) {
  const error = new Error(message);
  error.status = status;
  error.field = field;
  return error;
}

function issueTokens(user) {
  const claims = { sub: String(user.id), email: user.email, first_name: user.first_name };
  return {
    access: jwt.sign(claims, jwtSecret, { expiresIn: accessLifetime }),
    refresh: jwt.sign({ sub: claims.sub, type: 'refresh' }, refreshSecret, { expiresIn: refreshLifetime }),
  };
}

function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ detail: 'Authentication credentials were not provided.' });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    if (payload.type === 'refresh') throw new Error('Refresh token is not an access token.');
    req.user = { id: Number(payload.sub), email: payload.email, first_name: payload.first_name || '' };
    return next();
  } catch {
    return res.status(401).json({ detail: 'Invalid or expired access token.' });
  }
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw apiError(404, 'Not found.');
  return id;
}

function validateProductInput(body, partial = false) {
  const fields = ['name', 'category', 'description', 'price', 'stock_quantity', 'image_url', 'is_active'];
  const output = {};
  for (const field of fields) {
    if (Object.hasOwn(body, field)) output[field] = body[field];
  }

  if (!partial && (!output.name || output.price === undefined)) {
    throw apiError(400, 'Name and price are required.', 'name');
  }
  if (output.name !== undefined && (typeof output.name !== 'string' || !output.name.trim() || output.name.length > 160)) {
    throw apiError(400, 'Enter a valid product name.', 'name');
  }
  if (output.price !== undefined && (!Number.isFinite(Number(output.price)) || Number(output.price) < 0)) {
    throw apiError(400, 'Enter a valid non-negative price.', 'price');
  }
  if (output.stock_quantity !== undefined && (!Number.isInteger(Number(output.stock_quantity)) || Number(output.stock_quantity) < 0)) {
    throw apiError(400, 'Enter a valid non-negative stock quantity.', 'stock_quantity');
  }
  if (output.image_url !== undefined && typeof output.image_url !== 'string') {
    throw apiError(400, 'Enter a valid image URL.', 'image_url');
  }
  if (output.is_active !== undefined && typeof output.is_active !== 'boolean') {
    throw apiError(400, 'Enter a valid active flag.', 'is_active');
  }
  return output;
}

function productResponse(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: String(row.price),
    description: row.description,
    image: row.image_url,
    image_url: row.image_url,
    stock_quantity: row.stock_quantity,
    is_active: row.is_active,
    store_id: row.store_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getOrder(client, orderId, customerId) {
  const orderResult = await client.query(
    'SELECT id, order_number, status, currency, created_at FROM orders WHERE id = $1 AND customer_id = $2',
    [orderId, customerId],
  );
  if (!orderResult.rowCount) return null;
  const order = orderResult.rows[0];
  const itemResult = await client.query(
    `SELECT oi.id, oi.product_id AS product, p.name AS product_name, oi.quantity, oi.unit_price
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1 ORDER BY oi.id`,
    [order.id],
  );
  const items = itemResult.rows.map((item) => ({ ...item, unit_price: String(item.unit_price) }));
  const total = items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);
  return { ...order, items, total_amount: total.toFixed(2) };
}

app.get('/api/health', async (req, res, next) => {
  try {
    await ensureSchema();
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'marketflow-api' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/products/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.*, p.store_id FROM products p
       JOIN stores s ON s.id = p.store_id
       WHERE p.is_active = TRUE AND s.is_active = TRUE
       ORDER BY p.created_at DESC`,
    );
    res.json(result.rows.map(productResponse));
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/register/', async (req, res, next) => {
  try {
    const { email, password, first_name = '' } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw apiError(400, 'Enter a valid email address.', 'email');
    if (typeof password !== 'string' || password.length < 8) throw apiError(400, 'Password must be at least 8 characters.', 'password');
    if (/^(password|password123|12345678|qwerty123)$/i.test(password)) throw apiError(400, 'This password is too common.', 'password');
    if (typeof first_name !== 'string' || first_name.length > 150) throw apiError(400, 'Enter a valid first name.', 'first_name');

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (email, first_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, first_name',
      [normalizedEmail, first_name, passwordHash],
    );
    res.status(201).json({ ...issueTokens(result.rows[0]), user: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ email: ['An account with this email already exists.'] });
    next(error);
  }
});

app.post('/api/auth/login/', async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!email || typeof password !== 'string') throw apiError(400, 'Email and password are required.');
    const result = await query('SELECT id, email, first_name, password_hash FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw apiError(401, 'Invalid email or password.');
    }
    res.json({ ...issueTokens(user), user: { id: user.id, email: user.email, first_name: user.first_name } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/refresh/', async (req, res, next) => {
  try {
    const token = req.body?.refresh;
    const payload = jwt.verify(token, refreshSecret);
    if (payload.type !== 'refresh') throw apiError(401, 'Invalid refresh token.');
    const result = await query('SELECT id, email, first_name FROM users WHERE id = $1', [payload.sub]);
    if (!result.rowCount) throw apiError(401, 'Invalid refresh token.');
    res.json({ access: issueTokens(result.rows[0]).access });
  } catch (error) {
    next(error.status ? error : apiError(401, 'Invalid or expired refresh token.'));
  }
});

app.get('/api/stores/', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, slug, description, is_active, created_at, updated_at FROM stores WHERE owner_id = $1 ORDER BY created_at DESC',
      [req.user.id],
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/stores/', authenticate, async (req, res, next) => {
  try {
    const { name, slug, description = '' } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) throw apiError(400, 'Store name is required.', 'name');
    if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw apiError(400, 'Enter a valid URL slug.', 'slug');
    const result = await query(
      'INSERT INTO stores (owner_id, name, slug, description) VALUES ($1, $2, $3, $4) RETURNING id, name, slug, description, is_active, created_at, updated_at',
      [req.user.id, name.trim(), slug, String(description)],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ slug: ['A store with this slug already exists.'] });
    next(error);
  }
});

app.get('/api/stores/:id/', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, slug, description, is_active, created_at, updated_at FROM stores WHERE id = $1 AND owner_id = $2',
      [parseId(req.params.id), req.user.id],
    );
    if (!result.rowCount) throw apiError(404, 'Not found.');
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/stores/:id/', authenticate, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const allowed = ['name', 'slug', 'description', 'is_active'];
    const updates = Object.entries(req.body || {}).filter(([key]) => allowed.includes(key));
    if (!updates.length) throw apiError(400, 'Provide at least one store field to update.');
    for (const [key, value] of updates) {
      if (key === 'name' && (typeof value !== 'string' || !value.trim())) throw apiError(400, 'Store name is required.', key);
      if (key === 'slug' && (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) throw apiError(400, 'Enter a valid URL slug.', key);
      if (key === 'is_active' && typeof value !== 'boolean') throw apiError(400, 'Enter a valid active flag.', key);
    }
    const setClause = updates.map(([key], index) => `${key} = $${index + 1}`).join(', ');
    const values = updates.map(([, value]) => value);
    values.push(id, req.user.id);
    const result = await query(
      `UPDATE stores SET ${setClause}, updated_at = NOW() WHERE id = $${values.length - 1} AND owner_id = $${values.length} RETURNING id, name, slug, description, is_active, created_at, updated_at`,
      values,
    );
    if (!result.rowCount) throw apiError(404, 'Not found.');
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ slug: ['A store with this slug already exists.'] });
    next(error);
  }
});

app.get('/api/seller/products/', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.* FROM products p JOIN stores s ON s.id = p.store_id
       WHERE s.owner_id = $1 ORDER BY p.created_at DESC`,
      [req.user.id],
    );
    res.json(result.rows.map(productResponse));
  } catch (error) {
    next(error);
  }
});

app.post('/api/seller/products/', authenticate, async (req, res, next) => {
  try {
    const storeId = parseId(req.body?.store_id);
    const store = await query('SELECT id FROM stores WHERE id = $1 AND owner_id = $2', [storeId, req.user.id]);
    if (!store.rowCount) throw apiError(400, 'You can only manage products in your own stores.', 'store_id');
    const input = validateProductInput(req.body || {});
    const result = await query(
      `INSERT INTO products (store_id, name, category, description, price, stock_quantity, image_url, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [storeId, input.name.trim(), input.category || 'Other', input.description || '', input.price, input.stock_quantity || 0, input.image_url || '', input.is_active ?? true],
    );
    res.status(201).json(productResponse(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.get('/api/seller/products/:id/', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.* FROM products p JOIN stores s ON s.id = p.store_id
       WHERE p.id = $1 AND s.owner_id = $2`,
      [parseId(req.params.id), req.user.id],
    );
    if (!result.rowCount) throw apiError(404, 'Not found.');
    res.json(productResponse(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/seller/products/:id/', authenticate, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const input = validateProductInput(req.body || {}, true);
    const updates = Object.entries(input);
    if (!updates.length) throw apiError(400, 'Provide at least one product field to update.');
    if (input.store_id !== undefined) throw apiError(400, 'Products cannot be moved to another store.', 'store_id');
    const setClause = updates.map(([key], index) => `${key} = $${index + 1}`).join(', ');
    const values = updates.map(([key, value]) => key === 'name' ? value.trim() : value);
    values.push(id, req.user.id);
    const result = await query(
      `UPDATE products p SET ${setClause}, updated_at = NOW() FROM stores s
       WHERE p.store_id = s.id AND p.id = $${values.length - 1} AND s.owner_id = $${values.length}
       RETURNING p.*`,
      values,
    );
    if (!result.rowCount) throw apiError(404, 'Not found.');
    res.json(productResponse(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/seller/products/:id/', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `DELETE FROM products p USING stores s
       WHERE p.store_id = s.id AND p.id = $1 AND s.owner_id = $2 RETURNING p.id`,
      [parseId(req.params.id), req.user.id],
    );
    if (!result.rowCount) throw apiError(404, 'Not found.');
    res.status(204).end();
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ detail: 'Products in existing orders cannot be deleted.' });
    next(error);
  }
});

app.get('/api/orders/', authenticate, async (req, res, next) => {
  try {
    await ensureSchema();
  } catch (error) {
    return next(error);
  }
  const client = await pool.connect().catch(next);
  if (!client) return;
  try {
    const result = await client.query('SELECT id FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [req.user.id]);
    const orders = [];
    for (const row of result.rows) orders.push(await getOrder(client, row.id, req.user.id));
    res.json(orders);
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/orders/', authenticate, async (req, res, next) => {
  const requestedItems = req.body?.items;
  if (!Array.isArray(requestedItems) || !requestedItems.length) return res.status(400).json({ items: ['At least one item is required.'] });
  const seen = new Set();
  for (const item of requestedItems) {
    if (!Number.isSafeInteger(item?.product_id) || item.product_id < 1 || !Number.isSafeInteger(item?.quantity) || item.quantity < 1) {
      return res.status(400).json({ items: ['Each item must include a valid product_id and positive quantity.'] });
    }
    if (seen.has(item.product_id)) return res.status(400).json({ items: ['Each product may only appear once in an order.'] });
    seen.add(item.product_id);
  }

  try {
    await ensureSchema();
  } catch (error) {
    return next(error);
  }
  const client = await pool.connect().catch(next);
  if (!client) return;
  try {
    await client.query('BEGIN');
    const ids = requestedItems.map((item) => item.product_id).sort((a, b) => a - b);
    const result = await client.query(
      `SELECT p.* FROM products p JOIN stores s ON s.id = p.store_id
       WHERE p.id = ANY($1::bigint[]) AND p.is_active = TRUE AND s.is_active = TRUE
       ORDER BY p.id FOR UPDATE OF p`,
      [ids],
    );
    const productMap = new Map(result.rows.map((product) => [Number(product.id), product]));
    if (productMap.size !== ids.length) throw apiError(400, 'One or more products are unavailable.', 'items');

    for (const item of requestedItems) {
      const product = productMap.get(item.product_id);
      if (product.stock_quantity < item.quantity) throw apiError(400, `Not enough stock for ${product.name}.`, 'items');
    }

    const orderResult = await client.query(
      `INSERT INTO orders (order_number, customer_id) VALUES ($1, $2) RETURNING id`,
      [crypto.randomUUID(), req.user.id],
    );
    const orderId = orderResult.rows[0].id;
    for (const item of requestedItems) {
      const product = productMap.get(item.product_id);
      await client.query('UPDATE products SET stock_quantity = stock_quantity - $1, updated_at = NOW() WHERE id = $2', [item.quantity, product.id]);
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
        [orderId, product.id, item.quantity, product.price],
      );
    }

    const order = await getOrder(client, orderId, req.user.id);
    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.get('/api/orders/:id/', authenticate, async (req, res, next) => {
  try {
    await ensureSchema();
  } catch (error) {
    return next(error);
  }
  const client = await pool.connect().catch(next);
  if (!client) return;
  try {
    const order = await getOrder(client, parseId(req.params.id), req.user.id);
    if (!order) throw apiError(404, 'Not found.');
    res.json(order);
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
});

app.get('/', (req, res) => res.json({ message: 'MarketFlow API is running.' }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  const message = status === 500 ? 'The MarketFlow API encountered an error.' : error.message;
  return res.status(status).json(error.field ? { [error.field]: [message] } : { detail: message });
});

if (require.main === module) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set before starting the API.');
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`MarketFlow API running on port ${port}`));
}

module.exports = app;
