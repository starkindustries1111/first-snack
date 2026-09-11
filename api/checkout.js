const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

function setCorsHeaders(req, res) {
  const configuredOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  const requestOrigin = req.headers.origin;
  const originIsAllowed = !configuredOrigins.length || configuredOrigins.includes(requestOrigin);

  if (requestOrigin && originIsAllowed) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  } else if (!requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

module.exports = async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password) {
      sendJson(res, 503, { error: 'Set ADMIN_USERNAME and ADMIN_PASSWORD in the backend environment to view orders.' });
      return;
    }
    const { createHash, timingSafeEqual } = require('node:crypto');
    const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const digest = value => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(req.headers.authorization || ''), digest(expected))) {
      sendJson(res, 401, { error: 'The admin username or password is incorrect.' });
      return;
    }
    const readKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !readKey) {
      sendJson(res, 503, { error: 'Configure the backend SUPABASE_SERVICE_ROLE_KEY to load orders.' });
      return;
    }
    try {
      const ordersUrl = new URL('/rest/v1/orders', supabaseUrl);
      ordersUrl.searchParams.set('select', 'id,items,total_amount,customer_name,customer_class');
      ordersUrl.searchParams.set('order', 'id.desc');
      const orders = [];
      const pageSize = 1000;
      for (let offset = 0; ;) {
        ordersUrl.searchParams.set('offset', String(offset));
        ordersUrl.searchParams.set('limit', String(pageSize));
        const response = await fetch(ordersUrl, {
          headers: { apikey: readKey, Authorization: `Bearer ${readKey}` }
        });
        if (!response.ok) throw new Error(`Order lookup returned ${response.status}`);
        const page = await response.json();
        if (!Array.isArray(page)) throw new Error('Invalid order response');
        orders.push(...page);
        if (page.length === 0) break;
        offset += page.length;
      }
      sendJson(res, 200, { orders });
    } catch (error) {
      console.error('Admin order lookup failed:', error.message);
      sendJson(res, 502, { error: 'Unable to load orders. Please try logging in again.' });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    sendJson(res, 500, { error: 'Checkout service is not configured.' });
    return;
  }

  const { items, total, customer_name, customer_class } = req.body || {};
  if (typeof customer_name !== 'string' || !customer_name.trim() || customer_name.trim().length > 100 ||
      typeof customer_class !== 'string' || !customer_class.trim() || customer_class.trim().length > 50) {
    sendJson(res, 400, { error: 'Enter your name (up to 100 characters) and class (up to 50 characters).' });
    return;
  }
  if (!Array.isArray(items) || items.length === 0 || typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
    sendJson(res, 400, { error: 'Order items and a valid total are required.' });
    return;
  }
  const hasInvalidQty = items.some(item => {
    const qty = typeof item.quantity === 'number' ? item.quantity : item.qty;
    return typeof qty !== 'number' || qty < 1 || qty > 5;
  });
  if (hasInvalidQty) {
    sendJson(res, 400, { error: 'Each item can have a maximum quantity of 5 per order.' });
    return;
  }

  try {
    const ordersUrl = new URL('/rest/v1/orders', supabaseUrl);
    const response = await fetch(ordersUrl, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ items, total_amount: total, customer_name: customer_name.trim(), customer_class: customer_class.trim() })
    });
    const responseText = await response.text();
    let data = null;

    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      console.error('Supabase order insert failed:', response.status, responseText);
      sendJson(res, 500, { error: 'Unable to save your order.' });
      return;
    }

    sendJson(res, 201, { success: true, order: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    console.error('Checkout service failed:', error);
    sendJson(res, 500, { error: 'Checkout service is not configured correctly.' });
  }
};
