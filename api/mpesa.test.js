const assert = require('node:assert/strict');
const { test } = require('node:test');
const { configuration, initiateStkPush, normalizePhone } = require('./mpesa');

test('normalizes Kenyan M-Pesa phone numbers', () => {
  assert.equal(normalizePhone('0712 345 678'), '254712345678');
  assert.equal(normalizePhone('+254 712 345 678'), '254712345678');
  assert.equal(normalizePhone('112345678'), '254112345678');
});

test('rejects phone numbers outside the supported Kenyan format', () => {
  assert.throws(() => normalizePhone('12345'), /valid Kenyan M-Pesa phone number/);
});

test('requires configured Daraja secrets and a public HTTPS callback', () => {
  const names = [
    'MPESA_ENV',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_URL',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.throws(() => configuration(), (error) => error.status === 503 && /MPESA_CONSUMER_KEY/.test(error.message));

    process.env.MPESA_CONSUMER_KEY = 'test-key';
    process.env.MPESA_CONSUMER_SECRET = 'test-secret';
    process.env.MPESA_SHORTCODE = '174379';
    process.env.MPESA_PASSKEY = 'test-passkey';
    process.env.MPESA_CALLBACK_URL = 'http://localhost/callback';
    assert.throws(() => configuration(), (error) => error.status === 503 && /HTTPS/.test(error.message));
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('initiates a Daraja STK push using the configured sandbox endpoint', async () => {
  const names = [
    'MPESA_ENV',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_URL',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  const calls = [];
  try {
    process.env.MPESA_ENV = 'sandbox';
    process.env.MPESA_CONSUMER_KEY = 'test-key';
    process.env.MPESA_CONSUMER_SECRET = 'test-secret';
    process.env.MPESA_SHORTCODE = '174379';
    process.env.MPESA_PASSKEY = 'test-passkey';
    process.env.MPESA_CALLBACK_URL = 'https://example.test/api/payments/mpesa/callback/';
    global.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      return calls.length === 1
        ? new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 })
        : new Response(JSON.stringify({
          ResponseCode: '0',
          CheckoutRequestID: 'checkout-1',
          MerchantRequestID: 'merchant-1',
          CustomerMessage: 'Prompt sent.',
        }), { status: 200 });
    };

    const result = await initiateStkPush({
      phoneNumber: '254712345678',
      amount: 1200,
      accountReference: 'MF42',
      transactionDescription: 'MarketFlow order',
    });

    assert.equal(result.CheckoutRequestID, 'checkout-1');
    assert.match(calls[0].url, /^https:\/\/sandbox\.safaricom\.co\.ke\/oauth\//);
    assert.match(calls[1].url, /^https:\/\/sandbox\.safaricom\.co\.ke\/mpesa\/stkpush\//);
    const requestBody = JSON.parse(calls[1].options.body);
    assert.equal(requestBody.Amount, 1200);
    assert.equal(requestBody.PhoneNumber, '254712345678');
    assert.equal(requestBody.CallBackURL, 'https://example.test/api/payments/mpesa/callback/');
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
