const { createHash, timingSafeEqual } = require('node:crypto');

module.exports = async (req, res) => {
  const origins = (process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && (!origins.length || origins.includes(origin))) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, data) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PUT, DELETE, OPTIONS');
    return send(405, { error: 'Method not allowed' });
  }
  const query = new URL(req.url, 'https://localhost').searchParams;
  const lookup = req.method === 'GET' && query.has('code');
  let isAdmin = false;
  if (req.method !== 'GET' || req.headers.authorization) {
    const { ADMIN_USERNAME: username, ADMIN_PASSWORD: password } = process.env;
    if (!username || !password) return send(503, { error: 'Admin access is not configured.' });
    const digest = value => createHash('sha256').update(value).digest();
    const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    if (!timingSafeEqual(digest(req.headers.authorization || ''), digest(expected))) {
      return send(401, { error: 'Please log in again to manage coupons.' });
    }
    isAdmin = true;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return send(503, { error: 'Coupon service is not configured.' });
  try {
    const target = new URL('/rest/v1/coupons', url);
    target.searchParams.set('select', 'id,code,percent,waivesShipping,enabled');
    const options = { method: req.method, headers: { apikey: key, Authorization: `Bearer ${key}` } };
    if (lookup) {
      const code = query.get('code').trim().toUpperCase();
      if (!/^[A-Z0-9_-]{1,50}$/.test(code)) return send(400, { error: 'That coupon is not available.' });
      target.searchParams.set('code', `eq.${code}`);
      target.searchParams.set('enabled', 'eq.true');
      target.searchParams.set('limit', '1');
    } else if (req.method === 'PUT') {
      const { id, code, percent, waivesShipping, enabled } = req.body || {};
      if (!Number.isSafeInteger(id) || id <= 0 || typeof code !== 'string' || !/^[A-Z0-9_-]{1,50}$/.test(code) ||
          typeof waivesShipping !== 'boolean' || typeof enabled !== 'boolean' || !Number.isInteger(percent) ||
          (waivesShipping ? percent !== 0 : percent < 1 || percent > 100)) {
        return send(400, { error: 'Use a coupon code with 1–50 letters, numbers, hyphens or underscores and a valid discount.' });
      }
      target.searchParams.set('on_conflict', 'id');
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.headers.Prefer = 'resolution=merge-duplicates,return=representation';
      options.body = JSON.stringify({ id, code, percent, waivesShipping, enabled });
    } else if (req.method === 'DELETE') {
      const id = Number(query.get('id'));
      if (!Number.isSafeInteger(id) || id <= 0) return send(400, { error: 'A valid coupon ID is required.' });
      target.searchParams.set('id', `eq.${id}`);
    } else {
      if (!isAdmin) target.searchParams.set('enabled', 'eq.true');
      target.searchParams.set('order', 'id.asc');
    }
    const rows = [];
    for (let offset = 0; ;) {
      if (req.method === 'GET' && !lookup) {
        target.searchParams.set('offset', String(offset));
        target.searchParams.set('limit', '1000');
      }
      const response = await fetch(target, options);
      if (!response.ok) {
        if (response.status === 409) return send(409, { error: 'That coupon code already exists.' });
        console.error('Coupon database request failed:', response.status);
        return send(502, { error: 'Unable to access shared coupons. Check the coupons table setup and try again.' });
      }
      if (req.method === 'DELETE') return send(200, { success: true });
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error('Invalid coupon response');
      rows.push(...page);
      if (lookup || req.method !== 'GET' || !page.length) break;
      offset += page.length;
    }
    return send(200, lookup || req.method === 'PUT' ? { coupon: rows[0] || null } : { coupons: rows });
  } catch {
    return send(502, { error: 'Coupon service could not be reached. Please try again.' });
  }
};
