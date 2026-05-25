// Minimal Meta WhatsApp Cloud API client for media retrieval.
// Two-step protocol: GET /<media_id> → {url, mime_type, sha256, file_size},
// then GET <url> with bearer token to fetch the bytes.

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';

function assertToken() {
  if (!META_ACCESS_TOKEN) {
    throw new Error('META_ACCESS_TOKEN not configured');
  }
}

/**
 * Fetch metadata for a media object.
 * Returns { url, mime_type, sha256, file_size, id, messaging_product }
 * The `url` is short-lived (~5 min).
 */
async function getMediaInfo(mediaId) {
  assertToken();
  const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Meta getMediaInfo ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Stream the binary at a Meta media URL.
 * Returns { buffer: Buffer, contentType: string, contentLength: number }
 */
// Meta media URLs only ever live on these CDN hosts. Restricting to them (plus
// refusing redirects) prevents SSRF: a forged/redirected URL can't make the
// server fetch internal addresses (169.254.169.254, 10.x, etc.) with the Bearer
// token attached.
const ALLOWED_MEDIA_HOST = /(^|\.)(fbcdn\.net|whatsapp\.net|facebook\.com)$/i;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // 100 MB hard cap

function assertAllowedMediaUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Invalid media URL'); }
  if (u.protocol !== 'https:') throw new Error(`Refusing non-HTTPS media URL: ${u.protocol}`);
  if (!ALLOWED_MEDIA_HOST.test(u.hostname)) {
    throw new Error(`Refusing media URL outside Meta CDN allowlist: ${u.hostname}`);
  }
}

async function downloadMediaBinary(url) {
  assertToken();
  assertAllowedMediaUrl(url);
  const res = await fetch(url, {
    redirect: 'error', // no open-redirect pivoting to internal hosts
    headers: {
      Authorization: `Bearer ${META_ACCESS_TOKEN}`,
      'User-Agent': 'ForgeChat/1.0 (+https://github.com/Forgemind-git/ForgeChat)',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Meta downloadMediaBinary ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const declared = Number(res.headers.get('content-length'));
  if (declared && declared > MAX_MEDIA_BYTES) {
    throw new Error(`Media exceeds ${MAX_MEDIA_BYTES} byte cap (declared ${declared})`);
  }
  const arrayBuf = await res.arrayBuffer();
  if (arrayBuf.byteLength > MAX_MEDIA_BYTES) {
    throw new Error(`Media exceeds ${MAX_MEDIA_BYTES} byte cap (got ${arrayBuf.byteLength})`);
  }
  return {
    buffer: Buffer.from(arrayBuf),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    contentLength: Number(res.headers.get('content-length')) || arrayBuf.byteLength,
  };
}

module.exports = { getMediaInfo, downloadMediaBinary };
