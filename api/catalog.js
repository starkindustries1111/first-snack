const { createHash, timingSafeEqual } = require('node:crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const CATEGORIES = new Set(['Sweet', 'Salty', 'Drink', 'Healthy']);

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function checkAdminAuth(req) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return { ok: false, status: 503, error: 'Admin credentials are not configured.' };
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const digest = value => createHash('sha256').update(value).digest();
  try {
    if (!timingSafeEqual(digest(req.headers.authorization || ''), digest(expected))) {
      return { ok: false, status: 401, error: 'Please log in again to update the store catalog.' };
    }
  } catch {
    return { ok: false, status: 401, error: 'Please log in again to update the store catalog.' };
  }
  return { ok: true };
}

function parseBody(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body;
}

function normalizeProduct(item) {
  if (!item || typeof item !== 'object') return null;
  const id = Number(item.id);
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const category = item.category;
  const price = Number(item.price);
  const stock = Number(item.stock);
  const emoji = typeof item.emoji === 'string' && item.emoji.trim() ? item.emoji.trim().slice(0, 16) : '🍿';
  const desc = typeof item.desc === 'string' ? item.desc.trim().slice(0, 500) : '';
  const image = typeof item.image === 'string' ? item.image.trim() : '';
  if (!Number.isSafeInteger(id) || id <= 0 || !name || name.length > 100) return null;
  if (!CATEGORIES.has(category)) return null;
  if (!Number.isFinite(price) || price < 0 || price > 10000) return null;
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000) return null;
  if (image.length > 1500000) return null;
  return { id, name, category, price, stock, emoji, desc, image };
}

function normalizeFaq(item) {
  if (!item || typeof item !== 'object') return null;
  const id = Number(item.id);
  const question = typeof item.question === 'string' ? item.question.trim() : '';
  const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
  if (!Number.isSafeInteger(id) || id <= 0 || !question || !answer) return null;
  if (question.length > 300 || answer.length > 2000) return null;
  return { id, question, answer };
}

async function supabaseRequest(key, method, body) {
  const url = new URL('/rest/v1/shop_settings', supabaseUrl);
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`
  };
  if (method !== 'POST') url.searchParams.set('id', 'eq.1');
  if (method === 'GET') {
    url.searchParams.set('select', 'products,faqs,flash_sale,coupon_hint_enabled,coupon_hint_code');
  } else {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
  }
  const response = await fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

module.exports = async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'GET') {
    if (!supabaseUrl || !supabaseAnonKey) {
      sendJson(res, 200, { products: null, faqs: null, flash_sale: null, coupon_hint_enabled: null, coupon_hint_code: null });
      return;
    }
    try {
      const result = await supabaseRequest(supabaseAnonKey, 'GET');
      if (!result.ok) {
        sendJson(res, 200, { products: null, faqs: null, flash_sale: null, coupon_hint_enabled: null, coupon_hint_code: null });
        return;
      }
      const row = Array.isArray(result.data) && result.data[0] ? result.data[0] : {};
      sendJson(res, 200, {
        products: Array.isArray(row.products) ? row.products : null,
        faqs: Array.isArray(row.faqs) ? row.faqs : null,
        flash_sale: typeof row.flash_sale === 'boolean' ? row.flash_sale : null,
        coupon_hint_enabled: typeof row.coupon_hint_enabled === 'boolean' ? row.coupon_hint_enabled : null,
        coupon_hint_code: typeof row.coupon_hint_code === 'string' ? row.coupon_hint_code : null
      });
    } catch (error) {
      console.error('catalog GET failed:', error.message);
      sendJson(res, 200, { products: null, faqs: null, flash_sale: null, coupon_hint_enabled: null, coupon_hint_code: null });
    }
    return;
  }

  if (req.method === 'PUT') {
    const auth = checkAdminAuth(req);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error });
      return;
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      sendJson(res, 503, { error: 'Supabase is not configured.' });
      return;
    }

    const body = parseBody(req);
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(body, 'products')) {
      if (!Array.isArray(body.products)) {
        sendJson(res, 400, { error: 'Products must be a list.' });
        return;
      }
      const products = body.products.map(normalizeProduct);
      if (products.some(item => !item)) {
        sendJson(res, 400, { error: 'Each item needs a name, category, valid price, and stock quantity.' });
        return;
      }
      patch.products = products;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'faqs')) {
      if (!Array.isArray(body.faqs)) {
        sendJson(res, 400, { error: 'FAQs must be a list.' });
        return;
      }
      const faqs = body.faqs.map(normalizeFaq);
      if (faqs.some(item => !item)) {
        sendJson(res, 400, { error: 'Each FAQ needs a question and an answer.' });
        return;
      }
      patch.faqs = faqs;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'flash_sale')) {
      if (typeof body.flash_sale !== 'boolean') {
        sendJson(res, 400, { error: 'Flash sale must be on or off.' });
        return;
      }
      patch.flash_sale = body.flash_sale;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'coupon_hint_enabled')) {
      if (typeof body.coupon_hint_enabled !== 'boolean') {
        sendJson(res, 400, { error: 'Coupon hint must be on or off.' });
        return;
      }
      patch.coupon_hint_enabled = body.coupon_hint_enabled;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'coupon_hint_code')) {
      const code = typeof body.coupon_hint_code === 'string' ? body.coupon_hint_code.trim().toUpperCase() : '';
      if (!/^[A-Z0-9_-]{1,50}$/.test(code)) {
        sendJson(res, 400, { error: 'Use a coupon code with 1–50 letters, numbers, hyphens, or underscores.' });
        return;
      }
      patch.coupon_hint_code = code;
    }
    if (!Object.keys(patch).length) {
      sendJson(res, 400, { error: 'Provide products or FAQs to save.' });
      return;
    }

    try {
      let result = await supabaseRequest(serviceKey, 'PATCH', patch);
      if (result.status === 404 || (result.ok && Array.isArray(result.data) && result.data.length === 0)) {
        result = await supabaseRequest(serviceKey, 'POST', { id: 1, ...patch });
      }
      if (!result.ok) {
        console.error('catalog PUT failed:', result.status, result.data);
        sendJson(res, 500, { error: 'Failed to save the catalog. Run the latest Supabase SQL script, then try again.' });
        return;
      }
      const row = Array.isArray(result.data) && result.data[0] ? result.data[0] : patch;
      sendJson(res, 200, {
        products: Array.isArray(row.products) ? row.products : (patch.products || null),
        faqs: Array.isArray(row.faqs) ? row.faqs : (patch.faqs || null),
        flash_sale: typeof row.flash_sale === 'boolean' ? row.flash_sale : (Object.prototype.hasOwnProperty.call(patch, 'flash_sale') ? patch.flash_sale : null),
        coupon_hint_enabled: typeof row.coupon_hint_enabled === 'boolean' ? row.coupon_hint_enabled : (Object.prototype.hasOwnProperty.call(patch, 'coupon_hint_enabled') ? patch.coupon_hint_enabled : null),
        coupon_hint_code: typeof row.coupon_hint_code === 'string' ? row.coupon_hint_code : (patch.coupon_hint_code || null)
      });
    } catch (error) {
      console.error('catalog PUT error:', error.message);
      sendJson(res, 500, { error: 'Failed to save the catalog.' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, PUT, OPTIONS');
  sendJson(res, 405, { error: 'Method not allowed' });
};
