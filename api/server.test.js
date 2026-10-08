const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

process.env.JWT_SECRET ||= 'marketflow-test-jwt-secret';
process.env.JWT_REFRESH_SECRET ||= 'marketflow-test-refresh-secret';

const app = require('./server');
let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('service root reports that the API is running', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: 'MarketFlow API is running.' });
});

test('store endpoints reject unauthenticated requests before touching the database', async () => {
  const response = await fetch(`${baseUrl}/api/stores/`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { detail: 'Authentication credentials were not provided.' });
});

test('order endpoints reject unauthenticated requests before touching the database', async () => {
  const response = await fetch(`${baseUrl}/api/orders/`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { detail: 'Authentication credentials were not provided.' });
});

test('checkout rejects unauthenticated requests before touching the database', async () => {
  const response = await fetch(`${baseUrl}/api/orders/checkout/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_number: '0712345678', items: [{ product_id: 1, quantity: 1 }] }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { detail: 'Authentication credentials were not provided.' });
});

test('M-Pesa callback rejects malformed payloads before touching the database', async () => {
  const response = await fetch(`${baseUrl}/api/payments/mpesa/callback/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Body: {} }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { detail: 'Invalid M-Pesa callback payload.' });
});