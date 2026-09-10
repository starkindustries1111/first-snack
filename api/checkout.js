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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    sendJson(res, 500, { error: 'Checkout service is not configured.' });
    return;
  }

  const { items, total } = req.body || {};
  if (!Array.isArray(items) || items.length === 0 || typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
    sendJson(res, 400, { error: 'Order items and a valid total are required.' });
    return;
  }

  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase
      .from('orders')
      .insert({ items, total })
      .select()
      .single();

    if (error) {
      console.error('Supabase order insert failed:', error);
      sendJson(res, 500, { error: 'Unable to save your order.' });
      return;
    }

    sendJson(res, 201, { success: true, order: data });
  } catch (error) {
    console.error('Checkout service failed:', error);
    sendJson(res, 500, { error: 'Checkout service is temporarily unavailable.' });
  }
};
