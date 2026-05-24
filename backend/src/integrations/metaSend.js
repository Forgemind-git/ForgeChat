// Meta WhatsApp Cloud API outbound client.
// All functions take { accessToken, phoneNumberId, ... } so they're pure:
// the credential lookup happens in the queue worker.

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';

function url(phoneNumberId, path = 'messages') {
  return `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(phoneNumberId)}/${path}`;
}

async function postJson(endpoint, accessToken, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok) {
    const errMsg = parsed?.error?.message || text.slice(0, 300) || `HTTP ${res.status}`;
    const err = new Error(`Meta ${res.status}: ${errMsg}`);
    err.status = res.status;
    err.metaError = parsed?.error || null;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

/**
 * Send a free-form text message. Requires the recipient to be inside the
 * 24-hour customer service window (Meta enforces this).
 */
async function sendText({ accessToken, phoneNumberId, to, body, previewUrl = false, contextMessageId = null }) {
  return postJson(url(phoneNumberId), accessToken, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    // Quote-reply: tells WhatsApp to render this as a reply to that message.
    ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
    type: 'text',
    text: { body: String(body), preview_url: !!previewUrl },
  });
}

/**
 * Send an approved message template. Components carry header/body/button
 * parameters per Meta's spec (e.g. [{type:'body', parameters:[{type:'text', text:'John'}]}]).
 */
async function sendTemplate({ accessToken, phoneNumberId, to, templateName, languageCode = 'en', components = [] }) {
  return postJson(url(phoneNumberId), accessToken, {
    messaging_product: 'whatsapp',
    to: String(to),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  });
}

/**
 * Send a media message that references either an already-uploaded media_id
 * (preferred) or a public HTTPS link. type ∈ image|video|audio|document|sticker.
 */
async function sendMedia({ accessToken, phoneNumberId, to, type, mediaId, link, caption, filename, contextMessageId = null }) {
  if (!mediaId && !link) throw new Error('sendMedia: mediaId or link required');
  const media = mediaId ? { id: mediaId } : { link };
  if (caption && (type === 'image' || type === 'video' || type === 'document')) media.caption = caption;
  if (filename && type === 'document') media.filename = filename;
  return postJson(url(phoneNumberId), accessToken, {
    messaging_product: 'whatsapp',
    to: String(to),
    // Quote-reply: render this media as a reply to the quoted message.
    ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
    type,
    [type]: media,
  });
}

/**
 * Upload a binary as multipart/form-data to /media, returning { id }.
 * Buffer is the file bytes; mimeType is the original mime; filename is for display.
 */
async function uploadMedia({ accessToken, phoneNumberId, buffer, mimeType, filename }) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename || 'upload');
  const res = await fetch(url(phoneNumberId, 'media'), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` },
    body: form,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok) {
    const err = new Error(`Meta upload ${res.status}: ${parsed?.error?.message || text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return parsed; // { id }
}

/**
 * Send an interactive message (reply buttons or list). Caller passes the
 * already-built `interactive` object exactly as Meta expects it.
 *   { type: 'button'|'list', body:{text}, header?, footer?, action:{...} }
 */
async function sendInteractive({ accessToken, phoneNumberId, to, interactive }) {
  return postJson(url(phoneNumberId), accessToken, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: 'interactive',
    interactive,
  });
}

/**
 * Send a location pin. latitude/longitude required (decimal degrees, strings or
 * numbers). name/address optional (max 1000 chars each per Meta).
 */
async function sendLocation({ accessToken, phoneNumberId, to, latitude, longitude, name, address }) {
  const loc = { latitude: Number(latitude), longitude: Number(longitude) };
  if (Number.isNaN(loc.latitude) || Number.isNaN(loc.longitude)) {
    throw new Error('sendLocation: latitude and longitude must be numeric');
  }
  if (name) loc.name = String(name);
  if (address) loc.address = String(address);
  return postJson(url(phoneNumberId), accessToken, {
    messaging_product: 'whatsapp',
    to: String(to),
    type: 'location',
    location: loc,
  });
}

/**
 * Send one or more contact cards. Caller passes a fully-built `contacts` array
 * matching Meta's spec: each entry has `name.formatted_name` (required) and
 * optional `phones[]`, `emails[]`, `addresses[]`, `org`, `urls[]`, `birthday`.
 */
async function sendContacts({ accessToken, phoneNumberId, to, contacts }) {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw new Error('sendContacts: at least one contact required');
  }
  return postJson(url(phoneNumberId), accessToken, {
    messaging_product: 'whatsapp',
    to: String(to),
    type: 'contacts',
    contacts,
  });
}

/**
 * React to a message. Pass an empty emoji to remove a previously-sent reaction.
 * Requires the recipient to be inside the 24-hour customer service window.
 */
async function sendReaction({ accessToken, phoneNumberId, to, messageId, emoji }) {
  return postJson(url(phoneNumberId), accessToken, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: 'reaction',
    reaction: { message_id: messageId, emoji: emoji || '' },
  });
}

module.exports = { sendText, sendTemplate, sendMedia, sendInteractive, sendLocation, sendContacts, sendReaction, uploadMedia };
