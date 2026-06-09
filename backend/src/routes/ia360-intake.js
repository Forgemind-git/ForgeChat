'use strict';

// ============================================================================
// B-28 — Endpoint de alta de contacto (S0 fuente web)
// ----------------------------------------------------------------------------
// INVARIANTE DURO: captura != envio. Este endpoint SOLO escribe a
// coexistence.contacts con staged=true. NUNCA encola ni envia un mensaje.
// Prohibido importar/llamar: enqueueSend, insertPendingRow, resolveAccount,
// enqueueIa360Interactive/Flow/Text, sendOwnerInteractive, sendIa360DirectText,
// ni fetch hacia graph.facebook.com. Solo pool.query.
//
// Lo llama el workflow n8n "IA360 Alta Contacto Web (B-28)" por la URL publica
// https://wa.geekstudio.dev/api/ia360-intake (n8n y forgecrm estan en redes
// docker distintas). Auth = header secreto compartido X-IA360-Intake-Secret.
// Montado en index.js en la zona PUBLICA (sin authMiddleware), debajo de
// app.use('/api', webhookRouter).
// ============================================================================

const { Router } = require('express');
const crypto = require('crypto');
const pool = require('../db');

const router = Router();

const INTAKE_SECRET = process.env.IA360_INTAKE_SECRET || '';
// Linea de negocio WABA IA360 = a quien le escribiria el contacto (wa_number).
const IA360_BUSINESS_WA_NUMBER = process.env.IA360_BUSINESS_WA_NUMBER || '5213321594582';

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function onlyDigits(s) {
  return String(s == null ? '' : s).replace(/[^0-9]/g, '');
}

// Normaliza a E.164 (solo digitos, sin '+'), default Mexico movil (521 + 10).
function normalizeE164Mx(raw) {
  let d = onlyDigits(raw);
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);          // prefijo internacional 00
  if (d.length === 10) return '521' + d;           // 10 digitos MX -> 521 + 10
  if (d.length === 12 && d.startsWith('52')) return '521' + d.slice(2); // 52 + 10 -> 521 + 10
  if (d.length === 13 && d.startsWith('521')) return d; // ya normalizado
  if (d.length === 11 && d.startsWith('1')) return d;   // US/CA: 1 + 10
  return d; // internacional u otro: deja los digitos crudos
}

router.post('/ia360-intake', async (req, res) => {
  // 1) Auth por secreto compartido (timing-safe)
  const provided = req.get('X-IA360-Intake-Secret') || '';
  if (!INTAKE_SECRET || !timingSafeEqualStr(provided, INTAKE_SECRET)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    const b = req.body || {};

    // 2) Llave del contacto: contact_number normalizado a E.164
    const contactNumber = normalizeE164Mx(b.contact_number || b.telefono);
    if (!contactNumber) {
      return res.status(422).json({
        ok: false,
        error: 'contact_number_required',
        detail: 'sin telefono normalizable a E.164 no hay llave para coexistence.contacts'
      });
    }
    const waNumber = onlyDigits(b.wa_number) || IA360_BUSINESS_WA_NUMBER;
    const name = (b.name || b.nombre || null); const profileName = (b.profile_name || name || null); /* FIX B-28: poblar profile_name (columna que muestra la UI/CRM) */

    // 3) tags entrantes (array de strings) -> merge DISTINCT
    const tags = Array.isArray(b.tags)
      ? b.tags.filter((t) => typeof t === 'string' && t.trim())
      : [];

    // 4) custom_fields entrantes (objeto) -> staged SIEMPRE true (invariante B-28)
    const cf = (b.custom_fields && typeof b.custom_fields === 'object' && !Array.isArray(b.custom_fields))
      ? { ...b.custom_fields }
      : {};
    cf.staged = true;                                  // capturado, FUERA del auto-ruteo R0
    if (!cf.stage) cf.stage = 'Capturado / Por rutear';
    if (!cf.captured_at) cf.captured_at = new Date().toISOString();
    cf.intake_source = cf.intake_source || 'b28-web-form';

    // 5) Upsert idempotente (patron mergeContactIa360State + name).
    //    (xmax = 0) distingue INSERT nuevo (true) de UPDATE por conflicto (false).
    const result = await pool.query(
      `INSERT INTO coexistence.contacts (wa_number, contact_number, name, profile_name, tags, custom_fields, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())
       ON CONFLICT (wa_number, contact_number) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, coexistence.contacts.name), profile_name = COALESCE(coexistence.contacts.profile_name, EXCLUDED.profile_name),
         tags = (
           SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
           FROM jsonb_array_elements_text(
             COALESCE(coexistence.contacts.tags, '[]'::jsonb) || EXCLUDED.tags
           ) AS value
         ),
         custom_fields = COALESCE(coexistence.contacts.custom_fields, '{}'::jsonb) || EXCLUDED.custom_fields,
         updated_at = NOW()
       RETURNING id, wa_number, contact_number, name, profile_name, tags, custom_fields, created_at, updated_at, (xmax = 0) AS inserted`,
      [waNumber, contactNumber, name, profileName, JSON.stringify(tags), JSON.stringify(cf)]
    );

    const row = result.rows[0];
    const inserted = row.inserted === true;
    delete row.inserted;

    // INVARIANTE B-28: cero outbound. No se encola ni envia nada.
    return res.status(200).json({ ok: true, staged: true, deduped: !inserted, contact: row });
  } catch (err) {
    console.error('[ia360-intake] error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'intake_failed', detail: err && err.message });
  }
});

module.exports = { router };
