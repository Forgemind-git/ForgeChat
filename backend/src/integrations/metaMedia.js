// Minimal Meta WhatsApp Cloud API client for media retrieval.
// Two-step protocol: GET /<media_id> → {url, mime_type, sha256, file_size},
// then GET <url> with bearer token to fetch the bytes.

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
// Legacy single-account fallback. The app is multi-account, so callers should
// pass the per-account token (from whatsapp_accounts); we fall back to this env
// var only when no token is supplied (keeps older single-account setups working).
const ENV_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';

function resolveToken(accessToken) {
  const token = accessToken || ENV_ACCESS_TOKEN;
  if (!token) {
    throw new Error('No WhatsApp access token for media (account token missing and META_ACCESS_TOKEN unset)');
  }
  return token;
}

/**
 * Fetch metadata for a media object.
 * Returns { url, mime_type, sha256, file_size, id, messaging_product }
 * The `url` is short-lived (~5 min).
 */
async function getMediaInfo(mediaId, accessToken) {
  const token = resolveToken(accessToken);
  const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
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
// token attached. Note: WhatsApp serves some media (audio/voice, stickers) from
// lookaside.fbsbx.com, so fbsbx.com must be allowed too — omitting it silently
// breaks those media types.
const ALLOWED_MEDIA_HOST = /(^|\.)(fbcdn\.net|whatsapp\.net|facebook\.com|fbsbx\.com)$/i;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // 100 MB hard cap

function assertAllowedMediaUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Invalid media URL'); }
  if (u.protocol !== 'https:') throw new Error(`Refusing non-HTTPS media URL: ${u.protocol}`);
  if (!ALLOWED_MEDIA_HOST.test(u.hostname)) {
    throw new Error(`Refusing media URL outside Meta CDN allowlist: ${u.hostname}`);
  }
}

async function downloadMediaBinary(url, accessToken) {
  const token = resolveToken(accessToken);
  assertAllowedMediaUrl(url);
  const res = await fetch(url, {
    redirect: 'error', // no open-redirect pivoting to internal hosts
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'ForgeChat/1.0 (+https://github.com/Forgemind-git/Forge-Chat)',
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
