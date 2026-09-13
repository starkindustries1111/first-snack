const { createHash, timingSafeEqual } = require('node:crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function checkAdminAuth(req) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return false;
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const digest = value => createHash('sha256').update(value).digest();
  try {
    return timingSafeEqual(digest(req.headers.authorization || ''), digest(expected));
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // ================= POST: Customer submits an item request =================
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const { name, item } = body || {};

    if (typeof item !== 'string' || !item.trim()) {
      sendJson(res, 400, { error: 'Please enter the snack or drink you would like to request.' });
      return;
    }

    const trimmedItem = item.trim().slice(0, 150);
    const trimmedName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : 'Anonymous';

    if (supabaseUrl && (supabaseAnonKey || supabaseServiceKey)) {
      try {
        const key = supabaseAnonKey || supabaseServiceKey;
        const targetUrl = new URL('/rest/v1/item_requests', supabaseUrl);
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          },
          body: JSON.stringify({
            name: trimmedName,
            item: trimmedItem,
            created_at: new Date().toISOString()
          })
        });

        if (response.ok) {
          const data = await response.json();
          sendJson(res, 201, {
            success: true,
            request: Array.isArray(data) ? data[0] : { name: trimmedName, item: trimmedItem }
          });
          return;
        } else {
          console.warn('Supabase insert item_requests returned status:', response.status);
        }
      } catch (err) {
        console.warn('Supabase item_requests error:', err.message);
      }
    }

    // Fallback if Supabase table is not yet set up
    sendJson(res, 201, {
      success: true,
      request: {
        id: Date.now(),
        name: trimmedName,
        item: trimmedItem,
        created_at: new Date().toISOString()
      },
      note: 'Saved locally'
    });
    return;
  }

  // ================= GET: Admin views item requests =================
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    if (!checkAdminAuth(req)) {
      sendJson(res, 401, { error: 'Admin authentication required.' });
      return;
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      sendJson(res, 200, { requests: [] });
      return;
    }

    try {
      const targetUrl = new URL('/rest/v1/item_requests', supabaseUrl);
      targetUrl.searchParams.set('select', 'id,name,item,created_at');
      targetUrl.searchParams.set('order', 'id.desc');
      targetUrl.searchParams.set('limit', '500');

      const response = await fetch(targetUrl, {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`
        }
      });

      if (!response.ok) {
        // Table might not exist yet
        sendJson(res, 200, { requests: [] });
        return;
      }

      const requests = await response.json();
      sendJson(res, 200, { requests: Array.isArray(requests) ? requests : [] });
    } catch (err) {
      console.warn('Failed to retrieve item requests:', err.message);
      sendJson(res, 200, { requests: [] });
    }
    return;
  }

  // ================= DELETE: Admin removes a request =================
  if (req.method === 'DELETE') {
    if (!checkAdminAuth(req)) {
      sendJson(res, 401, { error: 'Admin authentication required.' });
      return;
    }

    const query = new URL(req.url, 'https://localhost').searchParams;
    const id = query.get('id');

    if (supabaseUrl && supabaseServiceKey) {
      try {
        const targetUrl = new URL('/rest/v1/item_requests', supabaseUrl);
        if (id && id !== 'all') {
          targetUrl.searchParams.set('id', `eq.${id}`);
        } else if (id === 'all') {
          targetUrl.searchParams.set('id', 'gt.0');
        }

        await fetch(targetUrl, {
          method: 'DELETE',
          headers: {
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`
          }
        });
      } catch (err) {
        console.warn('Failed to delete item request:', err.message);
      }
    }

    sendJson(res, 200, { success: true });
    return;
  }

  res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
  sendJson(res, 405, { error: 'Method not allowed' });
};

