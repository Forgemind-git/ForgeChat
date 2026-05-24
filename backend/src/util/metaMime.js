// Canonicalize and validate media MIME types against the WhatsApp Cloud API's
// supported sets, so we never store or forward a type Meta will reject.
//
// Browser/OS-reported MIME is a guess (often derived from the file extension),
// so we (1) reduce it to Meta's canonical token, falling back to the filename
// extension when the report is missing/generic, and (2) check it against the
// per-purpose allow-list. Chat media is broader than template-header media.

const path = require('path');

// Common browser/OS aliases -> Meta's canonical token.
const ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'audio/mp3': 'audio/mpeg',
  'audio/mpeg3': 'audio/mpeg',
  'audio/x-mpeg': 'audio/mpeg',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/x-aac': 'audio/aac',
  'audio/aacp': 'audio/aac',
  'video/3gpp': 'video/3gp',
  'application/x-pdf': 'application/pdf',
};

// Filename extension -> canonical MIME, used when the reported MIME is missing
// or generic (e.g. application/octet-stream).
const EXT_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.3gp': 'video/3gp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.aac': 'audio/aac', '.amr': 'audio/amr', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const GENERIC = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/binary']);

// Meta's supported types per chat media kind.
const IMAGE = new Set(['image/jpeg', 'image/png']);
const STICKER = new Set(['image/webp']);
const VIDEO = new Set(['video/mp4', 'video/3gp']);
const AUDIO = new Set(['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg']);
const DOCUMENT = new Set([
  'application/pdf', 'text/plain',
  'application/vnd.ms-powerpoint', 'application/msword', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

// Template header sample media (Meta resumable upload) — stricter than chat.
const TEMPLATE_HEADER = new Set(['image/jpeg', 'image/png', 'video/mp4', 'application/pdf']);

// Reduce a raw MIME (+ optional filename) to Meta's canonical token.
function canonicalizeMime(rawMime, filename) {
  let base = String(rawMime || '').split(';')[0].trim().toLowerCase();
  if (ALIASES[base]) base = ALIASES[base];
  if (GENERIC.has(base) && filename) {
    const ext = path.extname(String(filename)).toLowerCase();
    if (EXT_MIME[ext]) base = EXT_MIME[ext];
  }
  return base;
}

// Chat media kind for a (canonical) MIME, or null if Meta can't send it in chat.
function chatKindFor(mime) {
  if (IMAGE.has(mime)) return 'image';
  if (STICKER.has(mime)) return 'sticker';
  if (VIDEO.has(mime)) return 'video';
  if (AUDIO.has(mime)) return 'audio';
  if (DOCUMENT.has(mime)) return 'document';
  return null;
}
function isChatSendable(mime) { return chatKindFor(mime) !== null; }
function isTemplateHeaderMime(mime) { return TEMPLATE_HEADER.has(mime); }

const CHAT_TYPES_MSG = 'Accepted: JPG, PNG, WEBP, MP4, 3GP, MP3, AAC, AMR, OGG/OPUS, M4A, PDF, TXT, or Office documents (convert HEIC/MOV first).';
const TEMPLATE_TYPES_MSG = 'Template header media must be JPG, PNG, MP4, or PDF.';

module.exports = {
  canonicalizeMime, chatKindFor, isChatSendable, isTemplateHeaderMime,
  CHAT_TYPES_MSG, TEMPLATE_TYPES_MSG,
  // exported for tests
  ALIASES, EXT_MIME, TEMPLATE_HEADER,
};
