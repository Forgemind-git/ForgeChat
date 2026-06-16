// G9 (2026-06-16): E2E del comando del owner para teclear la INTRO del referido
// BNI (quien_intro). Gap origen: auditoria 2026-06-15-pipeline-aliado-bni-vs-journey
// (#2) — quien_intro=NULL en los BNI reales, la secuencia referido_contexto se
// bloquea en frio (cold_send_missing_quien_intro) y en caliente (placeholder
// {{quien_intro}}). Antes NO existia forma de que el owner capturara el dato.
//
// Este test simula el flujo COMPLETO sin deps externas (cero DB/redis/red):
//   1. el owner teclea "intro <contacto>: <quien presenta>"  -> parse el comando,
//   2. resuelve el contacto y al aliado (directorio en memoria),
//   3. persiste quien_intro + referido_por (store en memoria que replica EXACTO
//      la semantica de mergeContactIa360State: merge shallow de custom_fields),
//   4. verifica que el armado del mensaje de referido (frio Y caliente) USA la
//      intro tecleada y NO cae en cold_send_missing_quien_intro / placeholder.
//
// Las funciones puras ejercidas (parser, sanitize, compact, buildIntroCustomFields,
// buildReferidoContextoDraft) son EXACTAMENTE las que webhook.js importa en prod
// (se afirma el cableado abajo), asi que esto prueba el codigo real, no una copia.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  IA360_QUIEN_INTRO_PLACEHOLDER,
  parseIa360OwnerIntroCommand,
  sanitizeIntroName,
  compactQuienIntro,
  buildIntroCustomFields,
  buildReferidoContextoDraft,
  hasUnresolvedQuienIntroPlaceholder,
} = require('../src/routes/ia360ReferidoIntro');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'webhook.js'), 'utf8');

// Numeros reales del monolito (constantes de webhook.js).
const OWNER = '5213322638033';
const BOT = '5213321594582';
// Contacto referido en SANDBOX (52199900 + 5 digitos): jamas un real, jamas el owner.
const REFERIDO = '5219990000001';
// Aliado BNI real (no owner, no bot): es quien presento.
const ALIADO = '5213340001111';
const ALIADO_NOMBRE = 'Juan Pérez';

// ── Doble en memoria del store de contactos ────────────────────────────────
// Replica la semantica de mergeContactIa360State: INSERT ... ON CONFLICT con
// custom_fields = COALESCE(prev,'{}') || patch (merge shallow, patch gana).
function makeStore(initial = []) {
  const rows = new Map();
  for (const r of initial) {
    rows.set(`${r.wa_number}|${r.contact_number}`, {
      ...r, custom_fields: { ...(r.custom_fields || {}) },
    });
  }
  return {
    merge({ waNumber, contactNumber, customFields = {} }) {
      const k = `${waNumber}|${contactNumber}`;
      const prev = rows.get(k) || {
        wa_number: waNumber, contact_number: contactNumber, name: null, custom_fields: {},
      };
      prev.custom_fields = { ...(prev.custom_fields || {}), ...customFields };
      rows.set(k, prev);
    },
    get(waNumber, contactNumber) { return rows.get(`${waNumber}|${contactNumber}`) || null; },
  };
}

// ── Doble de resolveIa360MemoryTarget ──────────────────────────────────────
// Misma logica: >=10 digitos => numero directo; si no, match por nombre
// (normalizado, includes). Directorio chico en memoria.
function makeResolver(directory) {
  const norm = (s) => String(s || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(.)\1+/g, '$1').replace(/\s+/g, ' ').trim();
  return (query) => {
    const digits = String(query || '').replace(/\D/g, '');
    if (digits.length >= 10) {
      const number = digits.length === 10 ? `521${digits}` : digits;
      return { kind: 'number', candidates: [{ contact_number: number, contact_name: null }] };
    }
    const needle = norm(query);
    if (!needle) return { kind: 'none', candidates: [] };
    const hits = directory.filter(c => norm(c.contact_name).includes(needle));
    if (!hits.length) return { kind: 'none', candidates: [] };
    if (hits.length > 1) return { kind: 'ambiguous', candidates: hits };
    return { kind: 'name', candidates: hits };
  };
}

// ── Replica fiel del control-flow de handleIa360OwnerIntroCommand ──────────
// Usa las MISMAS funciones puras del modulo que webhook.js. Devuelve el ack
// (label + body) y deja el efecto en el store.
function runIntroCommand({ store, resolve, record, target, introducer }) {
  const acks = [];
  const ownerText = (label, body) => acks.push({ label, body });

  const quienIntroName = sanitizeIntroName(introducer);
  if (!quienIntroName) {
    ownerText('ia360_intro_bad_name', `No leí un nombre válido de quién presenta en "${introducer}".`);
    return { acks };
  }
  const resolved = resolve(target);
  if (resolved.kind === 'none') { ownerText('ia360_intro_target_none', 'none'); return { acks }; }
  if (resolved.kind === 'ambiguous') { ownerText('ia360_intro_target_ambiguous', 'ambiguous'); return { acks }; }

  const contactNumber = resolved.candidates[0].contact_number;
  let introducerNumber = null;
  const introResolved = resolve(introducer);
  if (introResolved.kind === 'name' || introResolved.kind === 'number') {
    introducerNumber = introResolved.candidates[0].contact_number;
  }
  const customFields = buildIntroCustomFields({
    quienIntroName,
    introducerNumber,
    ownerNumber: OWNER,
    contactNumber,
    botNumber: BOT,
    nowIso: '2026-06-16T00:00:00.000Z',
  });
  store.merge({ waNumber: record.wa_number, contactNumber, customFields });
  ownerText('ia360_intro_saved', `${resolved.candidates[0].contact_name || contactNumber} presentado por ${quienIntroName}`);
  return { acks, contactNumber };
}

// ── Replica de los dos puntos de consumo en webhook.js ─────────────────────
// FRIO: gate del template referido_contexto (deny cold_send_missing_quien_intro
// si compactQuienIntro devuelve null). Devuelve {deny} o {templateVars}.
function coldReferidoGate(contact) {
  const quienIntro = compactQuienIntro(contact?.custom_fields?.quien_intro || '', 60);
  if (!quienIntro) return { deny: 'cold_send_missing_quien_intro' };
  return { templateVars: { '2': quienIntro } };
}
// CALIENTE: draft del opener + deteccion de placeholder (copyStatus 'blocked').
function hotReferidoDraft(contact, displayName) {
  const quienIntro = String(contact?.custom_fields?.quien_intro || '').trim() || null;
  const draft = buildReferidoContextoDraft({ name: displayName, quienIntro });
  return { draft, blocked: hasUnresolvedQuienIntroPlaceholder(draft) };
}

// ───────────────────────────────────────────────────────────────────────────

test('parser: "intro <contacto>: <quien>" y atajo "referido <contacto> de <quien>"', () => {
  assert.deepEqual(
    parseIa360OwnerIntroCommand('intro Carlos del BNI: Juan Pérez'),
    { target: 'Carlos del BNI', introducer: 'Juan Pérez' },
    'el formato canonico con dos puntos separa aunque el contacto traiga "del"');
  assert.deepEqual(
    parseIa360OwnerIntroCommand('referido Carlos de Juan Pérez'),
    { target: 'Carlos', introducer: 'Juan Pérez' });
  assert.equal(parseIa360OwnerIntroCommand('hola que tal'), null);
  assert.equal(parseIa360OwnerIntroCommand('idea: algo'), null, 'no colisiona con otros comandos');
  assert.equal(parseIa360OwnerIntroCommand('intro Carlos:'), null, 'sin introductor => null');
});

test('E2E: owner teclea la intro -> quien_intro persiste y referido_por apunta al ALIADO (no al owner)', () => {
  const store = makeStore([
    // El contacto referido ya existe (capturado por vCard), pero SIN quien_intro.
    { wa_number: BOT, contact_number: REFERIDO, name: 'Carlos Sandbox',
      custom_fields: { staged: true, referido_por: OWNER /* hoy mal: apunta al owner */ } },
  ]);
  const resolve = makeResolver([
    { contact_number: REFERIDO, contact_name: 'Carlos Sandbox' },
    { contact_number: ALIADO, contact_name: ALIADO_NOMBRE },
  ]);
  const record = { wa_number: BOT, contact_number: OWNER, message_type: 'text',
    message_body: `intro Carlos Sandbox: ${ALIADO_NOMBRE}` };

  const parsed = parseIa360OwnerIntroCommand(record.message_body);
  assert.ok(parsed, 'el comando del owner se reconoce');

  const { acks, contactNumber } = runIntroCommand({ store, resolve, record, ...parsed });

  // Ack correcto, sin error.
  assert.equal(acks.length, 1);
  assert.equal(acks[0].label, 'ia360_intro_saved');
  assert.equal(contactNumber, REFERIDO);

  // quien_intro persistido en el contacto REFERIDO.
  const after = store.get(BOT, REFERIDO);
  assert.equal(after.custom_fields.quien_intro, ALIADO_NOMBRE, 'quien_intro quedo persistido');
  assert.equal(after.custom_fields.intro_capturada_por, 'owner-comando');
  // referido_por re-apuntado al ALIADO real, ya NO al owner.
  assert.equal(after.custom_fields.referido_por, ALIADO, 'referido_por apunta al aliado real');
  assert.notEqual(after.custom_fields.referido_por, OWNER, 'referido_por ya NO es el owner');
});

test('E2E efecto: con quien_intro tecleado, FRIO no deny y CALIENTE no placeholder', () => {
  const store = makeStore([
    { wa_number: BOT, contact_number: REFERIDO, name: 'Carlos Sandbox', custom_fields: {} },
  ]);
  const resolve = makeResolver([
    { contact_number: REFERIDO, contact_name: 'Carlos Sandbox' },
    { contact_number: ALIADO, contact_name: ALIADO_NOMBRE },
  ]);
  const record = { wa_number: BOT, contact_number: OWNER, message_type: 'text' };

  // ── ANTES de teclear: ambos caminos bloqueados ──
  const before = store.get(BOT, REFERIDO);
  const coldBefore = coldReferidoGate(before);
  const hotBefore = hotReferidoDraft(before, 'Carlos');
  assert.equal(coldBefore.deny, 'cold_send_missing_quien_intro', 'frio: sin dato => deny');
  assert.equal(hotBefore.blocked, true, 'caliente: sin dato => placeholder => blocked');
  assert.ok(hotBefore.draft.includes(IA360_QUIEN_INTRO_PLACEHOLDER), 'el draft trae el placeholder crudo');

  // ── El owner teclea la intro ──
  const parsed = parseIa360OwnerIntroCommand(`intro Carlos Sandbox: ${ALIADO_NOMBRE}`);
  runIntroCommand({ store, resolve, record, ...parsed });

  // ── DESPUES de teclear: ambos caminos desbloqueados, usando la intro real ──
  const after = store.get(BOT, REFERIDO);
  const coldAfter = coldReferidoGate(after);
  const hotAfter = hotReferidoDraft(after, 'Carlos');

  assert.equal(coldAfter.deny, undefined, 'frio: ya NO deny');
  assert.deepEqual(coldAfter.templateVars, { '2': ALIADO_NOMBRE }, 'frio: el {{2}} usa la intro tecleada');

  assert.equal(hotAfter.blocked, false, 'caliente: ya NO blocked');
  assert.ok(!hasUnresolvedQuienIntroPlaceholder(hotAfter.draft), 'caliente: sin placeholder');
  assert.ok(hotAfter.draft.includes(`nos presentó ${ALIADO_NOMBRE}`), 'caliente: arma la intro real');

  // Imprime el contraste de mensajes para el reporte.
  console.log('\n  [SIN quien_intro] FRIO  =>', JSON.stringify(coldBefore));
  console.log('  [SIN quien_intro] CALIENTE =>', hotBefore.draft);
  console.log('\n  [CON quien_intro] FRIO  =>', JSON.stringify(coldAfter));
  console.log('  [CON quien_intro] CALIENTE =>', hotAfter.draft, '\n');
});

test('sanitize: inyeccion de llaves/control se limpia; un nombre vacio no persiste', () => {
  assert.equal(sanitizeIntroName('Juan {{2}} Pérez'), 'Juan 2 Pérez', 'quita llaves (no inyectar placeholders)');
  assert.equal(sanitizeIntroName('   '), null);
  assert.equal(sanitizeIntroName('123456'), null, 'solo digitos no es nombre');
});

test('referido_por NO se setea si el aliado coincide con owner/bot/contacto', () => {
  // Aliado resuelve al OWNER => buildIntroCustomFields no debe poner referido_por.
  const cf = buildIntroCustomFields({
    quienIntroName: 'Quien Sea', introducerNumber: OWNER,
    ownerNumber: OWNER, contactNumber: REFERIDO, botNumber: BOT, nowIso: 'x',
  });
  assert.equal(cf.quien_intro, 'Quien Sea');
  assert.equal(cf.referido_por, undefined, 'nunca apuntamos el referido al owner');
});

test('webhook.js cablea el modulo puro en los DOS puntos de consumo + el comando', () => {
  assert.match(src, /require\('\.\/ia360ReferidoIntro'\)/, 'falta el require del modulo');
  // Dispatch del comando del owner.
  assert.match(src, /const introCmd = parseIa360OwnerIntroCommand\(record\.message_body\)/);
  assert.match(src, /handleIa360OwnerIntroCommand\(\{ record, target: introCmd\.target, introducer: introCmd\.introducer \}\)/);
  // El handler persiste via mergeContactIa360State.
  const h = src.indexOf('async function handleIa360OwnerIntroCommand');
  assert.notEqual(h, -1, 'falta el handler');
  const hBody = src.slice(h, h + 3000);
  assert.match(hBody, /buildIa360IntroCustomFields\(/);
  assert.match(hBody, /mergeContactIa360State\(/);
  // CALIENTE: el draft usa la funcion del modulo.
  assert.match(src, /draft: \(\{ name, quienIntro \}\) => buildIa360ReferidoContextoDraft\(\{ name, quienIntro \}\)/);
  // FRIO: el gate usa compactQuienIntroPure y conserva el deny.
  const cold = src.indexOf("if (sequence.id === 'referido_contexto')");
  assert.notEqual(cold, -1, 'falta el gate frio');
  const coldBody = src.slice(cold, cold + 600);
  assert.match(coldBody, /compactQuienIntroPure\(contact\.custom_fields\?\.quien_intro/);
  assert.match(coldBody, /deny\('cold_send_missing_quien_intro'/);
});
