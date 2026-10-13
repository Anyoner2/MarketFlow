const assert = require('node:assert/strict');
const { test } = require('node:test');
const { checkoutSessionParams, configuration } = require('./stripe');

test('requires Stripe API and webhook secrets plus a valid storefront URL', () => {
  const names = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'FRONTEND_URL'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.throws(
      () => configuration(),
      (error) => error.status === 503 && /STRIPE_SECRET_KEY/.test(error.message),
    );

    process.env.STRIPE_SECRET_KEY = 'sk_test_marketflow';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_marketflow';
    process.env.FRONTEND_URL = 'http://localhost:5173';
    assert.equal(configuration().frontendUrl, 'http://localhost:5173');

    process.env.FRONTEND_URL = 'http://store.example.com';
    assert.throws(
      () => configuration(),
      (error) => error.status === 503 && /HTTPS/.test(error.message),
    );
    process.env.FRONTEND_URL = 'https://store.example.com/shop';
    assert.throws(
      () => configuration(),
      (error) => error.status === 503 && /HTTPS/.test(error.message),
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('builds a card checkout session from server-verified order data', () => {
  const params = checkoutSessionParams({
    orderId: 42,
    frontendUrl: 'https://store.example.com',
    items: [
      { product_name: 'Handmade cup', unit_price: '1250.00', quantity: 2 },
      { product_name: 'Small bowl', unit_price: '700.50', quantity: 1 },
    ],
  });
  assert.equal(params.mode, 'payment');
  assert.deepEqual(params.payment_method_types, ['card']);
  assert.deepEqual(params.line_items.map((item) => item.price_data.unit_amount), [125000, 70050]);
  assert.deepEqual(params.line_items.map((item) => item.quantity), [2, 1]);
  assert.equal(params.line_items[0].price_data.currency, 'kes');
  assert.equal(params.client_reference_id, '42');
  assert.equal(params.metadata.order_id, '42');
  assert.match(params.success_url, /session_id=\{CHECKOUT_SESSION_ID\}$/);
  assert.match(params.cancel_url, /payment=cancelled&order_id=42$/);
});
