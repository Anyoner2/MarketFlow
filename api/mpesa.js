const sandboxHost = 'https://sandbox.safaricom.co.ke';
const productionHost = 'https://api.safaricom.co.ke';

function configuration() {
  const environment = process.env.MPESA_ENV || 'sandbox';
  if (!['sandbox', 'production'].includes(environment)) {
    const error = new Error('MPESA_ENV must be either sandbox or production.');
    error.status = 503;
    throw error;
  }

  const missing = [
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_URL',
  ].filter((name) => !process.env[name]);

  if (missing.length) {
    const error = new Error(`M-Pesa is not configured. Missing: ${missing.join(', ')}.`);
    error.status = 503;
    throw error;
  }

  let callbackUrl;
  try {
    callbackUrl = new URL(process.env.MPESA_CALLBACK_URL);
  } catch {
    const error = new Error('MPESA_CALLBACK_URL must be a public HTTPS URL.');
    error.status = 503;
    throw error;
  }
  if (callbackUrl.protocol !== 'https:') {
    const error = new Error('MPESA_CALLBACK_URL must be a public HTTPS URL.');
    error.status = 503;
    throw error;
  }

  return {
    environment,
    host: environment === 'production' ? productionHost : sandboxHost,
    shortcode: process.env.MPESA_SHORTCODE,
    passkey: process.env.MPESA_PASSKEY,
    callbackUrl: callbackUrl.toString(),
    transactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
  };
}

function normalizePhone(value) {
  if (typeof value !== 'string') throw new TypeError('Enter a valid Kenyan M-Pesa phone number.');
  const digits = value.replace(/[\s()+-]/g, '');
  const phone = digits.startsWith('0') ? `254${digits.slice(1)}` : digits.startsWith('7') || digits.startsWith('1') ? `254${digits}` : digits;
  if (!/^254[17]\d{8}$/.test(phone)) throw new TypeError('Enter a valid Kenyan M-Pesa phone number.');
  return phone;
}

function timestamp() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.errorMessage || data.error_description || 'M-Pesa could not process the payment request.');
    error.status = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw error;
  }
  return data;
}

async function initiateStkPush({ phoneNumber, amount, accountReference, transactionDescription }) {
  const settings = configuration();
  const authUrl = `${settings.host}/oauth/v1/generate?grant_type=client_credentials`;
  const authResponse = await fetch(authUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64')}`,
    },
  });
  const authData = await readResponse(authResponse);
  if (typeof authData.access_token !== 'string' || !authData.access_token) {
    throw new Error('M-Pesa authorization did not return an access token.');
  }

  const time = timestamp();
  const password = Buffer.from(`${settings.shortcode}${settings.passkey}${time}`).toString('base64');
  const response = await fetch(`${settings.host}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authData.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: settings.shortcode,
      Password: password,
      Timestamp: time,
      TransactionType: settings.transactionType,
      Amount: amount,
      PartyA: phoneNumber,
      PartyB: settings.shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: settings.callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: transactionDescription.slice(0, 13),
    }),
  });
  const result = await readResponse(response);
  if (String(result.ResponseCode) !== '0' || !result.CheckoutRequestID || !result.MerchantRequestID) {
    const error = new Error(result.CustomerMessage || result.ResponseDescription || 'M-Pesa did not accept the payment request.');
    error.status = 502;
    throw error;
  }
  return result;
}

module.exports = { configuration, initiateStkPush, normalizePhone };
