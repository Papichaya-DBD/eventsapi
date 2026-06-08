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

// Append a value into a semicolon-separated contact property (dedup).
// Returns true if the property was updated, false if the value already existed.
async function appendValue(token, contactId, propertyName, value) {
  const contact = await hubspot(
    token,
    `/crm/v3/objects/contacts/${contactId}?properties=${propertyName}`
  );

  const current = contact?.properties?.[propertyName] || '';
  const list = current ? current.split(';').map(s => s.trim()).filter(Boolean) : [];

  if (list.includes(value)) return false; // already present → skip cleanly (no more ß bug)

  list.push(value);

  await hubspot(token, `/crm/v3/objects/contacts/${contactId}`, 'PATCH', {
    properties: { [propertyName]: list.join(';') },
  });

  return true;
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

    const { contactId, action } = body;

    if (!contactId || action !== 'visit') {
      return json({ error: 'contactId และ action: "visit" จำเป็นต้องมี' }, 400);
    }

    const token = env.HUBSPOT_TOKEN;
    if (!token) {
      return json({ error: 'HUBSPOT_TOKEN not configured' }, 500);
    }

    // Normalise the payload into a list of { property, value } pairs.
    // รองรับ 2 รูปแบบ:
    //   1) แบบเดิม:  { ep, property }                        → 1 property (default = main_campaign)
    //   2) แบบใหม่:  { items: [{ property, value }, ...] }    → หลาย property ในครั้งเดียว
    let rawItems;
    if (Array.isArray(body.items)) {
      rawItems = body.items;
    } else {
      rawItems = [{ property: body.property || 'main_campaign', value: body.ep }];
    }

    const items = rawItems
      .map(it => ({
        property: String(it.property || '').trim(),
        value: String(it.value ?? it.ep ?? '').trim(),
      }))
      .filter(it => it.property && it.value);

    if (items.length === 0) {
      return json({ error: 'ต้องมีอย่างน้อย 1 property พร้อม value' }, 400);
    }

    try {
      const results = [];
      for (const { property, value } of items) {
        const updated = await appendValue(token, contactId, property, value);
        results.push({ property, value, updated });
      }
      return json({ success: true, results });
    } catch (err) {
      console.error('[track]', err.message);
      return json({ error: 'Internal server error' }, 500);
    }
  },
};
