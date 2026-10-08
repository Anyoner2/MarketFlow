const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ensureSchema, pool, query } = require('./db');
const { configuration: mpesaConfiguration, initiateStkPush, normalizePhone } = require('./mpesa');

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
  const claims = { sub: String(user.id), email: user.email, first_name: user.first_name, role: user.role || 'customer' };
  return {
    access: jwt.sign(claims, jwtSecret, { expiresIn: accessLifetime }),
    refresh: jwt.sign({ sub: claims.sub, type: 'refresh' }, refreshSecret, { expiresIn: refreshLifetime }),
  };
}

function adminEmails() {
  return new Set((process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
}

function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ detail: 'Authentication credentials were not provided.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
    if (payload.type === 'refresh') throw new Error('Refresh token is not an access token.');
  } catch {
    return res.status(401).json({ detail: 'Invalid or expired access token.' });
  }

  void query(
    'SELECT id, email, first_name, role, is_active, seller_requested FROM users WHERE id = $1',
    [Number(payload.sub)],
  ).then((result) => {
    const user = result.rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ detail: 'This account is unavailable.' });
    }
    req.user = user;
    return next();
  }).catch(next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ detail: 'You do not have permission to perform this action.' });
    }
    return next();
  };
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
    is_suspended: row.is_suspended || false,
    store_id: row.store_id,
    average_rating: row.average_rating === null || row.average_rating === undefined ? null : Number(row.average_rating),
    review_count: Number(row.review_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getOrder(client, orderId, customerId) {
  const orderResult = await client.query(
    `SELECT id, order_number, status, payment_status, payment_receipt_number,
            payment_phone_number, payment_result_description, currency, created_at
     FROM orders WHERE id = $1 AND customer_id = $2`,
    [orderId, customerId],
  );
  if (!orderResult.rowCount) return null;
  const order = orderResult.rows[0];
  const itemResult = await client.query(
    `SELECT oi.id, oi.product_id AS product, p.name AS product_name, oi.quantity, oi.unit_price,
            oi.fulfillment_status,
            (o.payment_status = 'paid' AND NOT EXISTS (
              SELECT 1 FROM product_reviews pr
              WHERE pr.product_id = oi.product_id AND pr.customer_id = o.customer_id
            )) AS can_review
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.order_id = $1 ORDER BY oi.id`,
    [order.id],
  );
  const items = itemResult.rows.map((item) => ({ ...item, unit_price: String(item.unit_price) }));
  const total = items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);
  let status = order.status;
  if (order.payment_status === 'paid') {
    const allDelivered = items.every((item) => item.fulfillment_status === 'delivered');
    const allShipped = items.every((item) => ['shipped', 'delivered'].includes(item.fulfillment_status));
    const anyProcessing = items.some((item) => ['processing', 'shipped', 'delivered'].includes(item.fulfillment_status));
    status = allDelivered ? 'delivered' : allShipped ? 'shipped' : anyProcessing ? 'processing' : 'paid';
  }
  return { ...order, status, items, total_amount: total.toFixed(2) };
}

async function getSellerOrder(client, orderId, sellerId) {
  const orderResult = await client.query(
    `SELECT o.id, o.order_number, o.created_at, u.first_name AS customer_name
     FROM orders o
     JOIN users u ON u.id = o.customer_id
     WHERE o.id = $1 AND o.payment_status = 'paid'
       AND EXISTS (
         SELECT 1 FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN stores s ON s.id = p.store_id
         WHERE oi.order_id = o.id AND s.owner_id = $2
       )`,
    [orderId, sellerId],
  );
  if (!orderResult.rowCount) return null;
  const order = orderResult.rows[0];
  const itemResult = await client.query(
    `SELECT oi.id, oi.product_id AS product, p.name AS product_name,
            oi.quantity, oi.unit_price, oi.fulfillment_status
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     JOIN stores s ON s.id = p.store_id
     WHERE oi.order_id = $1 AND s.owner_id = $2
     ORDER BY oi.id`,
    [orderId, sellerId],
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
      `SELECT p.*, p.store_id, review_stats.average_rating, COALESCE(review_stats.review_count, 0) AS review_count
       FROM products p
       JOIN stores s ON s.id = p.store_id
       JOIN users u ON u.id = s.owner_id AND u.is_active = TRUE
       LEFT JOIN (
         SELECT product_id, ROUND(AVG(rating)::numeric, 1) AS average_rating, COUNT(*) AS review_count
         FROM product_reviews GROUP BY product_id
       ) review_stats ON review_stats.product_id = p.id
       WHERE p.is_active = TRUE AND s.is_active = TRUE
         AND p.is_suspended = FALSE
       ORDER BY p.created_at DESC`,
    );
    res.json(result.rows.map(productResponse));
  } catch (error) {
    next(error);
  }
});

app.get('/api/products/:id/reviews/', async (req, res, next) => {
  try {
    const productId = parseId(req.params.id);
    const result = await query(
      `SELECT pr.id, pr.rating, pr.comment, pr.created_at, u.first_name AS reviewer_name
       FROM product_reviews pr JOIN users u ON u.id = pr.customer_id
       JOIN products p ON p.id = pr.product_id
       JOIN stores s ON s.id = p.store_id
       JOIN users seller ON seller.id = s.owner_id AND seller.is_active = TRUE
       WHERE pr.product_id = $1 AND p.is_active = TRUE AND p.is_suspended = FALSE AND s.is_active = TRUE
       ORDER BY pr.created_at DESC`,
      [productId],
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/categories/', async (req, res, next) => {
  try {
    const result = await query('SELECT id, name FROM categories ORDER BY LOWER(name)');
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/products/:id/reviews/', authenticate, async (req, res, next) => {
  try {
    const productId = parseId(req.params.id);
    const { rating, comment = '' } = req.body || {};
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw apiError(400, 'Choose a rating from 1 to 5.', 'rating');
    }
    if (typeof comment !== 'string' || comment.length > 1000) {
      throw apiError(400, 'Review comments must be 1000 characters or fewer.', 'comment');
    }

    const purchase = await query(
      `SELECT 1 FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.customer_id = $1 AND o.payment_status = 'paid' AND oi.product_id = $2
       LIMIT 1`,
      [req.user.id, productId],
    );
    if (!purchase.rowCount) throw apiError(403, 'You can review a product after a paid purchase.', 'detail');

    const result = await query(
      `INSERT INTO product_reviews (product_id, customer_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING id, rating, comment, created_at`,
      [productId, req.user.id, rating, comment.trim()],
    );
    res.status(201).json({ ...result.rows[0], reviewer_name: req.user.first_name });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ detail: 'You have already reviewed this product.' });
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
      `INSERT INTO users (email, first_name, password_hash)
       VALUES ($1, $2, $3) RETURNING id, email, first_name, role, is_active, seller_requested`,
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
    const result = await query(
      'SELECT id, email, first_name, password_hash, role, is_active, seller_requested FROM users WHERE LOWER(email) = LOWER($1)',
      [email],
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw apiError(401, 'Invalid email or password.');
    }
    if (!user.is_active) throw apiError(401, 'This account is unavailable.');
    const publicUser = {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      role: user.role,
      seller_requested: user.seller_requested,
    };
    res.json({ ...issueTokens(user), user: publicUser });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me/', authenticate, async (req, res, next) => {
  try {
    const bootstrapConfigured = Boolean(process.env.ADMIN_BOOTSTRAP_TOKEN);
    const isAllowlisted = adminEmails().has(req.user.email.toLowerCase());
    let canBootstrapAdmin = false;
    if (bootstrapConfigured && isAllowlisted && req.user.role !== 'admin') {
      const admins = await query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = TRUE");
      canBootstrapAdmin = Number(admins.rows[0].count) === 0;
    }
    res.json({
      id: req.user.id,
      email: req.user.email,
      first_name: req.user.first_name,
      role: req.user.role,
      seller_requested: req.user.seller_requested,
      can_bootstrap_admin: canBootstrapAdmin,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/bootstrap/', authenticate, async (req, res, next) => {
  const configuredToken = process.env.ADMIN_BOOTSTRAP_TOKEN || '';
  const providedToken = typeof req.body?.setup_token === 'string' ? req.body.setup_token : '';
  const configuredBytes = Buffer.from(configuredToken);
  const providedBytes = Buffer.from(providedToken);
  const tokenMatches = configuredBytes.length > 0
    && configuredBytes.length === providedBytes.length
    && crypto.timingSafeEqual(configuredBytes, providedBytes);
  if (!tokenMatches || !adminEmails().has(req.user.email.toLowerCase())) {
    return res.status(403).json({ detail: 'Admin setup is not available for this account.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('marketflow-first-admin')::bigint)");
    const admins = await client.query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = TRUE");
    if (Number(admins.rows[0].count) > 0) throw apiError(409, 'An active admin already exists.');
    const result = await client.query(
      `UPDATE users SET role = 'admin', seller_requested = FALSE
       WHERE id = $1 AND is_active = TRUE
       RETURNING id, email, first_name, role, seller_requested`,
      [req.user.id],
    );
    if (!result.rowCount) throw apiError(401, 'This account is unavailable.');
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    if (client) client.release();
  }
});

app.post('/api/seller/apply/', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'customer') {
      throw apiError(409, req.user.role === 'seller' ? 'Your account is already approved as a seller.' : 'Admin accounts cannot apply to sell.');
    }
    const result = await query(
      `UPDATE users SET seller_requested = TRUE
       WHERE id = $1 AND seller_requested = FALSE
       RETURNING id, role, seller_requested`,
      [req.user.id],
    );
    if (!result.rowCount) throw apiError(409, 'Your seller application is already pending.');
    res.status(202).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/refresh/', async (req, res, next) => {
  try {
    const token = req.body?.refresh;
    const payload = jwt.verify(token, refreshSecret);
    if (payload.type !== 'refresh') throw apiError(401, 'Invalid refresh token.');
    const result = await query('SELECT id, email, first_name, role, is_active FROM users WHERE id = $1', [payload.sub]);
    if (!result.rowCount || !result.rows[0].is_active) throw apiError(401, 'Invalid refresh token.');
    res.json({ access: issueTokens(result.rows[0]).access });
  } catch (error) {
    next(error.status ? error : apiError(401, 'Invalid or expired refresh token.'));
  }
});

app.get('/api/admin/summary/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE is_active = TRUE) AS active_users,
         (SELECT COUNT(*) FROM users WHERE role = 'seller' AND is_active = TRUE) AS active_sellers,
         (SELECT COUNT(*) FROM users WHERE seller_requested = TRUE AND role = 'customer' AND is_active = TRUE) AS pending_seller_applications,
         (SELECT COUNT(*) FROM products WHERE is_active = TRUE AND is_suspended = FALSE) AS live_products,
         (SELECT COUNT(*) FROM products WHERE is_suspended = TRUE) AS suspended_products,
         (SELECT COUNT(*) FROM orders WHERE payment_status = 'paid') AS paid_orders,
         (SELECT COUNT(*) FROM orders WHERE payment_status IN ('initiating', 'pending')) AS pending_payments,
         (SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0)
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.payment_status = 'paid') AS gross_sales`,
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/users/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, email, first_name, role, is_active, seller_requested, created_at
       FROM users ORDER BY seller_requested DESC, created_at DESC`,
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/users/:id/', authenticate, requireRole('admin'), async (req, res, next) => {
  let client;
  try {
    const id = parseId(req.params.id);
    const { role, is_active: isActive, seller_requested: sellerRequested } = req.body || {};
    if (role !== undefined && !['customer', 'seller', 'admin'].includes(role)) {
      throw apiError(400, 'Choose a valid account role.', 'role');
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      throw apiError(400, 'Account active status must be true or false.', 'is_active');
    }
    if (sellerRequested !== undefined && typeof sellerRequested !== 'boolean') {
      throw apiError(400, 'Seller request status must be true or false.', 'seller_requested');
    }
    if (role === undefined && isActive === undefined && sellerRequested === undefined) {
      throw apiError(400, 'Provide a role, active status, or seller request update.');
    }

    client = await pool.connect();
    await client.query('BEGIN');
    const currentResult = await client.query(
      'SELECT id, email, role, is_active FROM users WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!currentResult.rowCount) throw apiError(404, 'User not found.');
    const current = currentResult.rows[0];
    if (id === req.user.id && (role !== undefined && role !== 'admin' || isActive === false)) {
      throw apiError(409, 'You cannot remove your own admin access or suspend your account.');
    }
    if (role !== undefined && adminEmails().has(current.email.toLowerCase()) && role !== 'admin') {
      throw apiError(409, 'An allowlisted administrator must remain an admin.');
    }
    if (current.role === 'admin' && (role !== undefined && role !== 'admin' || isActive === false)) {
      const admins = await client.query(
        'SELECT COUNT(*) AS count FROM users WHERE role = $1 AND is_active = TRUE',
        ['admin'],
      );
      if (Number(admins.rows[0].count) <= 1) throw apiError(409, 'The last active admin cannot be demoted or suspended.');
    }

    const fields = [];
    const values = [];
    if (role !== undefined) {
      fields.push(`role = $${values.length + 1}`);
      values.push(role);
      if (role !== 'customer') {
        fields.push(`seller_requested = FALSE`);
      }
    }
    if (isActive !== undefined) {
      fields.push(`is_active = $${values.length + 1}`);
      values.push(isActive);
    }
    if (sellerRequested !== undefined) {
      fields.push(`seller_requested = $${values.length + 1}`);
      values.push(sellerRequested);
    }
    values.push(id);
    const result = await client.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length}
       RETURNING id, email, first_name, role, is_active, seller_requested, created_at`,
      values,
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    if (client) client.release();
  }
});

app.get('/api/admin/categories/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.id, c.name, c.created_at, COUNT(p.id) AS product_count
       FROM categories c LEFT JOIN products p ON LOWER(p.category) = LOWER(c.name)
       GROUP BY c.id ORDER BY LOWER(c.name)`,
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/categories/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const name = req.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) {
      throw apiError(400, 'Category name must be between 1 and 60 characters.', 'name');
    }
    const result = await query(
      'INSERT INTO categories (name) VALUES ($1) RETURNING id, name, created_at',
      [name.trim()],
    );
    res.status(201).json({ ...result.rows[0], product_count: 0 });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ detail: 'That category already exists.' });
    next(error);
  }
});

app.patch('/api/admin/categories/:id/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const name = req.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) {
      throw apiError(400, 'Category name must be between 1 and 60 characters.', 'name');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const oldCategory = await client.query('SELECT name FROM categories WHERE id = $1 FOR UPDATE', [id]);
      if (!oldCategory.rowCount) throw apiError(404, 'Category not found.');
      const result = await client.query(
        'UPDATE categories SET name = $1 WHERE id = $2 RETURNING id, name, created_at',
        [name.trim(), id],
      );
      await client.query(
        'UPDATE products SET category = $1, updated_at = NOW() WHERE LOWER(category) = LOWER($2)',
        [name.trim(), oldCategory.rows[0].name],
      );
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ detail: 'That category already exists.' });
    next(error);
  }
});

app.delete('/api/admin/categories/:id/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const category = await client.query('SELECT name FROM categories WHERE id = $1 FOR UPDATE', [id]);
      if (!category.rowCount) throw apiError(404, 'Category not found.');
      const products = await client.query('SELECT COUNT(*) AS count FROM products WHERE LOWER(category) = LOWER($1)', [category.rows[0].name]);
      if (Number(products.rows[0].count) > 0) throw apiError(409, 'Reassign or remove products in this category before deleting it.');
      await client.query('DELETE FROM categories WHERE id = $1', [id]);
      await client.query('COMMIT');
      res.status(204).end();
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/orders/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT o.id, o.order_number, o.payment_status, o.created_at,
              u.email AS customer_email, COALESCE(SUM(oi.unit_price * oi.quantity), 0) AS total_amount,
              COUNT(oi.id) AS item_count,
              CASE
                WHEN o.payment_status <> 'paid' THEN o.status
                WHEN BOOL_AND(oi.fulfillment_status = 'delivered') THEN 'delivered'
                WHEN BOOL_AND(oi.fulfillment_status IN ('shipped', 'delivered')) THEN 'shipped'
                WHEN BOOL_OR(oi.fulfillment_status IN ('processing', 'shipped', 'delivered')) THEN 'processing'
                ELSE 'paid'
              END AS status
       FROM orders o JOIN users u ON u.id = o.customer_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       GROUP BY o.id, u.email ORDER BY o.created_at DESC LIMIT 500`,
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/products/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.id, p.name, p.category, p.price, p.is_active, p.is_suspended, p.stock_quantity,
              s.name AS store_name, u.email AS seller_email
       FROM products p JOIN stores s ON s.id = p.store_id
       JOIN users u ON u.id = s.owner_id
       ORDER BY p.created_at DESC LIMIT 500`,
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/products/:id/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const { is_suspended: isSuspended } = req.body || {};
    if (typeof isSuspended !== 'boolean') throw apiError(400, 'Provide a true or false suspension status.', 'is_suspended');
    const result = await query(
      `UPDATE products SET is_suspended = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, name, is_suspended`,
      [isSuspended, id],
    );
    if (!result.rowCount) throw apiError(404, 'Product not found.');
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
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

app.post('/api/stores/', authenticate, requireRole('seller', 'admin'), async (req, res, next) => {
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

app.patch('/api/stores/:id/', authenticate, requireRole('seller', 'admin'), async (req, res, next) => {
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

app.get('/api/seller/products/', authenticate, requireRole('seller', 'admin'), async (req, res, next) => {
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

app.get('/api/seller/dashboard/', authenticate, requireRole('seller', 'admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         COUNT(DISTINCT p.id) FILTER (WHERE p.is_active = TRUE) AS active_products,
         COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status = 'paid') AS paid_orders,
         COALESCE(SUM(oi.quantity) FILTER (WHERE o.payment_status = 'paid'), 0) AS items_sold,
         COALESCE(SUM(oi.unit_price * oi.quantity) FILTER (WHERE o.payment_status = 'paid'), 0) AS gross_sales,
         COUNT(oi.id) FILTER (WHERE o.payment_status = 'paid' AND oi.fulfillment_status = 'pending') AS pending_fulfillment
       FROM stores s
       LEFT JOIN products p ON p.store_id = s.id
       LEFT JOIN order_items oi ON oi.product_id = p.id
       LEFT JOIN orders o ON o.id = oi.order_id
       WHERE s.owner_id = $1`,
      [req.user.id],
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/seller/orders/', authenticate, requireRole('seller', 'admin'), async (req, res, next) => {
  try {
    await ensureSchema();
  } catch (error) {
    return next(error);
  }
  const client = await pool.connect().catch(next);
  if (!client) return;
  try {
    const result = await client.query(
      `SELECT o.id
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       JOIN stores s ON s.id = p.store_id
       WHERE s.owner_id = $1 AND o.payment_status = 'paid'
       GROUP BY o.id ORDER BY MAX(o.created_at) DESC`,
      [req.user.id],
    );
    const orders = [];
    for (const row of result.rows) {
      const order = await getSellerOrder(client, row.id, req.user.id);
      if (order) orders.push(order);
    }
    res.json(orders);
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
});

app.patch('/api/seller/order-items/:id/', authenticate, requireRole('seller', 'admin'), async (req, res, next) => {
  const transitions = { pending: 'processing', processing: 'shipped', shipped: 'delivered' };
  try {
    const itemId = parseId(req.params.id);
    const { status } = req.body || {};
    if (!['processing', 'shipped', 'delivered'].includes(status)) {
      throw apiError(400, 'Choose a valid fulfillment status.', 'status');
    }

    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query(
        `SELECT oi.fulfillment_status, o.payment_status
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN stores s ON s.id = p.store_id
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.id = $1 AND s.owner_id = $2
         FOR UPDATE OF oi`,
        [itemId, req.user.id],
      );
      if (!currentResult.rowCount) throw apiError(404, 'Order item not found.');
      const current = currentResult.rows[0];
      if (current.payment_status !== 'paid') throw apiError(400, 'Only paid orders can be fulfilled.');
      if (transitions[current.fulfillment_status] !== status) {
        throw apiError(409, `This item must move from ${current.fulfillment_status} to ${transitions[current.fulfillment_status] || 'no further status'}.`);
      }

      const result = await client.query(
        `UPDATE order_items SET fulfillment_status = $1 WHERE id = $2
         RETURNING id, fulfillment_status`,
        [status, itemId],
      );
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/seller/products/', authenticate, requireRole('seller', 'admin'), async (req, res, next) => {
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

app.get('/api/seller/products/:id/', authenticate, requireRole('seller', 'admin'), async (req, res, next) => {
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

app.patch('/api/seller/products/:id/', authenticate, requireRole('seller', 'admin'), async (req, res, next) => {
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

app.delete('/api/seller/products/:id/', authenticate, requireRole('seller', 'admin'), async (req, res, next) => {
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

app.post('/api/payments/mpesa/callback/', async (req, res, next) => {
  const callback = req.body?.Body?.stkCallback;
  const checkoutRequestId = callback?.CheckoutRequestID;
  if (typeof checkoutRequestId !== 'string' || !Number.isInteger(callback?.ResultCode)) {
    return res.status(400).json({ detail: 'Invalid M-Pesa callback payload.' });
  }

  const client = await pool.connect().catch(next);
  if (!client) return;
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, status, payment_status FROM orders
       WHERE payment_checkout_request_id = $1 FOR UPDATE`,
      [checkoutRequestId],
    );
    if (!result.rowCount) {
      console.error(`Received an M-Pesa callback for unknown checkout ${checkoutRequestId}.`);
      throw apiError(404, 'Payment request not found.');
    }

    const order = result.rows[0];
    if (order.payment_status !== 'pending') {
      await client.query('COMMIT');
      return res.json({ ResultCode: 0, ResultDesc: 'Callback already processed.' });
    }

    if (callback.ResultCode === 0) {
      const metadata = callback.CallbackMetadata?.Item || [];
      const callbackValue = (name) => metadata.find((item) => item.Name === name)?.Value;
      const amount = Number(callbackValue('Amount'));
      const receiptNumber = callbackValue('MpesaReceiptNumber');
      const totalResult = await client.query(
        'SELECT COALESCE(SUM(unit_price * quantity), 0) AS total FROM order_items WHERE order_id = $1',
        [order.id],
      );
      if (!Number.isFinite(amount) || amount !== Number(totalResult.rows[0].total) || typeof receiptNumber !== 'string') {
        throw apiError(400, 'M-Pesa payment details do not match this order.');
      }
      await client.query(
        `UPDATE orders SET status = 'paid', payment_status = 'paid',
          payment_receipt_number = $1, payment_result_description = $2, updated_at = NOW()
         WHERE id = $3`,
        [receiptNumber, callback.ResultDesc || 'Payment received.', order.id],
      );
    } else {
      await client.query(
        `UPDATE products p SET stock_quantity = p.stock_quantity + oi.quantity, updated_at = NOW()
         FROM order_items oi WHERE oi.order_id = $1 AND p.id = oi.product_id`,
        [order.id],
      );
      await client.query(
        `UPDATE orders SET status = 'payment_failed', payment_status = 'failed',
          payment_result_description = $1, updated_at = NOW()
         WHERE id = $2`,
        [callback.ResultDesc || 'M-Pesa payment was not completed.', order.id],
      );
    }

    await client.query('COMMIT');
    res.json({ ResultCode: 0, ResultDesc: 'Accepted.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.post(['/api/orders/', '/api/orders/checkout/'], authenticate, async (req, res, next) => {
  const requestedItems = req.body?.items;
  if (!Array.isArray(requestedItems) || !requestedItems.length) return res.status(400).json({ items: ['At least one item is required.'] });
  let phoneNumber;
  try {
    phoneNumber = normalizePhone(req.body?.phone_number);
    mpesaConfiguration();
  } catch (error) {
    return res.status(error.status || 400).json({ detail: error.message });
  }
  const seen = new Set();
  for (const item of requestedItems) {
    if (!Number.isSafeInteger(item?.product_id) || item.product_id < 1 || !Number.isSafeInteger(item?.quantity) || item.quantity < 1) {
      return res.status(400).json({ items: ['Each item must include a valid product_id and positive quantity.'] });
    }
    if (seen.has(item.product_id)) return res.status(400).json({ items: ['Each product may only appear once in an order.'] });
    seen.add(item.product_id);
  }

  let orderId;
  let amount;
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
       JOIN users u ON u.id = s.owner_id AND u.is_active = TRUE
       WHERE p.id = ANY($1::bigint[]) AND p.is_active = TRUE AND p.is_suspended = FALSE AND s.is_active = TRUE
       ORDER BY p.id FOR UPDATE OF p`,
      [ids],
    );
    const productMap = new Map(result.rows.map((product) => [Number(product.id), product]));
    if (productMap.size !== ids.length) throw apiError(400, 'One or more products are unavailable.', 'items');

    for (const item of requestedItems) {
      const product = productMap.get(item.product_id);
      if (product.stock_quantity < item.quantity) throw apiError(400, `Not enough stock for ${product.name}.`, 'items');
    }

    amount = requestedItems.reduce(
      (sum, item) => sum + Number(productMap.get(item.product_id).price) * item.quantity,
      0,
    );
    if (!Number.isSafeInteger(amount) || amount < 1) throw apiError(400, 'M-Pesa checkout requires a whole-number KES total.', 'items');

    const orderResult = await client.query(
      `INSERT INTO orders (order_number, customer_id, payment_status, payment_phone_number)
       VALUES ($1, $2, 'initiating', $3) RETURNING id`,
      [crypto.randomUUID(), req.user.id, phoneNumber],
    );
    orderId = orderResult.rows[0].id;
    for (const item of requestedItems) {
      const product = productMap.get(item.product_id);
      await client.query('UPDATE products SET stock_quantity = stock_quantity - $1, updated_at = NOW() WHERE id = $2', [item.quantity, product.id]);
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
        [orderId, product.id, item.quantity, product.price],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
    return;
  } finally {
    client.release();
  }

  let payment;
  try {
    payment = await initiateStkPush({
      phoneNumber,
      amount,
      accountReference: `MF${String(orderId).slice(-10)}`,
      transactionDescription: 'MarketFlow order',
    });
  } catch (error) {
    try {
      await ensureSchema();
      const cleanupClient = await pool.connect();
      try {
        await cleanupClient.query('BEGIN');
        const currentOrder = await cleanupClient.query(
          'SELECT payment_status FROM orders WHERE id = $1 FOR UPDATE',
          [orderId],
        );
        if (currentOrder.rows[0]?.payment_status === 'initiating') {
          await cleanupClient.query(
            `UPDATE products p SET stock_quantity = p.stock_quantity + oi.quantity, updated_at = NOW()
             FROM order_items oi WHERE oi.order_id = $1 AND p.id = oi.product_id`,
            [orderId],
          );
          await cleanupClient.query(
            `UPDATE orders SET status = 'payment_failed', payment_status = 'failed',
              payment_result_description = $1, updated_at = NOW() WHERE id = $2`,
            [error.message, orderId],
          );
        }
        await cleanupClient.query('COMMIT');
      } catch (cleanupError) {
        await cleanupClient.query('ROLLBACK').catch(() => {});
        console.error('Could not release inventory after a failed M-Pesa request.', cleanupError);
      } finally {
        cleanupClient.release();
      }
    } catch (cleanupError) {
      console.error('Could not connect to release inventory after a failed M-Pesa request.', cleanupError);
    }
    error.status = error.status || 502;
    return next(error);
  }

  try {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE orders SET payment_status = 'pending',
          payment_checkout_request_id = $1, payment_merchant_request_id = $2, updated_at = NOW()
         WHERE id = $3 AND payment_status = 'initiating'`,
        [payment.CheckoutRequestID, payment.MerchantRequestID, orderId],
      );
      const order = await getOrder(client, orderId, req.user.id);
      res.status(202).json({ ...order, payment_message: payment.CustomerMessage || 'Check your phone to complete the M-Pesa payment.' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`M-Pesa accepted order ${orderId}, but its checkout reference could not be saved.`, error);
    next(error);
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
