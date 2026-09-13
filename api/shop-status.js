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
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
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

  // ---------- GET: public read (anon key) ----------
  if (req.method === 'GET') {
    if (!supabaseUrl || !supabaseAnonKey) {
      sendJson(res, 200, { manual_override: null });
      return;
    }
    try {
      const url = new URL('/rest/v1/shop_settings', supabaseUrl);
      url.searchParams.set('select', 'manual_override');
      url.searchParams.set('id', 'eq.1');
      const response = await fetch(url, {
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` }
      });
      if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
      const rows = await response.json();
      const override = Array.isArray(rows) && rows.length > 0 ? rows[0].manual_override : null;
      res.setHeader('Cache-Control', 'no-store');
      sendJson(res, 200, { manual_override: override });
    } catch (error) {
      console.error('shop-status GET failed:', error.message);
      sendJson(res, 200, { manual_override: null });
    }
    return;
  }

  // ---------- PUT: admin write (service_role key + Basic auth) ----------
  if (req.method === 'PUT') {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password) {
      sendJson(res, 503, { error: 'Admin credentials are not configured.' });
      return;
    }
    const { createHash, timingSafeEqual } = require('node:crypto');
    const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const digest = value => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(req.headers.authorization || ''), digest(expected))) {
      sendJson(res, 401, { error: 'Unauthorized.' });
      return;
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      sendJson(res, 503, { error: 'Supabase is not configured.' });
      return;
    }

    const { manual_override } = req.body || {};
    if (manual_override !== null && manual_override !== 'open' && manual_override !== 'closed') {
      sendJson(res, 400, { error: 'manual_override must be null, "open", or "closed".' });
      return;
    }

    try {
      const url = new URL('/rest/v1/shop_settings', supabaseUrl);
      url.searchParams.set('id', 'eq.1');
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ manual_override })
      });
      if (!response.ok) {
        const text = await response.text();
        console.error('shop-status PUT failed:', response.status, text);
        sendJson(res, 500, { error: 'Failed to update shop status.' });
        return;
      }
      const rows = await response.json();
      const updated = Array.isArray(rows) && rows.length > 0 ? rows[0].manual_override : manual_override;
      sendJson(res, 200, { manual_override: updated });
    } catch (error) {
      console.error('shop-status PUT error:', error.message);
      sendJson(res, 500, { error: 'Failed to update shop status.' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, PUT, OPTIONS');
  sendJson(res, 405, { error: 'Method not allowed' });
};

