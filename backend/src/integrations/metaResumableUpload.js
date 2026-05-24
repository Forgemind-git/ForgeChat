// Meta Resumable Upload API — used to get a template media `handle` that
// can be referenced from message_template header.example. Three steps:
//   1. POST /{app_id}/uploads?file_length=&file_type= → session id
//   2. POST /{session_id} (header file_offset: 0, body=binary) → file handle
//   3. Caller uses the handle as components[].example.header_handle[0]

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';

async function createUploadSession({ appId, accessToken, fileLength, fileType }) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(appId)}/uploads`
    + `?file_length=${encodeURIComponent(fileLength)}`
    + `&file_type=${encodeURIComponent(fileType)}`
    + `&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, { method: 'POST' });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok) {
    const err = new Error(`Meta create upload session ${res.status}: ${parsed?.error?.message || text.slice(0, 200)}`);
    err.status = res.status;
    err.metaError = parsed?.error || null;
    throw err;
  }
  return parsed.id; // e.g. "upload:MTphdHRhY2htZW50OmYz..."
}

async function uploadFileToSession({ sessionId, accessToken, buffer, offset = 0 }) {
  // DO NOT encodeURIComponent the sessionId — Meta returns IDs like
  // "upload:MTph...==?sig=AR..." where the `?sig=...` portion MUST stay an
  // actual query string for the signature to be verified. The `:` after
  // `upload` is a sub-delim and is legal in a URL path per RFC 3986.
  const url = `https://graph.facebook.com/${META_API_VERSION}/${sessionId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `OAuth ${accessToken}`,
      'file_offset': String(offset),
      'Content-Type': 'application/octet-stream',
    },
    body: buffer,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok) {
    const err = new Error(`Meta upload to session ${res.status}: ${parsed?.error?.message || text.slice(0, 200)}`);
    err.status = res.status;
    err.metaError = parsed?.error || null;
    throw err;
  }
  return parsed.h; // the file handle to use in template payloads
}

/**
 * Convenience: full 2-step upload returning the final handle.
 */
async function uploadTemplateMediaHandle({ appId, accessToken, buffer, mimeType }) {
  if (!appId) throw new Error('meta_app_id required (set on WhatsApp Account)');
  const sessionId = await createUploadSession({
    appId, accessToken, fileLength: buffer.length, fileType: mimeType,
  });
  return uploadFileToSession({ sessionId, accessToken, buffer });
}

module.exports = { createUploadSession, uploadFileToSession, uploadTemplateMediaHandle };
