// G9 (2026-06-16): reanima la INTRO del referido BNI (quien_intro).
//
// Contexto del gap (auditoria 2026-06-15-pipeline-aliado-bni-vs-journey, #2):
// en los BNI reales quien_intro=NULL porque solo se capturaba cuando un NO-owner
// compartia el vCard del referido. El owner (Alek) no tenia forma de teclear
// quien hizo la presentacion, asi que la secuencia referido_contexto se quedaba
// bloqueada: en frio con deny('cold_send_missing_quien_intro') y en caliente con
// el placeholder {{quien_intro}} (copyStatus 'blocked').
//
// Este modulo es PURO (cero requires, cero I/O): contiene el parser del comando
// del owner, el armado del mensaje de referido (draft caliente + variable fria)
// y el constructor del patch de custom_fields. webhook.js importa estas funciones
// para que el MISMO codigo que corre en produccion sea el que el test E2E ejerce.

'use strict';

const IA360_QUIEN_INTRO_PLACEHOLDER = '{{quien_intro}}';

// Comando del owner para teclear quien presento a un referido. Dos formatos
// naturales, ambos owner-only (el dispatch en webhook.js ya filtra por numero):
//   - "intro <contacto>: <quien presenta>"   (canonico; los dos puntos separan
//     sin ambiguedad, asi que sirve aun si el nombre del contacto trae " de ")
//   - "referido <contacto> de <quien presenta>"  (atajo; el primer " de " separa)
// Devuelve { target, introducer } con ambos trim, o null si no es el comando.
function parseIa360OwnerIntroCommand(body) {
  const text = String(body || '').trim();
  let m = text.match(/^intro\s+(.+?)\s*:\s*(.+)$/i);
  if (m && m[1].trim() && m[2].trim()) {
    return { target: m[1].trim(), introducer: m[2].trim() };
  }
  m = text.match(/^referido\s+(.+?)\s+de\s+(.+)$/i);
  if (m && m[1].trim() && m[2].trim()) {
    return { target: m[1].trim(), introducer: m[2].trim() };
  }
  return null;
}

// Sanitiza un nombre de introductor: quita controles/bidi/zero-width inyectables
// (un push name puede traerlos), borra llaves (no inyectar placeholders), colapsa
// espacios y topa a 60 code points. null si no queda nada con letras. Identico al
// sanitizeIa360IntroName del vCard para que ambos caminos compartan una sola regla.
function sanitizeIntroName(raw) {
  const clean = String(raw || '')
    .replace(/[\u0000-\u001F\u007F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const capped = Array.from(clean).slice(0, 60).join('').trim();
  if (!capped) return null;
  if (!/[\p{L}]/u.test(capped)) return null; // sin letras no sirve como nombre
  return capped;
}

// Compacta el quien_intro para el parametro {{2}} del template frio: colapsa
// espacios/saltos (Meta rechaza saltos de linea y 4+ espacios) y topa a max.
// Devuelve null si tras compactar no queda nada (=> cold_send_missing_quien_intro).
function compactQuienIntro(text, max = 60) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length <= max ? clean : clean.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

// Patch de custom_fields para el contacto referido a partir de la intro tecleada.
// quien_intro (ya sanitizado) es la senal primaria y siempre gana. referido_por
// solo se setea si el aliado real se resolvio a un numero distinto del owner, del
// bot y del propio contacto: nunca apuntamos el referido al owner.
function buildIntroCustomFields({
  quienIntroName, introducerNumber, ownerNumber, contactNumber, botNumber, nowIso,
}) {
  const patch = {
    quien_intro: quienIntroName,
    intro_capturada_por: 'owner-comando',
    intro_capturada_at: nowIso,
  };
  const n = introducerNumber ? String(introducerNumber).replace(/\D/g, '') : '';
  if (n && n !== String(ownerNumber || '') && n !== String(botNumber || '') && n !== String(contactNumber || '')) {
    patch.referido_por = n;
  }
  return patch;
}

// Draft del opener caliente referido_contexto. Con quienIntro arma la intro real;
// sin el, deja el placeholder {{quien_intro}} (que hasUnresolvedIa360Placeholder
// detecta -> copyStatus 'blocked', sin envio).
function buildReferidoContextoDraft({ name, quienIntro }) {
  return `Hola ${name}, soy la IA de Alek. Te escribo porque nos presentó ${quienIntro || IA360_QUIEN_INTRO_PLACEHOLDER} y, antes de mandarte cualquier propuesta, Alek quiere entender tu contexto para no escribirte algo fuera de lugar. ¿Cómo prefieres empezar?`;
}

// True si el texto trae el placeholder de quien_intro sin resolver.
function hasUnresolvedQuienIntroPlaceholder(text) {
  return String(text || '').includes(IA360_QUIEN_INTRO_PLACEHOLDER);
}

module.exports = {
  IA360_QUIEN_INTRO_PLACEHOLDER,
  parseIa360OwnerIntroCommand,
  sanitizeIntroName,
  compactQuienIntro,
  buildIntroCustomFields,
  buildReferidoContextoDraft,
  hasUnresolvedQuienIntroPlaceholder,
};
