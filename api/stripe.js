const Stripe = require('stripe');

function configuration() {
  const missing = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'FRONTEND_URL']
    .filter((name) => !process.env[name]);
  if (missing.length) {
    const error = new Error(`Stripe is not configured. Missing: ${missing.join(', ')}.`);
    error.status = 503;
    throw error;
  }

  let frontendUrl;
  try {
    frontendUrl = new URL(process.env.FRONTEND_URL);
  } catch {
    const error = new Error('FRONTEND_URL must be a valid HTTP or HTTPS URL.');
    error.status = 503;
    throw error;
  }
  if (!['https:', 'http:'].includes(frontendUrl.protocol)
    || (frontendUrl.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(frontendUrl.hostname))
    || frontendUrl.pathname !== '/' || frontendUrl.search || frontendUrl.hash) {
    const error = new Error('FRONTEND_URL must be a public HTTPS URL (HTTP is allowed for localhost).');
    error.status = 503;
    throw error;
  }

  return {
    frontendUrl: frontendUrl.toString().replace(/\/$/, ''),
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  };
}

function client(secretKey) {
  return new Stripe(secretKey);
}

function checkoutSessionParams({ orderId, items, frontendUrl }) {
  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    throw new Error('Order ID must be a positive integer.');
  }
  const lineItems = items.map((item) => {
    const unitAmount = Math.round(Number(item.unit_price) * 100);
    if (!Number.isSafeInteger(unitAmount) || unitAmount < 0
      || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new Error('Order items contain invalid prices or quantities.');
    }
    return {
      price_data: {
        currency: 'kes',
        product_data: { name: item.product_name },
        unit_amount: unitAmount,
      },
      quantity: item.quantity,
    };
  });

  return {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: lineItems,
    client_reference_id: String(orderId),
    metadata: { order_id: String(orderId) },
    success_url: `${frontendUrl}/?payment=success&order_id=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/?payment=cancelled&order_id=${orderId}`,
    expires_at: Math.floor(Date.now() / 1000) + 35 * 60,
  };
}

async function createCheckoutSession({ orderId, items }) {
  const settings = configuration();
  const params = checkoutSessionParams({ orderId, items, frontendUrl: settings.frontendUrl });
  return client(settings.secretKey).checkout.sessions.create(params);
}

function constructWebhookEvent(payload, signature) {
  const settings = configuration();
  return client(settings.secretKey).webhooks.constructEvent(
    payload,
    signature,
    settings.webhookSecret,
  );
}

module.exports = { checkoutSessionParams, configuration, constructWebhookEvent, createCheckoutSession };
