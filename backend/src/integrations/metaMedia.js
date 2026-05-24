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
async function downloadMediaBinary(url) {
  assertToken();
  const res = await fetch(url, {
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
  const arrayBuf = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuf),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    contentLength: Number(res.headers.get('content-length')) || arrayBuf.byteLength,
  };
}

module.exports = { getMediaInfo, downloadMediaBinary };
