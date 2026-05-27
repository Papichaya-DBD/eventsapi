const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://landing.yuanta.co.th',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function hubspot(token, path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (res.status === 204) return null;

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`HubSpot error ${res.status}: ${data?.message || JSON.stringify(data)}`);
  }

  return data;
}

async function appendEp(token, contactId, propertyName, epValue) {
  const contact = await hubspot(
    token,
    `/crm/v3/objects/contacts/${contactId}?properties=${propertyName}`
  );

  const current = contact?.properties?.[propertyName] || '';
  const list = current ? current.split(';').map(s => s.trim()).filter(Boolean) : [];

  if (list.includes(epValue)) return; // ซ้ำ ไม่ต้องอัปเดต

  list.push(epValue);

  await hubspot(token, `/crm/v3/objects/contacts/${contactId}`, 'PATCH', {
    properties: { [propertyName]: list.join(';') },
  });
}

export default {
  async fetch(request, env) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const { contactId, action, ep, property } = body;

    if (!contactId || !action || !ep) {
      return json({ error: 'contactId, action และ ep จำเป็นต้องมี' }, 400);
    }

    const token = env.HUBSPOT_TOKEN;
    if (!token) {
      return json({ error: 'HUBSPOT_TOKEN not configured' }, 500);
    }

    // property name — default เป็น ebook_register ถ้าไม่ได้ส่งมา
    const propertyName = property || 'ebook_register';

    try {
      if (action === 'visit') {
        await appendEp(token, contactId, propertyName, ep);
      } else {
        return json({ error: `action ไม่รู้จัก: ${action}` }, 400);
      }

      return json({ success: true, property: propertyName, ep });
    } catch (err) {
      console.error('[track]', err.message);
      return json({ error: 'Internal server error' }, 500);
    }
  },
};
