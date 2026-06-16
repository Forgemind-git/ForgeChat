const { Router } = require('express');
const pool = require('../db');
const { decrypt } = require('../util/crypto');
const { safeEqual, verifyMetaSignature } = require('../util/webhookSignature');
const { evaluateTriggers, resumeAutomation } = require('../engine/automationEngine');
const { markPending, MEDIA_TYPES } = require('../services/mediaDownloader');
const { enqueueMediaDownload } = require('../queue/mediaQueue');
const { resolveAccount, insertPendingRow, secondsSinceLastIncoming } = require('../services/messageSender');
const { enqueueSend } = require('../queue/sendQueue');
const { getIa360StageForEvent, getIa360StageForReply } = require('../services/ia360Mapping');
const { classifyOpenerReply, extractInteractiveReplyId } = require('./ia360OpenerReply');
const { evaluatePaymentStatus } = require('../services/paymentCircuitBreaker');
const {
  IA360_DEFAULT_PIPELINE_NAME,
  IA360_PARTNERS_PIPELINE_NAME,
  ia360PipelineForRelationship,
  ia360ResolveStageName,
} = require('./ia360DealRouting');

const router = Router();

/**
 * Parse a Meta WhatsApp Cloud API webhook payload and extract message records.
 * Handles: text, image, video, audio, document, location, sticker, contacts,
 *          interactive (button_reply / list_reply), reaction, and status updates.
 */
// Normalize WhatsApp phone numbers to digits-only — strips '+', spaces, dashes.
// Meta sometimes includes leading '+' in display_phone_number, sometimes not;
// without this, the same conversation lands under two different wa_numbers and
// shows as duplicate chat threads.
function normalizePhone(s) {
  if (!s) return s;
  return String(s).replace(/\D/g, '');
}

function parseMetaPayload(body) {
  const records = [];

  if (!body || body.object !== 'whatsapp_business_account') {
    return records;
  }

  const entries = body.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const value = change.value || {};
      if (value.messaging_product !== 'whatsapp') continue;

      const metadata = value.metadata || {};
      const phoneNumberId = metadata.phone_number_id || '';
      const displayPhoneNumber = metadata.display_phone_number || '';

      // Contact profile info (name mapping)
      const contactProfiles = {};
      (value.contacts || []).forEach(c => {
        const waId = c.wa_id || '';
        const name = c.profile?.name || '';
        if (waId && name) contactProfiles[waId] = name;
      });

      // Parse a single message (shared logic for incoming and outgoing)
      function parseMessage(msg, direction, waNum, contactNum) {
        const record = {
          message_id: msg.id || '',
          phone_number_id: phoneNumberId,
          wa_number: normalizePhone(waNum || displayPhoneNumber),
          contact_number: normalizePhone(contactNum || ''),
          to_number: normalizePhone(msg.to || ''),
          direction,
          message_type: msg.type || 'unknown',
          message_body: null,
          raw_payload: JSON.stringify(body),
          media_url: null,
          media_mime_type: null,
          status: direction === 'incoming' ? 'received' : 'sent',
          timestamp: msg.timestamp
            ? new Date(parseInt(msg.timestamp, 10) * 1000).toISOString()
            : new Date().toISOString(),
          contact_name: contactProfiles[contactNum] || null,
          // Quote-reply: when the customer replies to a specific message, Meta
          // sends the quoted message's wamid here. Stored so we can render the
          // quoted bubble above their reply.
          context_message_id: msg.context?.id || null,
        };

        const type = msg.type;
        if (type === 'text' && msg.text) {
          record.message_body = msg.text.body || '';
        } else if (type === 'image' && msg.image) {
          record.message_body = msg.image.caption || '';
          record.media_mime_type = msg.image.mime_type || null;
          record.media_url = msg.image.id || null;
        } else if (type === 'video' && msg.video) {
          record.message_body = msg.video.caption || '';
          record.media_mime_type = msg.video.mime_type || null;
          record.media_url = msg.video.id || null;
        } else if (type === 'audio' && msg.audio) {
          record.message_body = 'Audio message';
          record.media_mime_type = msg.audio.mime_type || null;
          record.media_url = msg.audio.id || null;
        } else if (type === 'voice' && msg.voice) {
          record.message_body = 'Voice message';
          record.media_mime_type = msg.voice.mime_type || null;
          record.media_url = msg.voice.id || null;
        } else if (type === 'document' && msg.document) {
          record.message_body = msg.document.filename || '';
          record.media_mime_type = msg.document.mime_type || null;
          record.media_url = msg.document.id || null;
          record.media_filename = msg.document.filename || null;
        } else if (type === 'location' && msg.location) {
          const lat = msg.location.latitude || '';
          const lng = msg.location.longitude || '';
          record.message_body = `Location: ${lat}, ${lng}`;
        } else if (type === 'sticker' && msg.sticker) {
          record.message_body = 'Sticker';
          record.media_mime_type = msg.sticker.mime_type || null;
          record.media_url = msg.sticker.id || null;
        } else if (type === 'contacts' && msg.contacts) {
          const names = msg.contacts.map(c => c.name?.formatted_name || c.name?.first_name || 'Contact').join(', ');
          record.message_body = `Shared contact(s): ${names}`;
        } else if (type === 'interactive' && msg.interactive) {
          const reply = msg.interactive.button_reply || msg.interactive.list_reply || {};
          record.message_body = reply.title || 'Interactive response';
          record.message_type = 'interactive';
        } else if (type === 'button' && msg.button) {
          record.message_body = msg.button.text || msg.button.payload || 'Button response';
          record.message_type = 'button';
        } else if (type === 'reaction' && msg.reaction) {
          record.message_body = `Reaction: ${msg.reaction.emoji || ''}`;
          record.message_type = 'reaction';
          // Capture the target message + emoji so the insert loop can attach it
          // to that message instead of creating a standalone bubble. Empty emoji
          // = the customer removed their reaction.
          record.reaction = {
            targetMessageId: msg.reaction.message_id || null,
            emoji: msg.reaction.emoji || '',
            from: msg.from || null,
          };
        } else if (type === 'order' && msg.order) {
          record.message_body = 'Order received';
        } else if (type === 'system' && msg.system) {
          record.message_body = msg.system.body || 'System message';
        } else if (type === 'unknown' && msg.errors) {
          record.message_body = `Error: ${msg.errors[0]?.message || 'Unknown error'}`;
          record.status = 'error';
        }

        return record;
      }

      // Incoming messages
      const messages = value.messages || [];
      for (const msg of messages) {
        records.push(parseMessage(msg, 'incoming', displayPhoneNumber, msg.from));
      }

      // Outgoing message echoes (messages sent from the WhatsApp Business app)
      const messageEchoes = value.message_echoes || [];
      for (const msg of messageEchoes) {
        // For echoes: from = business number, to = customer
        records.push(parseMessage(msg, 'outgoing', displayPhoneNumber, msg.to));
      }

      // Status updates (delivered, read, sent)
      const statuses = value.statuses || [];
      for (const status of statuses) {
        records.push({
          message_id: status.id || '',
          phone_number_id: phoneNumberId,
          wa_number: normalizePhone(displayPhoneNumber),
          contact_number: normalizePhone(status.recipient_id || ''),
          to_number: normalizePhone(status.recipient_id || ''),
          direction: 'outgoing',
          message_type: 'status',
          message_body: `Status: ${status.status || ''}`,
          raw_payload: JSON.stringify(body),
          media_url: null,
          media_mime_type: null,
          status: status.status || 'unknown',
          timestamp: status.timestamp
            ? new Date(parseInt(status.timestamp, 10) * 1000).toISOString()
            : new Date().toISOString(),
          contact_name: contactProfiles[status.recipient_id] || null,
          // Include full status payload for trigger evaluation
          conversation: status.conversation || null,
          pricing: status.pricing || null,
          errors: status.errors || null,
        });
      }
    }
  }

  return records;
}

async function mergeContactIa360State({ waNumber, contactNumber, tags = [], customFields = {} }) {
  if (!waNumber || !contactNumber) return;
  await pool.query(
    `INSERT INTO coexistence.contacts (wa_number, contact_number, tags, custom_fields, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW())
     ON CONFLICT (wa_number, contact_number) DO UPDATE SET
       tags = (
         SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
         FROM jsonb_array_elements_text(
           COALESCE(coexistence.contacts.tags, '[]'::jsonb) || EXCLUDED.tags
         ) AS value
       ),
       custom_fields = COALESCE(coexistence.contacts.custom_fields, '{}'::jsonb) || EXCLUDED.custom_fields,
       updated_at = NOW()`,
    [waNumber, contactNumber, JSON.stringify(tags), JSON.stringify(customFields)]
  );
}

let ia360MemoryTablesReady = null;
const IA360_MEMORY_EGRESS_ON = process.env.IA360_MEMORY_EGRESS === 'on';

async function ensureIa360MemoryTables() {
  if (!ia360MemoryTablesReady) {
    ia360MemoryTablesReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS coexistence.ia360_memory_events (
          id BIGSERIAL PRIMARY KEY,
          schema_version TEXT NOT NULL DEFAULT 'ia360_memory_event.v1',
          source TEXT NOT NULL DEFAULT 'whatsapp',
          contact_wa_number TEXT,
          contact_number TEXT,
          forgechat_contact_id BIGINT,
          espo_contact_id TEXT,
          contact_name TEXT,
          contact_role TEXT,
          account_name TEXT,
          project_name TEXT,
          persona TEXT,
          lifecycle_stage TEXT,
          area TEXT NOT NULL,
          signal_type TEXT NOT NULL,
          confidence NUMERIC(4,3) NOT NULL DEFAULT 0.650,
          summary TEXT NOT NULL,
          business_impact TEXT,
          missing_data TEXT,
          next_action TEXT,
          should_be_fact BOOLEAN NOT NULL DEFAULT false,
          crm_sync_status TEXT NOT NULL DEFAULT 'dry_run_compact',
          rag_index_status TEXT NOT NULL DEFAULT 'structured_lookup_ready',
          owner_review_status TEXT NOT NULL DEFAULT 'required',
          external_send_allowed BOOLEAN NOT NULL DEFAULT false,
          contains_sensitive_data BOOLEAN NOT NULL DEFAULT false,
          store_transcript BOOLEAN NOT NULL DEFAULT false,
          source_message_id TEXT,
          source_chat_history_id BIGINT,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ia360_memory_events_source_area_uidx
          ON coexistence.ia360_memory_events (source_message_id, area, signal_type)
          WHERE source_message_id IS NOT NULL
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS ia360_memory_events_contact_idx
          ON coexistence.ia360_memory_events (contact_wa_number, contact_number, created_at DESC)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS ia360_memory_events_project_area_idx
          ON coexistence.ia360_memory_events (project_name, area, created_at DESC)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS coexistence.ia360_memory_facts (
          id BIGSERIAL PRIMARY KEY,
          schema_version TEXT NOT NULL DEFAULT 'ia360_memory_fact.v1',
          fact_key TEXT NOT NULL UNIQUE,
          source_event_id BIGINT REFERENCES coexistence.ia360_memory_events(id) ON DELETE SET NULL,
          source TEXT NOT NULL DEFAULT 'whatsapp',
          contact_wa_number TEXT,
          contact_number TEXT,
          forgechat_contact_id BIGINT,
          espo_contact_id TEXT,
          account_name TEXT,
          project_name TEXT,
          persona TEXT,
          role TEXT,
          preference TEXT,
          objection TEXT,
          recurring_pain TEXT,
          affected_process TEXT,
          missing_metric TEXT,
          confidence NUMERIC(4,3) NOT NULL DEFAULT 0.650,
          owner_review_status TEXT NOT NULL DEFAULT 'pending_owner_review',
          status TEXT NOT NULL DEFAULT 'pending_owner_review',
          evidence_count INTEGER NOT NULL DEFAULT 1,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS ia360_memory_facts_contact_idx
          ON coexistence.ia360_memory_facts (contact_wa_number, contact_number, last_seen_at DESC)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS ia360_memory_facts_project_area_idx
          ON coexistence.ia360_memory_facts (project_name, affected_process, last_seen_at DESC)
      `);
    })().catch(err => {
      ia360MemoryTablesReady = null;
      throw err;
    });
  }
  return ia360MemoryTablesReady;
}

function stripSensitiveIa360Text(text, max = 220) {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/\b(?:sk|pk|rk|org|proj)-[A-Za-z0-9_-]{16,}\b/g, '[secret]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function buildIa360CrmCompactNote({ record, agent }) {
  const parts = [
    `canal=whatsapp`,
    `tipo=${record?.message_type || 'text'}`,
    `accion=${agent?.action || 'reply'}`,
    `intent=${agent?.intent || 'unknown'}`,
  ];
  if (agent?.extracted?.area_operacion) parts.push(`area=${stripSensitiveIa360Text(agent.extracted.area_operacion, 80)}`);
  if (agent?.extracted?.dolor) parts.push(`dolor=${stripSensitiveIa360Text(agent.extracted.dolor, 120)}`);
  return parts.join('; ');
}

async function loadIa360ContactContext(record) {
  if (!record?.wa_number || !record?.contact_number) return null;
  const { rows } = await pool.query(
    `SELECT id, COALESCE(name, profile_name) AS name, tags, custom_fields
       FROM coexistence.contacts
      WHERE wa_number=$1 AND contact_number=$2
      LIMIT 1`,
    [record.wa_number, record.contact_number]
  );
  return rows[0] || null;
}

function isIa360ClienteActivoBetaContact(contact) {
  const cf = contact?.custom_fields || {};
  const beta = cf.ia360_cliente_activo_beta || {};
  const tags = Array.isArray(contact?.tags) ? contact.tags.map(t => String(t || '').toLowerCase()) : [];
  return beta.schema === 'cliente_activo_beta.v1'
    || beta.contact_role === 'cliente_activo_cfo_champion'
    || cf.lifecycle_stage === 'cliente_activo_beta_supervisado'
    || cf.relationship_context === 'cliente_activo_beta_supervisado'
    || tags.includes('cliente-activo-beta');
}

// G-LIVE: números QA del harness E2E (pruebas sintéticas autorizadas). Longitud
// exacta de 13 dígitos (521 + 99900XXXXX): un '\d*' laxo dejaría pasar móviles
// reales de la lada 999 (Mérida) como si fueran QA.
const IA360_QA_NUMBER_RE = /^52199900\d{5}$/;

// G-LIVE: pregunta que requiere DATOS VIVOS del portal del cliente (saldos, listas,
// estatus). Lectura de estado => handoff explícito, nunca inventar. La guía de uso
// ("¿cómo subo información al portal?") NO matchea: esa sí la responde el agente.
function isIa360PortalLiveDataQuestion(body) {
  const t = String(body || '').toLowerCase();
  if (!/(portal|plataforma)/.test(t)) return false;
  return /(cu[aá]nt[oa]s?\b|cu[aá]les\b|qu[eé] (hay|tiene|dice|muestra|aparece)|lista(do)?\s+de|estatus|estado de|sald[oa]s?|pendientes? de pago|cargad[oa]s?|registrad[oa]s?)/.test(t);
}

// G-LIVE: perfil de comunicación para el agente IA. Viaja como `role` en el payload;
// el nodo Normalize del workflow n8n lo expone al modelo como contact.role (sin tocar
// n8n publicado). do_not_pitch => tono ejecutivo: corto, negocio, control/riesgo.
function isIa360DoNotPitchContact(contact) {
  const cf = contact?.custom_fields || {};
  const beta = cf.ia360_cliente_activo_beta || {};
  const role = beta.contact_role || cf.project_role || cf.rol_comite || 'cliente activo beta';
  const noPitchRaw = beta.do_not_pitch != null ? beta.do_not_pitch : cf.do_not_pitch;
  return noPitchRaw === true || noPitchRaw === 1
    || /^(true|1|s[ií]|yes)$/i.test(String(noPitchRaw || ''))
    || /cfo|champion|finanzas/i.test(String(role));
}

function buildIa360ClienteActivoBetaRoleHint(contact) {
  const cf = contact?.custom_fields || {};
  const beta = cf.ia360_cliente_activo_beta || {};
  const role = beta.contact_role || cf.project_role || cf.rol_comite || 'cliente activo beta';
  const noPitch = isIa360DoNotPitchContact(contact);
  const parts = [String(role), 'cliente activo en beta supervisada'];
  if (noPitch) parts.push('do_not_pitch: PROHIBIDO vender, pitchear u ofrecer nuevos servicios');
  parts.push('estilo ejecutivo: respuesta corta, implicación de negocio, control y riesgo, sin detalle técnico salvo que lo pida');
  return parts.join(' | ');
}

// ── G-BRAIN: estado conversacional del agente por contacto ─────────────────────
// El agente excavaba sin memoria de turno (caso José Ramón 06-11: 8 preguntas
// seguidas, ninguna propuesta, re-preguntas de lo ya respondido). El estado vive
// en custom_fields.ia360_conv_state y entra al agente vía roleHint (mecanismo
// G-LIVE: Normalize lo mapea a contact.role en el agent_input, SIN tocar n8n).
const IA360_CONV_QUESTION_BUDGET = 4; // preguntas máximas de diagnóstico por conversación
const IA360_CONV_OPTIONS_EVERY = 3;   // cada N turnos del agente: resumen + opciones

function loadIa360ConvState(contact) {
  const raw = contact?.custom_fields?.ia360_conv_state;
  const st = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  return {
    turns: Number(st.turns) || 0,
    asked_total: Number(st.asked_total) || 0,
    questions_asked: Array.isArray(st.questions_asked) ? st.questions_asked : [],
    answered: (st.answered && typeof st.answered === 'object' && !Array.isArray(st.answered)) ? st.answered : {},
    corrections: Array.isArray(st.corrections) ? st.corrections : [],
    last_options_turn: Number(st.last_options_turn) || 0,
  };
}

// Oraciones interrogativas del reply del agente (terminadas en '?'), compactas.
function extractIa360Questions(text) {
  return String(text || '')
    .split(/(?<=[?.!\n])/)
    .map(s => s.trim())
    .filter(s => s.endsWith('?'))
    .map(s => (s.length > 160 ? s.slice(0, 157) + '...' : s));
}

// Señal de corrección del contacto ("el problema sí es CRM porque no se usa
// ninguno"): el agente debe respetarla y nunca volver al dato corregido.
function detectIa360Correction(body) {
  return /(no,?\s+(es|era|así)|me refer[ií]|en realidad|m[aá]s bien|te corrijo|no me refiero|no es eso|el problema\s+(s[ií]|si)\s+es)/i.test(String(body || ''));
}

// Señal de compra o de carencia explícita: el siguiente mensaje propone, no pregunta.
function detectIa360BuyingSignal(body) {
  return /(no (tenemos|hay|contamos con|usamos)\s|nos (falta|urge|interesa)|c[oó]mo le (hacemos|hago)|qu[eé] (sigue|necesitas|propones)|me interesa|cu[aá]nto (cuesta|sale)|d[oó]nde (firmo|empiezo)|ay[uú]dame con)/i.test(String(body || ''));
}

// "Dolor calificado" en adelante: el agente deja de excavar y PROPONE.
function ia360StageMode(stageName) {
  return ['Dolor calificado', 'Agenda en proceso', 'Reunión agendada', 'Requiere Alek'].includes(String(stageName || ''))
    ? 'proponer' : 'excavar';
}

function buildIa360ConversationRoleHint({ contact, stageName, convState, memory, messageBody = '' }) {
  const st = convState || loadIa360ConvState(contact);
  const profile = getIa360ContactProfile(contact);
  const parts = [];
  if (profile.name) parts.push(`hablas con ${profile.name}${profile.role ? ` (${profile.role})` : ''}${profile.accountName ? ` de ${profile.accountName}` : ''}`);

  // Memoria del contacto (memory-lookup): el modelo DEBE usarla, no re-preguntarla.
  const factBits = [];
  for (const f of (memory?.facts || []).slice(0, 4)) {
    const bit = [f.recurring_pain, f.preference, f.objection].filter(Boolean).join('; ');
    if (bit) factBits.push(bit);
  }
  for (const e of (memory?.events || []).slice(0, 2)) {
    if (e.summary) factBits.push(String(e.summary));
  }
  if (factBits.length) parts.push(`contexto que YA SABES del contacto (úsalo en tu respuesta, no preguntes lo que ya sabes): ${factBits.slice(0, 5).map(b => String(b).slice(0, 140)).join(' / ')}`);

  // Estado de ESTA conversación.
  const learned = Object.entries(st.answered).filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}=${String(v).slice(0, 80)}`);
  if (learned.length) parts.push(`el contacto YA respondió: ${learned.join(', ')} — PROHIBIDO volver a preguntarlo`);
  if (st.corrections.length) parts.push(`correcciones del contacto que DEBES respetar: ${st.corrections.slice(-2).map(c => `«${String(c).slice(0, 110)}»`).join(' ')}`);
  if (st.questions_asked.length) parts.push(`preguntas que YA hiciste (no las repitas ni las reformules): ${st.questions_asked.slice(-4).map(q => `«${q}»`).join(' ')}`);

  // Modo por etapa.
  if (ia360StageMode(stageName) === 'proponer') {
    parts.push(`etapa "${stageName}": MODO PROPONER — deja de excavar; resume el dolor en 1-2 líneas y propone 2-3 acciones concretas (resumen del mapa de su operación, llamada con Alek, mini-plan inicial); si preguntas, que sea SOLO para elegir entre esas opciones`);
  } else {
    parts.push(`etapa "${stageName || 'inicio'}": puedes explorar el dolor, con presupuesto de preguntas`);
  }

  // Presupuesto de preguntas.
  if (st.asked_total >= IA360_CONV_QUESTION_BUDGET) {
    parts.push(`presupuesto de preguntas AGOTADO (${st.asked_total}/${IA360_CONV_QUESTION_BUDGET}): NO hagas más preguntas de diagnóstico; resume lo aprendido y propone 2-3 siguientes pasos concretos`);
  } else {
    parts.push(`presupuesto de preguntas: ${st.asked_total}/${IA360_CONV_QUESTION_BUDGET} usadas en la conversación; máximo UNA pregunta por mensaje, nunca dos`);
  }

  // Cadencia de cierre con opciones.
  if (st.turns > 0 && (st.turns - st.last_options_turn) >= IA360_CONV_OPTIONS_EVERY) {
    parts.push('en ESTE turno toca cierre: resume en 2-3 líneas lo aprendido hasta ahora y ofrece 2-3 opciones de siguiente paso (resumen del mapa, llamada con Alek, mini-plan), no otra pregunta abierta');
  }
  if (detectIa360BuyingSignal(messageBody)) {
    parts.push('el último mensaje trae SEÑAL DE COMPRA o carencia explícita: responde proponiendo el siguiente paso concreto, NO con otra pregunta de diagnóstico');
  }
  parts.push('si dejaste una pregunta abierta y el contacto no la respondió, retómala o ciérrala explícitamente; nunca la abandones en silencio');
  return parts.join(' | ');
}

// Persistencia del estado tras CADA reply conversacional enviado.
async function updateIa360ConvState({ record, contact, agent, replyBody, convState }) {
  try {
    const st = convState || loadIa360ConvState(contact);
    const newQuestions = extractIa360Questions(replyBody);
    const answered = { ...st.answered };
    for (const [k, v] of Object.entries(agent?.extracted || {})) {
      if (v != null && String(v).trim() !== '') answered[k] = String(v).slice(0, 120);
    }
    const corrections = [...st.corrections];
    if (detectIa360Correction(record.message_body)) corrections.push(String(record.message_body).slice(0, 140));
    const turns = st.turns + 1;
    const dueOptions = st.turns > 0 && (st.turns - st.last_options_turn) >= IA360_CONV_OPTIONS_EVERY;
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      customFields: {
        ia360_conv_state: {
          turns,
          asked_total: st.asked_total + newQuestions.length,
          questions_asked: [...st.questions_asked, ...newQuestions].slice(-8),
          answered,
          corrections: corrections.slice(-4),
          // El hint exige el cierre cuando toca; el turno que lo pidió resetea la cadencia.
          last_options_turn: dueOptions ? turns : st.last_options_turn,
          updated_at: new Date().toISOString(),
        },
      },
    });
  } catch (e) {
    console.error('[ia360-conv-state] update error:', e.message);
  }
}

// Deuda G-LIVE: post-filtro de pitch en CÓDIGO (no solo en prompt) para do_not_pitch.
function ia360ReplySmellsLikePitch(text) {
  return /(contrat(a|ar|aci[oó]n)|cotizaci[oó]n|precio especial|descuento|promoci[oó]n|plan (mensual|anual)|propuesta comercial|te (vendo|ofrezco el (servicio|plan))|upgrade|upsell)/i.test(String(text || ''));
}

function getIa360ContactProfile(contact) {
  const cf = contact?.custom_fields || {};
  const beta = cf.ia360_cliente_activo_beta || {};
  const personaFirst = cf.ia360_persona_first || {};
  return {
    forgechatContactId: contact?.id || null,
    espoContactId: cf.espo_id || '',
    name: contact?.name || '',
    role: beta.contact_role || cf.project_role || cf.rol_comite || '',
    accountName: cf.account_name || cf.empresa || beta.project || cf.project_name || '',
    projectName: beta.project || cf.project_name || cf.account_name || '',
    persona: cf.persona_principal || personaFirst?.classification?.persona_context || '',
    lifecycleStage: cf.lifecycle_stage || beta.flywheel_phase || cf.flywheel_phase || '',
  };
}

const IA360_MEMORY_SIGNAL_CATALOG = [
  {
    area: 'cartera_cobranza_portal',
    label: 'cartera/cobranza portal',
    signalType: 'dolor_operativo',
    regex: /cartera|cobran[cz]a|cuentas? por cobrar|portal|excel|comentarios?|fecha(?:s)? compromiso|promesa de pago|seguimiento de pago/i,
    summary: 'Cobranza necesita comentarios, fechas compromiso, pasos internos y seguimiento visibles en portal, no dispersos en Excel o llamadas.',
    businessImpact: 'Reduce fuga de seguimiento y mejora visibilidad financiera de cartera.',
    missingData: 'Cuenta o cliente, fecha compromiso, responsable, siguiente paso y estado actual.',
    nextAction: 'Mapear cartera -> comentario -> compromiso -> responsable -> seguimiento.',
    affectedProcess: 'cartera -> comentario -> compromiso -> responsable -> seguimiento',
    missingMetric: 'fecha compromiso y responsable por cuenta',
    confidence: 0.88,
  },
  {
    area: 'taller_garantia_dias_detencion',
    label: 'taller/garantía/días detenidos',
    signalType: 'dolor_operativo',
    regex: /taller|garant[ií]a|unidad(?:es)?|cami[oó]n|detenid|parad[ao]|refacci[oó]n|bloqueo|escalaci[oó]n|d[ií]as/i,
    summary: 'Taller necesita visibilidad de días de unidad detenida, bloqueo, responsable y criterio de escalación.',
    businessImpact: 'Una decisión de garantía o proceso puede costar más que resolver rápido si la unidad deja de operar.',
    missingData: 'Unidad, días detenida, tipo de caso, bloqueo, responsable y costo operativo estimado.',
    nextAction: 'Mapear unidad detenida -> bloqueo -> responsable -> decisión -> costo para cliente.',
    affectedProcess: 'unidad detenida -> bloqueo -> responsable -> decisión',
    missingMetric: 'días detenida por unidad y costo operativo',
    confidence: 0.90,
  },
  {
    area: 'auditoria_licencias_gasto',
    label: 'auditoría de licencias/gasto',
    signalType: 'dolor_operativo',
    regex: /licencias?|asientos?|usuarios?|gasto|software|suscripci[oó]n|uso real|permisos?|consultas?|consulta con ia/i,
    summary: 'Se necesita comparar licencias pagadas contra uso real y evaluar si IA concentra consultas sin comprar asientos innecesarios.',
    businessImpact: 'Puede bajar gasto recurrente sin perder acceso operativo a información.',
    missingData: 'Sistema, costo por licencia, usuarios activos, consultas necesarias y permisos mínimos.',
    nextAction: 'Mapear licencia pagada -> uso real -> consulta necesaria -> permiso -> ahorro posible.',
    affectedProcess: 'licencias -> uso real -> consultas -> permisos -> ahorro',
    missingMetric: 'usuarios activos contra licencias pagadas',
    confidence: 0.86,
  },
  {
    area: 'feedback_asistente',
    label: 'feedback del asistente',
    signalType: 'feedback',
    regex: /no sirve|eso no|mal|incorrect|equivoc|no ayuda|no entend|deber[ií]a|prefiero que responda|respuesta mala/i,
    summary: 'El cliente está corrigiendo la respuesta del asistente y deja aprendizaje sobre cómo debe contestar.',
    businessImpact: 'Mejora criterio del asistente y evita insistir con respuestas que no ayudan.',
    missingData: 'Qué parte falló y cuál sería la respuesta preferida.',
    nextAction: 'Registrar motivo del fallo, ajustar criterio y pedir ejemplo de respuesta útil.',
    affectedProcess: 'calidad de respuesta beta',
    missingMetric: 'motivo de fallo y respuesta esperada',
    confidence: 0.84,
  },
];

function isPassiveIa360Text(text) {
  return /^(ok|okay|gracias|va|sale|listo|perfecto|sí|si|no|👍|👌)[\s.!¡!¿?]*$/i.test(String(text || '').trim());
}

function extractIa360MemorySignals({ record, contact, agent = {} }) {
  const text = String(record?.message_body || '').trim();
  if (!text || isPassiveIa360Text(text)) return [];
  const matches = IA360_MEMORY_SIGNAL_CATALOG.filter(item => item.regex.test(text));
  if (matches.length) return matches.map(item => ({ ...item, shouldBeFact: true }));
  const extracted = agent?.extracted || {};
  const hasAgentLearning = agent?.action === 'advance_pain'
    || agent?.intent === 'ask_pain'
    || extracted.area_operacion
    || extracted.dolor;
  if (!hasAgentLearning && text.length < 32) return [];
  if (!isIa360ClienteActivoBetaContact(contact) && !hasAgentLearning) return [];
  return [{
    area: extracted.area_operacion ? stripSensitiveIa360Text(extracted.area_operacion, 80).toLowerCase().replace(/[^a-z0-9_]+/g, '_') : 'operacion_cliente',
    label: 'operación cliente',
    signalType: extracted.dolor ? 'dolor_operativo' : 'senal_operativa',
    summary: extracted.dolor
      ? stripSensitiveIa360Text(extracted.dolor, 180)
      : 'El contacto dejó una señal operativa que requiere revisión de Alek antes de convertirla en acción.',
    businessImpact: 'Impacto pendiente de precisar con dato operativo y responsable.',
    missingData: 'Dato actual, bloqueo, responsable y siguiente acción.',
    nextAction: 'Convertir la señal en mapa dato actual -> bloqueo -> responsable -> siguiente acción.',
    affectedProcess: 'operación cliente',
    missingMetric: 'dato operativo mínimo',
    confidence: hasAgentLearning ? 0.70 : 0.55,
    shouldBeFact: Boolean(extracted.dolor || isIa360ClienteActivoBetaContact(contact)),
  }];
}

function buildIa360MemoryEventPayload({ record, contact, signal }) {
  const profile = getIa360ContactProfile(contact);
  const payload = {
    schema: 'ia360_memory_event.v1',
    source: 'whatsapp',
    contact: {
      forgechat_contact_id: profile.forgechatContactId || '',
      espo_contact_id: profile.espoContactId || '',
      name: profile.name || record?.contact_name || '',
      role: profile.role || '',
    },
    account: {
      name: profile.accountName || '',
      project: profile.projectName || '',
    },
    classification: {
      persona: profile.persona || '',
      lifecycle_stage: profile.lifecycleStage || '',
      area: signal.area,
      signal_type: signal.signalType,
      confidence: signal.confidence,
    },
    learning: {
      summary: signal.summary,
      business_impact: signal.businessImpact,
      missing_data: signal.missingData,
      next_action: signal.nextAction,
      should_be_fact: Boolean(signal.shouldBeFact),
    },
    sync: {
      crm_sync_status: 'dry_run_compact',
      rag_index_status: 'structured_lookup_ready',
      owner_review_status: 'required',
    },
    guardrails: {
      external_send_allowed: false,
      contains_sensitive_data: false,
      store_transcript: false,
    },
  };
  return {
    payload,
    profile,
  };
}

async function persistIa360MemorySignal({ record, contact, signal }) {
  await ensureIa360MemoryTables();
  const { payload, profile } = buildIa360MemoryEventPayload({ record, contact, signal });
  const { rows } = await pool.query(
    `INSERT INTO coexistence.ia360_memory_events (
       schema_version, source, contact_wa_number, contact_number, forgechat_contact_id,
       espo_contact_id, contact_name, contact_role, account_name, project_name,
       persona, lifecycle_stage, area, signal_type, confidence, summary,
       business_impact, missing_data, next_action, should_be_fact,
       crm_sync_status, rag_index_status, owner_review_status, external_send_allowed,
       contains_sensitive_data, store_transcript, source_message_id, payload
     )
     VALUES (
       'ia360_memory_event.v1', 'whatsapp', $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
       'dry_run_compact', 'structured_lookup_ready', 'required', false,
       false, false, $19, $20::jsonb
     )
     ON CONFLICT (source_message_id, area, signal_type) WHERE source_message_id IS NOT NULL
     DO UPDATE SET
       summary=EXCLUDED.summary,
       business_impact=EXCLUDED.business_impact,
       missing_data=EXCLUDED.missing_data,
       next_action=EXCLUDED.next_action,
       payload=EXCLUDED.payload,
       updated_at=NOW()
     RETURNING id`,
    [
      record.wa_number || null,
      record.contact_number || null,
      profile.forgechatContactId,
      profile.espoContactId || null,
      profile.name || record.contact_name || null,
      profile.role || null,
      profile.accountName || null,
      profile.projectName || null,
      profile.persona || null,
      profile.lifecycleStage || null,
      signal.area,
      signal.signalType,
      signal.confidence,
      signal.summary,
      signal.businessImpact,
      signal.missingData,
      signal.nextAction,
      Boolean(signal.shouldBeFact),
      record.message_id || null,
      JSON.stringify(payload),
    ]
  );
  const eventId = rows[0]?.id || null;
  let factId = null;
  if (signal.shouldBeFact) {
    const factKey = [
      record.wa_number || '',
      record.contact_number || '',
      profile.projectName || '',
      signal.area,
      signal.signalType,
    ].join(':').toLowerCase();
    const factPayload = {
      schema: 'ia360_memory_fact.v1',
      persona: profile.persona || '',
      role: profile.role || '',
      preference: isIa360ClienteActivoBetaContact(contact)
        ? 'Responder con hallazgo, impacto, dato faltante y siguiente acción; no pitch ni agenda por default.'
        : '',
      objection: signal.signalType === 'feedback' ? signal.summary : '',
      recurring_pain: signal.summary,
      affected_process: signal.affectedProcess,
      missing_metric: signal.missingMetric,
      source: record.message_id || 'whatsapp',
      confidence: signal.confidence,
    };
    const fact = await pool.query(
      `INSERT INTO coexistence.ia360_memory_facts (
         schema_version, fact_key, source_event_id, source, contact_wa_number,
         contact_number, forgechat_contact_id, espo_contact_id, account_name,
         project_name, persona, role, preference, objection, recurring_pain,
         affected_process, missing_metric, confidence, owner_review_status,
         status, payload
       )
       VALUES (
         'ia360_memory_fact.v1', md5($1), $2, 'whatsapp', $3,
         $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, 'pending_owner_review', 'pending_owner_review', $17::jsonb
       )
       ON CONFLICT (fact_key)
       DO UPDATE SET
         source_event_id=COALESCE(EXCLUDED.source_event_id, coexistence.ia360_memory_facts.source_event_id),
         preference=COALESCE(NULLIF(EXCLUDED.preference, ''), coexistence.ia360_memory_facts.preference),
         objection=COALESCE(NULLIF(EXCLUDED.objection, ''), coexistence.ia360_memory_facts.objection),
         recurring_pain=EXCLUDED.recurring_pain,
         missing_metric=EXCLUDED.missing_metric,
         evidence_count=coexistence.ia360_memory_facts.evidence_count + 1,
         last_seen_at=NOW(),
         updated_at=NOW(),
         payload=EXCLUDED.payload
       RETURNING id`,
      [
        factKey,
        eventId,
        record.wa_number || null,
        record.contact_number || null,
        profile.forgechatContactId,
        profile.espoContactId || null,
        profile.accountName || null,
        profile.projectName || null,
        profile.persona || null,
        profile.role || null,
        factPayload.preference,
        factPayload.objection,
        factPayload.recurring_pain,
        factPayload.affected_process,
        factPayload.missing_metric,
        signal.confidence,
        JSON.stringify(factPayload),
      ]
    );
    factId = fact.rows[0]?.id || null;
  }
  return { eventId, factId, payload };
}

async function persistIa360MemorySignals({ record, contact, signals }) {
  const results = [];
  for (const signal of signals || []) {
    try {
      results.push(await persistIa360MemorySignal({ record, contact, signal }));
    } catch (err) {
      console.error('[ia360-memory] persist error:', err.message);
    }
  }
  return results;
}

async function lookupIa360MemoryContext({ record, contact, limit = 8 }) {
  await ensureIa360MemoryTables();
  // G-RAG (revisión 06-11): la llave de la jaula es SOLO el proyecto declarado
  // (beta.project o custom_fields.project_name). account_name NO es proxy de
  // proyecto: usarlo escondía memoria real de contactos con empresa capturada
  // y sin proyecto activo.
  const cfJaula = contact?.custom_fields || {};
  const jaulaProjectKey = (cfJaula.ia360_cliente_activo_beta || {}).project || cfJaula.project_name || null;
  const params = [
    record?.wa_number || null,
    record?.contact_number || null,
    jaulaProjectKey,
    limit,
  ];
  // G-RAG JAULA por proyecto (decisión B1 de Alek 06-11): prohibida la fuga
  // inter-proyecto. Con proyecto activo declarado, el agente recibe SOLO
  // memoria de ESE proyecto + memoria general de persona (project_name
  // vacío); lo que el mismo contacto tenga en OTRO proyecto queda FUERA.
  // Sin proyecto activo no hay jaula que aplicar: se conserva el
  // comportamiento G-BRAIN (toda la memoria del contacto). La comparación
  // normaliza guiones/guiones bajos/espacios ('Camiones-Selectos' =
  // 'Camiones Selectos'). El expediente del owner NO pasa por aquí: ese es
  // cross-proyecto a propósito.
  const jaulaWhere = `(
        (contact_wa_number=$1 AND contact_number=$2
         AND (COALESCE($3::text,'')=''
              OR COALESCE(project_name,'')=''
              OR regexp_replace(lower(project_name),'[-_ ]','','g') = regexp_replace(lower($3),'[-_ ]','','g')))
        OR ($3::text IS NOT NULL AND $3<>'' AND
            regexp_replace(lower(project_name),'[-_ ]','','g') = regexp_replace(lower($3),'[-_ ]','','g'))
      )`;
  const events = await pool.query(
    `SELECT area, signal_type, summary, business_impact, missing_data, next_action, owner_review_status, created_at
       FROM coexistence.ia360_memory_events
      WHERE ${jaulaWhere}
      ORDER BY created_at DESC
      LIMIT $4`,
    params
  );
  const facts = await pool.query(
    `SELECT persona, role, preference, objection, recurring_pain, affected_process, missing_metric, confidence, status, last_seen_at
       FROM coexistence.ia360_memory_facts
      WHERE ${jaulaWhere}
      ORDER BY last_seen_at DESC
      LIMIT $4`,
    params
  );
  console.log('[ia360-jaula] contacto=%s proyecto=%s facts=%d eventos=%d',
    record?.contact_number || '-', jaulaProjectKey || '-', facts.rows.length, events.rows.length);
  return { events: events.rows, facts: facts.rows };
}

function uniqueIa360Areas(memoryContext, signals = []) {
  const areas = new Map();
  for (const signal of signals) areas.set(signal.area, signal.label || signal.area);
  for (const event of memoryContext?.events || []) areas.set(event.area, event.area);
  for (const fact of memoryContext?.facts || []) {
    if (fact.affected_process) areas.set(fact.affected_process, fact.affected_process);
  }
  return [...areas.values()].slice(0, 5);
}

function buildIa360ClienteActivoBetaReply({ signals, memoryContext }) {
  const primary = signals[0];
  const areas = uniqueIa360Areas(memoryContext, signals);
  if (signals.length > 1 || areas.length >= 3) {
    return [
      'Ya dejé registrados los frentes para Alek.',
      '',
      `Lo que veo: ${areas.join('; ')}.`,
      '',
      'Para aterrizarlo sin dispersarnos, elegiría uno y lo bajaría a: dato actual -> bloqueo -> responsable -> siguiente acción.',
      '',
      '¿Cuál quieres que prioricemos primero?'
    ].join('\n');
  }
  return [
    `Ya lo registré como ${primary.label || primary.area}.`,
    '',
    `Hallazgo: ${primary.summary}`,
    '',
    `Impacto: ${primary.businessImpact}`,
    '',
    `Dato faltante: ${primary.missingData}`,
    '',
    `Siguiente acción: ${primary.nextAction}`,
    '',
    '¿Quieres que prioricemos esto o lo dejo como frente secundario para Alek?'
  ].join('\n');
}

function maskIa360Number(number) {
  const s = String(number || '');
  if (!s) return 'sin número';
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}

function buildIa360OwnerMemoryReadout({ record, signals, persisted }) {
  const lines = [
    'Readout IA360 memoria',
    '',
    `Contacto: ${record.contact_name || 'contacto'} (${maskIa360Number(record.contact_number)})`,
    `Eventos guardados: ${persisted.filter(x => x.eventId).length}`,
    `Facts propuestos: ${persisted.filter(x => x.factId).length}`,
    '',
    'Señales:',
    ...signals.map(s => `- ${s.label || s.area}: ${s.nextAction}`),
    '',
    'Guardrail: no envié pitch, no creé oportunidad y CRM queda en dry-run compacto.'
  ];
  return lines.join('\n');
}

async function handleIa360ClienteActivoBetaLearning({ record, deal, contact, captureOnly = false }) {
  const memoryBefore = await lookupIa360MemoryContext({ record, contact }).catch(err => {
    console.error('[ia360-memory] lookup before reply:', err.message);
    return { events: [], facts: [] };
  });
  const signals = extractIa360MemorySignals({ record, contact, agent: { action: 'cliente_activo_beta_learning' } });
  if (!signals.length) return false;
  const persisted = await persistIa360MemorySignals({ record, contact, signals });
  const memoryAfter = await lookupIa360MemoryContext({ record, contact }).catch(() => memoryBefore);
  await mergeContactIa360State({
    waNumber: record.wa_number,
    contactNumber: record.contact_number,
    tags: ['ia360-memory', 'cliente-activo-beta'],
    customFields: {
      ia360_memory_last_event_at: new Date().toISOString(),
      ia360_memory_last_areas: signals.map(s => s.area),
      ia360_memory_last_lookup_count: (memoryAfter.events || []).length + (memoryAfter.facts || []).length,
      // Deuda G-LIVE cerrada: en captureOnly NO hubo reply — escribir el marcador
      // de "última respuesta" contaminaba el estado informativo del contacto.
      ...(captureOnly ? {} : { ia360_cliente_activo_beta_last_reply_kind: 'memory_learning' }),
    },
  }).catch(e => console.error('[ia360-memory] contact marker:', e.message));
  if (captureOnly) {
    // G-LIVE: la captura de memoria NUNCA es respuesta al cliente. El caller (rama
    // cliente activo/beta de handleIa360FreeText) responde con el agente IA; aquí
    // solo se aprende en segundo plano.
    console.log('[ia360-memory] contact=%s mode=%s events=%d facts=%d stage=%s egress=capture_only',
      maskIa360Number(record.contact_number),
      deal?.memory_mode || 'cliente_activo_beta',
      persisted.filter(x => x.eventId).length,
      persisted.filter(x => x.factId).length,
      deal?.stage_name || '-'
    );
    return false;
  }
  const reply = buildIa360ClienteActivoBetaReply({ signals, memoryContext: memoryAfter });
  const ownerReadout = buildIa360OwnerMemoryReadout({ record, signals, persisted });
  if (!IA360_MEMORY_EGRESS_ON) {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      customFields: {
        ia360_memory_egress: 'dry_run',
        ia360_memory_last_reply_preview: reply,
        ia360_memory_last_owner_readout_preview: ownerReadout,
      },
    }).catch(e => console.error('[ia360-memory] dry-run marker:', e.message));
    console.log('[ia360-memory] contact=%s mode=%s events=%d facts=%d stage=%s egress=dry_run -> fallback_required',
      maskIa360Number(record.contact_number),
      deal?.memory_mode || 'cliente_activo_beta',
      persisted.filter(x => x.eventId).length,
      persisted.filter(x => x.factId).length,
      deal?.stage_name || '-'
    );
    // Important: dry-run memory learning is NOT a customer response. Returning true
    // made the parent handler believe the message was handled, which produced the
    // active-client silence bug. Return false so handleIa360FreeText sends the
    // universal holding fallback + owner alert instead of leaving WhatsApp quiet.
    return false;
  }
  await enqueueIa360Text({ record, label: 'ia360_cliente_activo_beta_memory_reply', body: reply });
  sendIa360DirectText({
    record,
    toNumber: IA360_OWNER_NUMBER,
    label: 'owner_ia360_memory_readout',
    body: ownerReadout,
    targetContact: record.contact_number,
    ownerBudget: true,
  }).catch(e => console.error('[ia360-memory] owner readout:', e.message));
  console.log('[ia360-memory] contact=%s mode=%s events=%d facts=%d stage=%s',
    maskIa360Number(record.contact_number),
    deal?.memory_mode || 'cliente_activo_beta',
    persisted.filter(x => x.eventId).length,
    persisted.filter(x => x.factId).length,
    deal?.stage_name || '-'
  );
  return true;
}

function extractSharedContactsFromRecord(record) {
  if (!record || record.message_type !== 'contacts' || !record.raw_payload) return [];
  try {
    const payload = typeof record.raw_payload === 'string' ? JSON.parse(record.raw_payload) : record.raw_payload;
    const found = new Map();
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
        for (const msg of messages) {
          if (record.message_id && msg?.id && msg.id !== record.message_id) continue;
          const contacts = Array.isArray(msg?.contacts) ? msg.contacts : [];
          for (const c of contacts) {
            const phones = Array.isArray(c?.phones) ? c.phones : [];
            const primaryPhone = phones.find(p => p?.wa_id) || phones.find(p => p?.phone) || {};
            const contactNumber = normalizePhone(primaryPhone.wa_id || primaryPhone.phone || '');
            if (!contactNumber) continue;
            const emails = Array.isArray(c?.emails) ? c.emails : [];
            const name = c?.name?.formatted_name || c?.name?.first_name || c?.name?.last_name || contactNumber;
            found.set(contactNumber, {
              contactNumber,
              name,
              phoneRaw: primaryPhone.phone || null,
              waId: primaryPhone.wa_id || null,
              email: emails[0]?.email || null,
              raw: c,
            });
          }
        }
      }
    }
    return [...found.values()];
  } catch (err) {
    console.error('[ia360-vcard] extract error:', err.message);
    return [];
  }
}

function inferIa360QaPersonaHint(name) {
  const text = String(name || '').toLowerCase();
  if (!text.startsWith('qa personafirst')) return null;
  if (/\baliado\b|\bsocio\b/.test(text)) return 'persona_aliado';
  if (/\bbeta\b|\bamigo\b/.test(text)) return 'persona_beta';
  if (/\breferido\b|\bbni\b/.test(text)) return 'persona_referido';
  if (/\bcliente\b/.test(text)) return 'persona_cliente';
  if (/\bsponsor\b/.test(text)) return 'persona_sponsor';
  if (/\bcomercial\b|\bdirector\b/.test(text)) return 'persona_comercial';
  if (/\bcfo\b|\bfinanzas\b/.test(text)) return 'persona_cfo';
  if (/\btecnico\b|\bt[eé]cnico\b|\bguardian\b|\bguardi[aá]n\b/.test(text)) return 'persona_tecnico';
  if (/\bsolo\b.*\bguardar\b|\bguardar\b/.test(text)) return 'guardar';
  if (/\bno\b.*\bcontactar\b|\bexcluir\b/.test(text)) return 'excluir';
  return null;
}

// G-C: el nombre del introductor viene de push name / vCard (texto controlado por
// el remitente). Se sanitiza antes de persistir: sin caracteres de control ni
// saltos de línea, sin llaves de placeholder, espacios colapsados y tope de 60
// caracteres. Devuelve null si no queda nada usable.
function sanitizeIa360IntroName(raw) {
  const clean = String(raw || '')
    .replace(/[\u0000-\u001F\u007F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Corte por code points (no por unidades UTF-16): un emoji en la frontera de
  // los 60 caracteres no deja un surrogate suelto que rompa el jsonb al persistir.
  const capped = Array.from(clean).slice(0, 60).join('').trim();
  if (!capped) return null;
  if (!/[\p{L}]/u.test(capped)) return null; // sin letras (solo dígitos/símbolos) no sirve como nombre
  return capped;
}

async function upsertIa360SharedContact({ record, shared }) {
  if (!record?.wa_number || !shared?.contactNumber) return null;
  const qaPersonaExpectedChoice = inferIa360QaPersonaHint(shared.name);
  // quien_intro (D6): si el vCard lo comparte un CONTACTO (no el owner), esa
  // persona es quien hizo la introducción. Se guarda el NOMBRE para que el
  // opener referido_contexto pueda decir "nos presentó X". Si lo manda el owner,
  // el dato queda pendiente (el placeholder {{quien_intro}} bloquea el copy).
  // G-C: sanitizado (push name inyectable), sin auto-introducción (vCard propio)
  // y sin pisar un quien_intro ya capturado.
  let quienIntro = null;
  const sharerIsSelf = normalizePhone(record.contact_number || '') === normalizePhone(shared.contactNumber || '');
  if (record.contact_number && !sharerIsSelf && normalizePhone(record.contact_number) !== IA360_OWNER_NUMBER) {
    try {
      const { rows: introRows } = await pool.query(
        `SELECT name, profile_name FROM coexistence.contacts WHERE wa_number=$1 AND contact_number=$2 LIMIT 1`,
        [record.wa_number, normalizePhone(record.contact_number)]
      );
      quienIntro = sanitizeIa360IntroName(introRows[0]?.name || introRows[0]?.profile_name || record.contact_name || '');
      if (quienIntro) {
        const { rows: existingRows } = await pool.query(
          `SELECT custom_fields->>'quien_intro' AS quien_intro FROM coexistence.contacts WHERE wa_number=$1 AND contact_number=$2 LIMIT 1`,
          [record.wa_number, normalizePhone(shared.contactNumber)]
        );
        if (String(existingRows[0]?.quien_intro || '').trim()) quienIntro = null; // ya hay introductor registrado: no pisar
      }
    } catch (e) {
      console.error('[ia360-vcard] quien_intro lookup:', e.message);
      quienIntro = null;
    }
  }
  const customFields = {
    ...(quienIntro ? { quien_intro: quienIntro } : {}),
    staged: true,
    stage: 'Capturado / Por rutear',
    captured_at: new Date().toISOString(),
    intake_source: 'b29-vcard-whatsapp',
    source_message_id: record.message_id || null,
    referido_por: record.contact_number || null,
    captured_by: normalizePhone(record.contact_number) === IA360_OWNER_NUMBER ? 'owner-whatsapp' : 'whatsapp-contact',
    pipeline_sugerido: null,
    vcard_phone_raw: shared.phoneRaw || null,
    vcard_wa_id: shared.waId || null,
    email: shared.email || null,
    ...(qaPersonaExpectedChoice ? { qa_persona_expected_choice: qaPersonaExpectedChoice } : {}),
  };
  const tags = ['ia360-vcard', 'owner-intake', 'staged'];
  const { rows } = await pool.query(
    `INSERT INTO coexistence.contacts (wa_number, contact_number, name, profile_name, tags, custom_fields, updated_at)
     VALUES ($1, $2, $3, $3, $4::jsonb, $5::jsonb, NOW())
     ON CONFLICT (wa_number, contact_number) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, coexistence.contacts.name),
       profile_name = COALESCE(EXCLUDED.profile_name, coexistence.contacts.profile_name),
       tags = (
         SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
         FROM jsonb_array_elements_text(
           COALESCE(coexistence.contacts.tags, '[]'::jsonb) || EXCLUDED.tags
         ) AS value
       ),
       custom_fields = COALESCE(coexistence.contacts.custom_fields, '{}'::jsonb) || EXCLUDED.custom_fields,
       updated_at = NOW()
     RETURNING id, wa_number, contact_number, name, profile_name, tags, custom_fields`,
    [record.wa_number, shared.contactNumber, shared.name || shared.contactNumber, JSON.stringify(tags), JSON.stringify(customFields)]
  );
  return rows[0] || null;
}

function isIa360OwnerNumber(phone) {
  return normalizePhone(phone) === IA360_OWNER_NUMBER;
}

async function recordBlockedOwnerNumberVcard({ record, shared }) {
  const blockedAt = new Date().toISOString();
  console.warn('[ia360-vcard] blocked owner-number vCard source=%s message=%s', record?.contact_number || '-', record?.message_id || '-');
  await mergeContactIa360State({
    waNumber: record.wa_number,
    contactNumber: IA360_OWNER_NUMBER,
    customFields: {
      ia360_owner_number_vcard_blocked_at: blockedAt,
      ia360_owner_number_vcard_blocked_source_message_id: record.message_id || '',
      ia360_owner_number_vcard_blocked_name: shared?.name || '',
      ia360_owner_number_vcard_blocked_reason: 'shared_contact_phone_matches_owner',
    },
  }).catch(e => console.error('[ia360-vcard] owner-number block persist:', e.message));
}

// G8: `pipelineName` enruta el deal. Default = Revenue genérico (no rompe lo
// existente). Los callsites del journey de aliado/referido BNI pasan
// IA360_PARTNERS_PIPELINE_NAME ('Partners / Aliados (BNI)', id 6) — derivado de
// flow.relationshipContext vía ia360PipelineForRelationship.
async function syncIa360Deal({ record, targetStageName, titleSuffix = '', notes = '', pipelineName = IA360_DEFAULT_PIPELINE_NAME }) {
  if (!record || !record.wa_number || !record.contact_number || !targetStageName) return null;
  const { rows: pipeRows } = await pool.query(
    `SELECT id FROM coexistence.pipelines WHERE name = $1 LIMIT 1`,
    [pipelineName]
  );
  const pipelineId = pipeRows[0]?.id;
  if (!pipelineId) return null;

  // targetStageName usa la semántica del Revenue pipeline (compartida por los
  // handlers persona-first). El pipeline Partners no tiene esos nombres, así que
  // se traduce al stage REAL del pipeline 6 (ia360ResolveStageName). El nombre
  // LÓGICO original se conserva en requestedStageName para no romper disparadores
  // semánticos — p. ej. el handoff n8n de "Requiere Alek", que NO es un stage del
  // pipeline Partners pero sí un evento que debe seguir disparándose.
  const requestedStageName = targetStageName;
  const resolvedStageName = ia360ResolveStageName(pipelineName, requestedStageName);

  const { rows: stageRows } = await pool.query(
    `SELECT id, name, position, stage_type
       FROM coexistence.pipeline_stages
      WHERE pipeline_id = $1 AND name = $2
      LIMIT 1`,
    [pipelineId, resolvedStageName]
  );
  const targetStage = stageRows[0];
  if (!targetStage) return null;

  const { rows: userRows } = await pool.query(
    `SELECT id FROM coexistence.forgecrm_users WHERE role='admin' ORDER BY id LIMIT 1`
  );
  const createdBy = userRows[0]?.id || null;

  const { rows: contactRows } = await pool.query(
    `SELECT COALESCE(name, profile_name, $3) AS name
       FROM coexistence.contacts
      WHERE wa_number=$1 AND contact_number=$2
      LIMIT 1`,
    [record.wa_number, record.contact_number, record.contact_number]
  );
  const contactName = contactRows[0]?.name || record.contact_number;
  const title = `IA360 · ${contactName}${titleSuffix ? ' · ' + titleSuffix : ''}`;
  const nextNote = `[${new Date().toISOString()}] ${notes || `Stage → ${targetStageName}; input=${record.message_body || ''}`}`;

  const { rows: existingRows } = await pool.query(
    `SELECT d.*, s.position AS current_stage_position, s.name AS current_stage_name
       FROM coexistence.deals d
       JOIN coexistence.pipeline_stages s ON s.id=d.stage_id
      WHERE d.pipeline_id=$1 AND d.contact_wa_number=$2 AND d.contact_number=$3
      ORDER BY d.updated_at DESC NULLS LAST, d.id DESC
      LIMIT 1`,
    [pipelineId, record.wa_number, record.contact_number]
  );

  if (existingRows.length === 0) {
    const { rows: posRows } = await pool.query(
      `SELECT COALESCE(MAX(position),-1)+1 AS pos FROM coexistence.deals WHERE stage_id=$1`,
      [targetStage.id]
    );
    const status = targetStage.stage_type === 'won' ? 'won' : targetStage.stage_type === 'lost' ? 'lost' : 'open';
    const { rows } = await pool.query(
      `INSERT INTO coexistence.deals
         (pipeline_id, stage_id, title, value, currency, status, assigned_user_id,
          contact_wa_number, contact_number, contact_name, notes, position, created_by,
          won_at, lost_at)
       VALUES ($1,$2,$3,0,'MXN',$4,$5,$6,$7,$8,$9,$10,$11,
               ${status === 'won' ? 'NOW()' : 'NULL'}, ${status === 'lost' ? 'NOW()' : 'NULL'})
       RETURNING id`,
      [pipelineId, targetStage.id, title, status, createdBy, record.wa_number, record.contact_number, contactName, nextNote, posRows[0].pos, createdBy]
    );
    // G-G: hot lead created directly at "Requiere Alek" → handoff to EspoCRM (priority high so a human Task is created).
    // G8: se evalúa sobre el nombre LÓGICO solicitado (no el stage resuelto), para
    // que el handoff siga disparando aunque el pipeline Partners lo mapee a otro stage.
    if (requestedStageName === 'Requiere Alek') {
      emitIa360N8nHandoff({
        record,
        eventType: 'requires_alek',
        targetStage: 'Requiere Alek',
        priority: 'high',
        summary: `Lead caliente: pidió/marcó prioridad alta (entró a "Requiere Alek") sin reunión agendada aún. Crear tarea humana y preparar contacto. Última respuesta: ${record.message_body || ''}.`,
      }).catch(e => console.error('[ia360-n8n] requires_alek handoff (new):', e.message));
    }
    return rows[0];
  }

  const existing = existingRows[0];
  const forceMoveStages = ['Agenda en proceso', 'Reunión agendada', 'Requiere Alek', 'Ganado', 'Perdido / no fit', 'Nutrición'];
  const shouldMove = forceMoveStages.includes(targetStage.name) || Number(targetStage.position) >= Number(existing.current_stage_position);
  const finalStageId = shouldMove ? targetStage.id : existing.stage_id;
  const finalStatus = targetStage.stage_type === 'won' ? 'won' : targetStage.stage_type === 'lost' ? 'lost' : 'open';
  const finalNotes = `${existing.notes || ''}${existing.notes ? '\n' : ''}${nextNote}`;
  await pool.query(
    `UPDATE coexistence.deals
        SET stage_id = $1,
            status = $2,
            title = $3,
            contact_name = $4,
            notes = $5,
            updated_at = NOW(),
            won_at = CASE WHEN $2='won' THEN COALESCE(won_at, NOW()) ELSE NULL END,
            lost_at = CASE WHEN $2='lost' THEN COALESCE(lost_at, NOW()) ELSE NULL END
      WHERE id = $6`,
    [finalStageId, shouldMove ? finalStatus : existing.status, title, contactName, finalNotes, existing.id]
  );
  // G-G: deal just ENTERED "Requiere Alek" (was at a different stage) → handoff to EspoCRM, priority high (creates human Task).
  // Transition-detection = idempotent (only fires when crossing into the stage, not on every re-touch while already there).
  // No-dup-with-booking: the n8n handoff upserts Contact/Opportunity/Task by name, so a later meeting_confirmed updates the SAME records.
  if (shouldMove && requestedStageName === 'Requiere Alek' && existing.current_stage_name !== targetStage.name) {
    emitIa360N8nHandoff({
      record,
      eventType: 'requires_alek',
      targetStage: 'Requiere Alek',
      priority: 'high',
      summary: `Lead caliente: entró a "Requiere Alek" (desde "${existing.current_stage_name}") sin reunión agendada aún. Crear tarea humana y preparar contacto. Última respuesta: ${record.message_body || ''}.`,
    }).catch(e => console.error('[ia360-n8n] requires_alek handoff (move):', e.message));
  }
  return { id: existing.id, moved: shouldMove };
}

// ============================================================================
// Pipeline 5 — "WhatsApp Revenue OS": flujo de apertura por dolor (3 pasos).
// Diseño fuente: "Plan diversificacion pipelines WA … Revenue OS" §2.
//   PASO 1 (template ia360_os_revenue_apertura, fuera de ventana 24h) → quick
//          replies [Sí, cuéntame] / [Ahora no].
//   PASO 2 (texto libre dentro de ventana) → 1 pregunta de diagnóstico; captura
//          señal en custom_fields (ia360_revenue_canal/dolor/volumen).
//   PASO 3 (texto libre) → propuesta + bifurcación [Ver cómo se vería] /
//          [Hablar con Alek].
// Estado en custom_fields.ia360_revenue_state: apertura_sent → calificacion →
//   propuesta → demo|handoff|nutricion. Gatea cada paso para no secuestrar el
//   flujo genérico (agente IA / agenda). GUARDRAIL: NO empuja agenda en pasos
//   1-2; la agenda es destino del paso 3 SOLO si el contacto lo pide.
// ============================================================================
const REVENUE_OS_PIPELINE_NAME = 'WhatsApp Revenue OS';
const REVENUE_OS_APERTURA_TEMPLATE_ID = 42; // ia360_os_revenue_apertura (APPROVED, es_MX, {{1}}=nombre)

const REVENUE_OS_COPY = {
  paso2: 'Va. Para no suponer: hoy, cuando entra un prospecto por WhatsApp, ¿cómo le siguen el rastro? (ej. lo anotan aparte, se confían a la memoria, un Excel, o de plano se les pierde alguno). Cuéntame en una línea cómo es hoy.',
  paso3: 'Eso es justo lo que se nos escapa dinero sin darnos cuenta. Lo que hacemos en TransformIA es montar tu "Revenue OS" sobre el mismo WhatsApp: cada lead entra, se etiqueta solo, sube por etapas (de "nuevo" a "ganado") y tú ves el pipeline completo sin perseguir a nadie. ¿Cómo le seguimos?',
  ahoraNo: 'Va, sin problema. Te dejo el espacio y no te lleno el WhatsApp. Si más adelante quieres ordenar tus ventas por aquí, me escribes y lo retomamos. Saludos.',
  demo: 'Va, te lo aterrizo. Tu "Revenue OS" se vería así por aquí: (1) cada prospecto que escribe queda registrado y etiquetado solo; (2) avanza por etapas — nuevo, en conversación, propuesta, ganado — sin que tú lo muevas a mano; (3) ves el pipeline completo y quién se está enfriando, todo dentro de WhatsApp. Te preparo un readout con tu caso y, si quieres, lo vemos en vivo con Alek.',
};

// Movimiento de deal dedicado a Pipeline 5 (NO toca syncIa360Deal, que es del
// pipeline de agenda vivo). Create-or-move: si no hay deal, lo crea en el stage
// destino; si existe, avanza por posición (igual criterio que syncIa360Deal).
async function syncRevenueOsDeal({ record, targetStageName, titleSuffix = '', notes = '' }) {
  if (!record || !record.wa_number || !record.contact_number || !targetStageName) return null;
  const { rows: pipeRows } = await pool.query(
    `SELECT id FROM coexistence.pipelines WHERE name = $1 LIMIT 1`,
    [REVENUE_OS_PIPELINE_NAME]
  );
  const pipelineId = pipeRows[0]?.id;
  if (!pipelineId) return null;

  const { rows: stageRows } = await pool.query(
    `SELECT id, name, position, stage_type
       FROM coexistence.pipeline_stages
      WHERE pipeline_id = $1 AND name = $2
      LIMIT 1`,
    [pipelineId, targetStageName]
  );
  const targetStage = stageRows[0];
  if (!targetStage) return null;

  const { rows: userRows } = await pool.query(
    `SELECT id FROM coexistence.forgecrm_users WHERE role='admin' ORDER BY id LIMIT 1`
  );
  const createdBy = userRows[0]?.id || null;

  const { rows: contactRows } = await pool.query(
    `SELECT COALESCE(name, profile_name, $3) AS name
       FROM coexistence.contacts
      WHERE wa_number=$1 AND contact_number=$2
      LIMIT 1`,
    [record.wa_number, record.contact_number, record.contact_number]
  );
  const contactName = contactRows[0]?.name || record.contact_number;
  const title = `Revenue OS · ${contactName}${titleSuffix ? ' · ' + titleSuffix : ''}`;
  const nextNote = `[${new Date().toISOString()}] ${notes || `Stage → ${targetStageName}; input=${record.message_body || ''}`}`;

  const { rows: existingRows } = await pool.query(
    `SELECT d.*, s.position AS current_stage_position, s.name AS current_stage_name
       FROM coexistence.deals d
       JOIN coexistence.pipeline_stages s ON s.id=d.stage_id
      WHERE d.pipeline_id=$1 AND d.contact_wa_number=$2 AND d.contact_number=$3
      ORDER BY d.updated_at DESC NULLS LAST, d.id DESC
      LIMIT 1`,
    [pipelineId, record.wa_number, record.contact_number]
  );

  if (existingRows.length === 0) {
    const { rows: posRows } = await pool.query(
      `SELECT COALESCE(MAX(position),-1)+1 AS pos FROM coexistence.deals WHERE stage_id=$1`,
      [targetStage.id]
    );
    const status = targetStage.stage_type === 'won' ? 'won' : targetStage.stage_type === 'lost' ? 'lost' : 'open';
    const { rows } = await pool.query(
      `INSERT INTO coexistence.deals
         (pipeline_id, stage_id, title, value, currency, status, assigned_user_id,
          contact_wa_number, contact_number, contact_name, notes, position, created_by,
          won_at, lost_at)
       VALUES ($1,$2,$3,0,'MXN',$4,$5,$6,$7,$8,$9,$10,$11,
               ${status === 'won' ? 'NOW()' : 'NULL'}, ${status === 'lost' ? 'NOW()' : 'NULL'})
       RETURNING id`,
      [pipelineId, targetStage.id, title, status, createdBy, record.wa_number, record.contact_number, contactName, nextNote, posRows[0].pos, createdBy]
    );
    return { id: rows[0].id, created: true, stage: targetStage.name };
  }

  const existing = existingRows[0];
  const shouldMove = Number(targetStage.position) >= Number(existing.current_stage_position);
  const finalStageId = shouldMove ? targetStage.id : existing.stage_id;
  const finalStatus = targetStage.stage_type === 'won' ? 'won' : targetStage.stage_type === 'lost' ? 'lost' : 'open';
  const finalNotes = `${existing.notes || ''}${existing.notes ? '\n' : ''}${nextNote}`;
  await pool.query(
    `UPDATE coexistence.deals
        SET stage_id = $1,
            status = $2,
            title = $3,
            contact_name = $4,
            notes = $5,
            updated_at = NOW(),
            won_at = CASE WHEN $2='won' THEN COALESCE(won_at, NOW()) ELSE NULL END,
            lost_at = CASE WHEN $2='lost' THEN COALESCE(lost_at, NOW()) ELSE NULL END
      WHERE id = $6`,
    [finalStageId, shouldMove ? finalStatus : existing.status, title, contactName, finalNotes, existing.id]
  );
  return { id: existing.id, moved: shouldMove, stage: shouldMove ? targetStage.name : existing.current_stage_name };
}

// PASO 1 — dispara la apertura: siembra deal P5 en "Leads desorganizados", marca
// el estado y envía el template aprobado (con sus 2 quick replies). Egress por el
// chokepoint único (enqueueIa360Template → sendQueue). El record es sintético
// (apertura = outbound-first, no hay inbound): message_id único para el dedup.
async function startRevenueOsOpener({ waNumber, contactNumber, name = '' }) {
  const wa = normalizePhone(waNumber);
  const cn = normalizePhone(contactNumber);
  if (!wa || !cn) return { ok: false, error: 'wa_number_and_contact_number_required' };

  // Upsert contacto + estado (mergeContactIa360State no setea name; lo hacemos aparte
  // solo si vino un nombre y el contacto aún no tiene uno).
  await mergeContactIa360State({
    waNumber: wa,
    contactNumber: cn,
    tags: ['pipeline:revenue-os', 'staged'],
    customFields: { ia360_revenue_state: 'apertura_sent', ia360_revenue_started_at: new Date().toISOString() },
  });
  if (name) {
    await pool.query(
      `UPDATE coexistence.contacts SET name = COALESCE(name, $3), updated_at = NOW()
        WHERE wa_number=$1 AND contact_number=$2`,
      [wa, cn, name]
    ).catch(e => console.error('[revenue-os] set name:', e.message));
  }

  const record = {
    wa_number: wa,
    contact_number: cn,
    contact_name: name || cn,
    message_id: `revenue_opener:${cn}:${Date.now()}`,
    message_type: 'revenue_opener',
    message_body: '',
  };

  await syncRevenueOsDeal({
    record,
    targetStageName: 'Leads desorganizados',
    titleSuffix: 'Apertura',
    notes: 'PASO 1: apertura Revenue OS enviada (template ia360_os_revenue_apertura).',
  }).catch(e => console.error('[revenue-os] seed deal:', e.message));

  const sent = await enqueueIa360Template({
    record,
    label: 'ia360_os_revenue_apertura',
    templateName: 'ia360_os_revenue_apertura',
    templateId: REVENUE_OS_APERTURA_TEMPLATE_ID,
  });
  return { ok: !!sent.ok, status: sent.status, error: sent.error || null, handlerFor: `${record.message_id}:ia360_os_revenue_apertura` };
}

// Heurística ligera para extraer señal del texto de calificación (PASO 2). Se
// guarda el texto crudo siempre; canal/volumen solo si el contacto los dejó ver.
function extractRevenueSignal(text) {
  const t = String(text || '').toLowerCase();
  let canal = null;
  if (/excel|hoja|spreadsheet|sheet/.test(t)) canal = 'excel';
  else if (/crm|pipedrive|hubspot|salesforce|espocrm|zoho/.test(t)) canal = 'crm';
  else if (/memoria|cabeza|me acuerdo|de memoria/.test(t)) canal = 'memoria';
  else if (/anot|libreta|cuaderno|papel|post.?it|nota/.test(t)) canal = 'notas';
  else if (/whats|wa\b|chat/.test(t)) canal = 'whatsapp';
  const volMatch = t.match(/(\d{1,5})\s*(leads?|prospect|client|mensaj|chats?|al d[ií]a|por d[ií]a|a la semana|mensual|al mes)/);
  const volumen = volMatch ? volMatch[0] : null;
  return { canal, volumen };
}

// PASO 1 (respuesta) + PASO 3 (bifurcación) — botones. Gateado por estado para no
// secuestrar quick-replies genéricos. Devuelve true si lo manejó (corta el embudo).
async function handleRevenueOsButton({ record, replyId }) {
  if (!record || !replyId) return false;
  const id = String(replyId || '').trim().toLowerCase();
  const isOpenerYes = id === 'sí, cuéntame' || id === 'si, cuéntame' || id === 'sí, cuentame' || id === 'si, cuentame';
  const isOpenerNo = id === 'ahora no';
  const isDemo = id === 'revenue_ver_demo';
  const isHandoff = id === 'revenue_hablar_alek';
  if (!isOpenerYes && !isOpenerNo && !isDemo && !isHandoff) return false;

  const contact = await loadIa360ContactContext(record).catch(() => null);
  const state = contact?.custom_fields?.ia360_revenue_state || '';

  // PASO 1 — respuesta a la apertura (solo si seguimos en apertura_sent).
  if (isOpenerYes || isOpenerNo) {
    if (state !== 'apertura_sent') return false; // no es de este flujo / ya avanzó
    if (isOpenerNo) {
      await mergeContactIa360State({
        waNumber: record.wa_number,
        contactNumber: record.contact_number,
        tags: ['nutricion-suave'],
        customFields: { ia360_revenue_state: 'nutricion', ultimo_cta_enviado: 'ia360_os_revenue_ahora_no' },
      });
      await enqueueIa360Text({ record, label: 'ia360_os_revenue_ahora_no', body: REVENUE_OS_COPY.ahoraNo });
      return true;
    }
    // "Sí, cuéntame" → abre ventana 24h → PASO 2 (pregunta de calificación, texto libre).
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['revenue-os-interesado'],
      customFields: { ia360_revenue_state: 'calificacion', ultimo_cta_enviado: 'ia360_os_revenue_paso2' },
    });
    await enqueueIa360Text({ record, label: 'ia360_os_revenue_paso2', body: REVENUE_OS_COPY.paso2 });
    return true;
  }

  // PASO 3 — bifurcación (solo si ya enviamos la propuesta).
  if (isDemo || isHandoff) {
    if (state !== 'propuesta') return false;
    if (isDemo) {
      await enqueueIa360Text({ record, label: 'ia360_os_revenue_demo', body: REVENUE_OS_COPY.demo });
      await syncRevenueOsDeal({
        record,
        targetStageName: 'Diseño propuesto',
        titleSuffix: 'Diseño propuesto',
        notes: 'PASO 3: "Ver cómo se vería" → readout/mini-demo; deal a Diseño propuesto.',
      }).catch(e => console.error('[revenue-os] move to Diseño propuesto:', e.message));
      await mergeContactIa360State({
        waNumber: record.wa_number,
        contactNumber: record.contact_number,
        tags: ['revenue-os-diseno-propuesto'],
        customFields: { ia360_revenue_state: 'demo', ultimo_cta_enviado: 'ia360_os_revenue_demo' },
      });
      return true;
    }
    // "Hablar con Alek" → handoff al flujo de agenda EXISTENTE respetando la compuerta
    // de confirmación: NO empujar offer_slots; preguntamos primero (gate_slots_yes/no),
    // que ya maneja el router más abajo y consulta disponibilidad REAL.
    await enqueueIa360Interactive({
      record,
      label: 'ia360_os_revenue_gate_agenda',
      messageBody: 'IA360: confirmar horarios',
      interactive: {
        type: 'button',
        body: { text: 'Perfecto, te paso con Alek. ¿Quieres que te comparta horarios para una llamada con él?' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'gate_slots_yes', title: 'Sí, ver horarios' } },
            { type: 'reply', reply: { id: 'gate_slots_no', title: 'Todavía no' } },
          ],
        },
      },
    });
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['revenue-os-handoff-agenda'],
      customFields: { ia360_revenue_state: 'handoff', ultimo_cta_enviado: 'ia360_os_revenue_handoff' },
    });
    return true;
  }
  return false;
}

// PASO 2 — captura de calificación (texto libre dentro de ventana). Va ANTES del
// agente genérico en el dispatch y devuelve true para CORTAR el embudo (evita que
// el agente responda el mismo texto y empuje agenda → guardrail). Solo actúa si el
// contacto está en estado 'calificacion'.
async function handleRevenueOsFreeText(record) {
  try {
    if (!record || record.direction !== 'incoming' || record.message_type !== 'text') return false;
    const body = String(record.message_body || '').trim();
    if (!body) return false;
    const contact = await loadIa360ContactContext(record).catch(() => null);
    if (!contact || contact.custom_fields?.ia360_revenue_state !== 'calificacion') return false;

    const { canal, volumen } = extractRevenueSignal(body);
    const cf = {
      ia360_revenue_state: 'propuesta',
      ia360_revenue_dolor: body,
      ia360_revenue_calificacion_raw: body,
      ultimo_cta_enviado: 'ia360_os_revenue_paso3',
    };
    if (canal) cf.ia360_revenue_canal = canal;
    if (volumen) cf.ia360_revenue_volumen = volumen;
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['revenue-os-calificado'],
      customFields: cf,
    });

    // PASO 3 — propuesta + bifurcación (quick replies). Titles ≤ 20 chars.
    await enqueueIa360Interactive({
      record,
      label: 'ia360_os_revenue_paso3',
      messageBody: 'IA360: propuesta Revenue OS',
      interactive: {
        type: 'button',
        body: { text: REVENUE_OS_COPY.paso3 },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'revenue_ver_demo', title: 'Ver cómo se vería' } },
            { type: 'reply', reply: { id: 'revenue_hablar_alek', title: 'Hablar con Alek' } },
          ],
        },
      },
    });
    return true;
  } catch (err) {
    console.error('[revenue-os] free-text handler error (no route):', err.message);
    return false;
  }
}

// ============================================================================
// G-WIN — Quick-win "Mapa de cartera" (Pipeline 7 "Champions — Adopción y
// expansión", persona cliente activo / CFO). Patrón Revenue OS P5: máquina de
// estados en contacts.custom_fields.ia360_cartera_state ('' → esperando_tabla
// → mapa_entregado), handlers gateados que CORTAN el embudo, egress único vía
// enqueueIa360Text / sendIa360DirectText → sendQueue.
//   PASO 1 (texto cartera/saldos que no cuadran) → Hallazgo / Impacto / Dato
//          faltante (pide la tabla EN TEXTO; el bot no lee imágenes) /
//          Siguiente acción. SIN pitch y SIN agenda.
//   PASO 2 (tabla pegada en texto) → mapa estructurado al contacto + nota
//          completa en su deal P7 + cola ia360_docs_sync + readout al owner +
//          deal a "Quick win entregado" (solo hacia adelante).
// GUARDRAIL: nunca agenda automática, no nutrición, no insistencia; si el
// mensaje no es de cartera, el flujo NO se activa y el agente genérico sigue.
// ============================================================================
const CHAMPIONS_PIPELINE_NAME = 'Champions — Adopción y expansión';
const CARTERA_STAGE_VALIDACION = 'Validación en curso';
const CARTERA_STAGE_QUICKWIN = 'Quick win entregado';
const CARTERA_FORMATO_TABLA = 'Cliente | Saldo en portal | Saldo correcto | Fecha de corte | Responsable';

const IA360_CARTERA_COPY = {
  paso1: [
    'Gracias por el aviso. Lo dejo ordenado:',
    '',
    '*Hallazgo:* los saldos que muestra el portal no cuadran con los saldos reales de cartera; hoy la corrección depende de revisiones manuales y la diferencia no se ve en un solo lugar.',
    '',
    '*Impacto:* mientras el portal muestre saldos incorrectos, cobranza trabaja con cifras que el cliente puede rebatir y el seguimiento pierde confiabilidad.',
    '',
    '*Dato faltante:* mándame la tabla aquí mismo, en texto, una línea por cuenta con este formato:',
    CARTERA_FORMATO_TABLA,
    'Importante: no puedo leer imágenes ni archivos adjuntos; si la tienes en foto o en Excel, pégamela como texto.',
    '',
    '*Siguiente acción:* en cuanto la reciba, la convierto en tu mapa de cartera (cuenta → saldo portal → saldo correcto → fecha de corte → responsable → siguiente acción) y lo dejo registrado para Alek.',
  ].join('\n'),
  pideTexto: [
    'Recibí tu archivo, pero no puedo leer imágenes ni documentos adjuntos.',
    '¿Me pegas la tabla aquí mismo en texto? Una línea por cuenta:',
    CARTERA_FORMATO_TABLA,
  ].join('\n'),
  recordatorioFormato: [
    'Va, sigo pendiente de la tabla para armar el mapa. Pégala aquí en texto, una línea por cuenta:',
    CARTERA_FORMATO_TABLA,
  ].join('\n'),
};

// Persona cliente activo / CFO: reúsa el helper beta (Andrés) y el perfil
// persona-first (QA y contactos nuevos). El owner JAMÁS entra a este flujo.
function ia360IsClienteActivoCartera(contact) {
  if (!contact) return false;
  if (isIa360ClienteActivoBetaContact(contact)) return true;
  const cf = contact.custom_fields || {};
  const rel = cf?.ia360_persona_first?.classification?.relationship_context || '';
  const personaCtx = String(cf.persona_context || '').toLowerCase();
  const tags = Array.isArray(contact.tags) ? contact.tags.map(t => String(t || '').toLowerCase()) : [];
  return rel === 'cliente_activo'
    || personaCtx === 'cliente activo'
    || tags.includes('persona:cliente_activo');
}

// Disparador del PASO 1: cartera/cobranza explícita, o "saldos" acompañado de
// señal de descuadre. Mantenerlo angosto: un tema no-cartera NO debe activar
// el flujo (gate del goal).
const IA360_CARTERA_TRIGGER_RE = /\b(cartera|cobranza|cuentas?\s+por\s+cobrar)\b/i;
const IA360_CARTERA_SALDOS_RE = /\bsaldos?\b/i;
const IA360_CARTERA_DESCUADRE_RE = /no\s+cuadra|descuadr|incorrect|equivocad|diferenc|portal|\bmal\b/i;

function ia360EsMensajeCartera(body) {
  const t = String(body || '');
  return IA360_CARTERA_TRIGGER_RE.test(t)
    || (IA360_CARTERA_SALDOS_RE.test(t) && IA360_CARTERA_DESCUADRE_RE.test(t));
}

// Parser de la tabla pegada en texto. Separadores: | ; tab. Coma solo si la
// línea no trae montos con coma de millares ("1,250,000"). Salta encabezados.
function parseCarteraTabla(text) {
  const rows = [];
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    let parts = null;
    if (/[|;\t]/.test(line)) parts = line.split(/[|;\t]/);
    else if (line.includes(',') && !/\d,\d{3}/.test(line)) parts = line.split(',');
    if (!parts) continue;
    parts = parts.map(p => p.trim()).filter(p => p !== '');
    if (parts.length < 4) continue;
    const low = line.toLowerCase();
    if (/cliente|cuenta/.test(low) && /saldo/.test(low)) continue; // encabezado
    rows.push({
      cuenta: parts[0],
      saldo_portal: parts[1],
      saldo_correcto: parts[2],
      fecha_corte: parts[3],
      responsable: parts[4] || 'por confirmar',
    });
  }
  return rows;
}

function carteraMonto(s) {
  const limpio = String(s || '').replace(/[^0-9.\-]/g, '');
  if (!limpio || limpio === '-' || limpio === '.') return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

function carteraFormatoMonto(n) {
  if (n === null || !Number.isFinite(n)) return null;
  const negativo = n < 0;
  const [ent, dec] = Math.abs(n).toFixed(2).split('.');
  return `${negativo ? '-' : ''}$${ent.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

// Mapa estructurado: cuenta → saldo portal → saldo correcto → diferencia →
// fecha de corte → responsable → siguiente acción.
function buildCarteraMapa(rows) {
  const bloques = [];
  let diferenciaTotal = 0;
  let cuentasConDescuadre = 0;
  rows.forEach((r, i) => {
    const portal = carteraMonto(r.saldo_portal);
    const correcto = carteraMonto(r.saldo_correcto);
    const dif = portal !== null && correcto !== null ? correcto - portal : null;
    if (dif !== null) {
      diferenciaTotal += dif;
      if (dif !== 0) cuentasConDescuadre += 1;
    }
    bloques.push([
      `${i + 1}) Cuenta: ${r.cuenta}`,
      `   - Saldo en portal: ${carteraFormatoMonto(portal) || r.saldo_portal}`,
      `   - Saldo correcto: ${carteraFormatoMonto(correcto) || r.saldo_correcto}`,
      `   - Diferencia: ${dif !== null ? carteraFormatoMonto(dif) : 'por calcular'}`,
      `   - Fecha de corte: ${r.fecha_corte}`,
      `   - Responsable: ${r.responsable}`,
      `   - Siguiente acción: corregir el saldo en el portal y confirmarlo con ${r.responsable} antes del próximo corte.`,
    ].join('\n'));
  });
  const texto = [
    '*Mapa de cartera — saldos por corregir*',
    '',
    bloques.join('\n\n'),
    '',
    `Cuentas con descuadre: ${cuentasConDescuadre} de ${rows.length} · Diferencia acumulada: ${carteraFormatoMonto(diferenciaTotal) || 'por calcular'}`,
    '',
    'Ya quedó registrado para Alek con el detalle completo. Cuando el portal refleje los saldos correctos, este mapa sirve para confirmarlo cuenta por cuenta.',
  ].join('\n');
  return { texto, diferenciaTotal, cuentasConDescuadre };
}

// Movimiento de deal dedicado a Pipeline 7 (clon del patrón syncRevenueOsDeal:
// create-or-move, solo hacia adelante por posición; NO toca otros pipelines).
async function syncCarteraChampionsDeal({ record, targetStageName, notes = '' }) {
  if (!record || !record.wa_number || !record.contact_number || !targetStageName) return null;
  const { rows: pipeRows } = await pool.query(
    `SELECT id FROM coexistence.pipelines WHERE name = $1 LIMIT 1`,
    [CHAMPIONS_PIPELINE_NAME]
  );
  const pipelineId = pipeRows[0]?.id;
  if (!pipelineId) return null;

  const { rows: stageRows } = await pool.query(
    `SELECT id, name, position, stage_type
       FROM coexistence.pipeline_stages
      WHERE pipeline_id = $1 AND name = $2
      LIMIT 1`,
    [pipelineId, targetStageName]
  );
  const targetStage = stageRows[0];
  if (!targetStage) return null;

  const { rows: userRows } = await pool.query(
    `SELECT id FROM coexistence.forgecrm_users WHERE role='admin' ORDER BY id LIMIT 1`
  );
  const createdBy = userRows[0]?.id || null;

  const { rows: contactRows } = await pool.query(
    `SELECT COALESCE(name, profile_name, $3) AS name
       FROM coexistence.contacts
      WHERE wa_number=$1 AND contact_number=$2
      LIMIT 1`,
    [record.wa_number, record.contact_number, record.contact_number]
  );
  const contactName = contactRows[0]?.name || record.contact_number;
  const nextNote = `[${new Date().toISOString()}] ${notes || `Stage → ${targetStageName}`}`;

  const { rows: existingRows } = await pool.query(
    `SELECT d.*, s.position AS current_stage_position, s.name AS current_stage_name
       FROM coexistence.deals d
       JOIN coexistence.pipeline_stages s ON s.id=d.stage_id
      WHERE d.pipeline_id=$1 AND d.contact_wa_number=$2 AND d.contact_number=$3
      ORDER BY d.updated_at DESC NULLS LAST, d.id DESC
      LIMIT 1`,
    [pipelineId, record.wa_number, record.contact_number]
  );

  if (existingRows.length === 0) {
    const title = `IA360 · ${contactName} · Quick win cartera`;
    const { rows: posRows } = await pool.query(
      `SELECT COALESCE(MAX(position),-1)+1 AS pos FROM coexistence.deals WHERE stage_id=$1`,
      [targetStage.id]
    );
    const status = targetStage.stage_type === 'won' ? 'won' : targetStage.stage_type === 'lost' ? 'lost' : 'open';
    const { rows } = await pool.query(
      `INSERT INTO coexistence.deals
         (pipeline_id, stage_id, title, value, currency, status, assigned_user_id,
          contact_wa_number, contact_number, contact_name, notes, position, created_by,
          won_at, lost_at)
       VALUES ($1,$2,$3,0,'MXN',$4,$5,$6,$7,$8,$9,$10,$11,
               ${status === 'won' ? 'NOW()' : 'NULL'}, ${status === 'lost' ? 'NOW()' : 'NULL'})
       RETURNING id`,
      [pipelineId, targetStage.id, title, status, createdBy, record.wa_number, record.contact_number, contactName, nextNote, posRows[0].pos, createdBy]
    );
    return { id: rows[0].id, created: true, stage: targetStage.name, title };
  }

  const existing = existingRows[0];
  const shouldMove = Number(targetStage.position) >= Number(existing.current_stage_position);
  const finalStageId = shouldMove ? targetStage.id : existing.stage_id;
  const finalStatus = targetStage.stage_type === 'won' ? 'won' : targetStage.stage_type === 'lost' ? 'lost' : 'open';
  const finalNotes = `${existing.notes || ''}${existing.notes ? '\n' : ''}${nextNote}`;
  await pool.query(
    `UPDATE coexistence.deals
        SET stage_id = $1,
            status = $2,
            notes = $3,
            updated_at = NOW(),
            won_at = CASE WHEN $2='won' THEN COALESCE(won_at, NOW()) ELSE NULL END,
            lost_at = CASE WHEN $2='lost' THEN COALESCE(lost_at, NOW()) ELSE NULL END
      WHERE id = $4`,
    [finalStageId, shouldMove ? finalStatus : existing.status, finalNotes, existing.id]
  );
  return { id: existing.id, moved: shouldMove, stage: shouldMove ? targetStage.name : existing.current_stage_name, title: existing.title };
}

// Media (imagen/documento) durante esperando_tabla → pedir la versión en texto.
// El bot no descarga ni interpreta el archivo; solo guía al contacto.
async function handleCarteraMediaInbound(record) {
  try {
    if (!record || record.direction !== 'incoming') return false;
    if (record.message_type !== 'image' && record.message_type !== 'document') return false;
    if (normalizePhone(record.contact_number) === IA360_OWNER_NUMBER) return false;
    const contact = await loadIa360ContactContext(record).catch(() => null);
    if (!contact || !ia360IsClienteActivoCartera(contact)) return false;
    if ((contact.custom_fields?.ia360_cartera_state || '') !== 'esperando_tabla') return false;
    await enqueueIa360Text({ record, label: 'ia360_cartera_pide_texto', body: IA360_CARTERA_COPY.pideTexto });
    return true;
  } catch (err) {
    console.error('[cartera] media handler error (no route):', err.message);
    return false;
  }
}

// Readout al owner tras entregar el mapa (PASO 2). ownerBudget=false: un quick
// win entregado siempre se reporta.
function buildCarteraOwnerReadout({ record, contactName, deal, mapa, rows }) {
  return [
    `IA360 · Quick win cartera — ${contactName || 'contacto'} (${maskIa360Number(record.contact_number)})`,
    '',
    `El contacto entregó su tabla de cartera (${rows.length} ${rows.length === 1 ? 'cuenta' : 'cuentas'}) y le devolví el mapa estructurado.`,
    `- Cuentas con descuadre: ${mapa.cuentasConDescuadre} · Diferencia acumulada: ${carteraFormatoMonto(mapa.diferenciaTotal) || 'por calcular'}`,
    deal ? `- Deal: «${deal.title || 'sin título'}» → ${deal.stage} (P7 Champions).` : '- Deal: no se encontró deal en P7 (revisar).',
    '- Mapa encolado a ia360_docs_sync (destino AlekContenido).',
    '',
    'No envié pitch ni agenda; el flujo quedó en modo quick win.',
  ].join('\n');
}

// PASO 1 + PASO 2 — texto libre. Va DESPUÉS de Revenue OS y ANTES del agente
// genérico en el dispatch; devuelve true para CORTAR el embudo (guardrail: el
// agente no debe responder encima ni empujar agenda).
async function handleCarteraFreeText(record) {
  try {
    if (!record || record.direction !== 'incoming' || record.message_type !== 'text') return false;
    const body = String(record.message_body || '').trim();
    if (!body) return false;
    if (normalizePhone(record.contact_number) === IA360_OWNER_NUMBER) return false;
    const contact = await loadIa360ContactContext(record).catch(() => null);
    if (!contact || !ia360IsClienteActivoCartera(contact)) return false;
    const state = contact.custom_fields?.ia360_cartera_state || '';

    // PASO 2 — esperando la tabla.
    if (state === 'esperando_tabla') {
      const rows = parseCarteraTabla(body);
      if (rows.length > 0) {
        const mapa = buildCarteraMapa(rows);
        const deal = await syncCarteraChampionsDeal({
          record,
          targetStageName: CARTERA_STAGE_QUICKWIN,
          notes: `PASO 2 mapa de cartera: tabla recibida (${rows.length} cuentas). Quick win entregado.\nTabla original:\n${body}\n\n${mapa.texto}`,
        }).catch(e => { console.error('[cartera] deal quick win:', e.message); return null; });
        await mergeContactIa360State({
          waNumber: record.wa_number,
          contactNumber: record.contact_number,
          tags: ['cartera-quickwin-entregado'],
          customFields: {
            ia360_cartera_state: 'mapa_entregado',
            ia360_cartera_mapa_at: new Date().toISOString(),
            ia360_cartera_cuentas: rows.length,
            ia360_cartera_tabla_raw: body,
          },
        }).catch(e => console.error('[cartera] estado mapa_entregado:', e.message));
        await enqueueIa360Text({ record, label: 'ia360_cartera_mapa', body: mapa.texto });
        await pool.query(
          `INSERT INTO coexistence.ia360_docs_sync (idea_id, titulo, contenido, destino)
           VALUES (NULL, $1, $2, 'AlekContenido')`,
          [
            `Mapa de cartera — ${contact.name || record.contact_number} (${new Date().toISOString().slice(0, 10)})`,
            `${mapa.texto}\n\n---\nTabla original pegada por el contacto:\n${body}`,
          ]
        ).catch(e => console.error('[cartera] docs_sync:', e.message));
        await sendIa360DirectText({
          record,
          toNumber: IA360_OWNER_NUMBER,
          label: 'owner_cartera_readout',
          body: buildCarteraOwnerReadout({ record, contactName: contact.name, deal, mapa, rows }),
          targetContact: record.contact_number,
        }).catch(e => console.error('[cartera] owner readout:', e.message));
        return true;
      }
      // Sin tabla todavía: si insiste en el tema, recordamos el formato; si
      // habla de otra cosa, el agente genérico responde (respuesta siempre útil).
      if (ia360EsMensajeCartera(body)) {
        await enqueueIa360Text({ record, label: 'ia360_cartera_formato', body: IA360_CARTERA_COPY.recordatorioFormato });
        return true;
      }
      return false;
    }

    // PASO 1 — disparo del flujo (solo tema cartera; gate del goal).
    if (state !== 'mapa_entregado' && ia360EsMensajeCartera(body)) {
      await mergeContactIa360State({
        waNumber: record.wa_number,
        contactNumber: record.contact_number,
        tags: ['cartera-quickwin'],
        customFields: {
          ia360_cartera_state: 'esperando_tabla',
          ia360_cartera_dolor: body,
          ia360_cartera_paso1_at: new Date().toISOString(),
        },
      });
      await syncCarteraChampionsDeal({
        record,
        targetStageName: CARTERA_STAGE_VALIDACION,
        notes: `PASO 1 mapa de cartera: el contacto reportó saldos que no cuadran. Mensaje: ${body}`,
      }).catch(e => console.error('[cartera] deal paso 1:', e.message));
      await enqueueIa360Text({ record, label: 'ia360_cartera_paso1', body: IA360_CARTERA_COPY.paso1 });
      return true;
    }
    return false;
  } catch (err) {
    console.error('[cartera] free-text handler error (no route):', err.message);
    return false;
  }
}

async function resolveIa360Outbound(record, dedupSuffix = '') {
  // dedupSuffix permite mandar UN segundo mensaje al mismo contacto para el mismo inbound
  // sin que el dedup (por ia360_handler_for) lo descarte. Default '' = comportamiento idéntico.
  const handlerFor = dedupSuffix ? record.message_id + dedupSuffix : record.message_id;
  const { rows } = await pool.query(
    `SELECT 1 FROM coexistence.chat_history
      WHERE direction='outgoing'
        AND contact_number=$1
        AND template_meta->>'ia360_handler_for'=$2
      LIMIT 1`,
    [record.contact_number, handlerFor]
  );
  if (rows.length > 0) return { duplicate: true };

  const { account, error } = await resolveAccount({ fromPhoneNumber: record.wa_number });
  if (error || !account) {
    console.error('[ia360-lite] account resolution failed:', error || 'unknown');
    return { error: error || 'unknown' };
  }
  return { account };
}

async function enqueueIa360Interactive({ record, label, messageBody, interactive, dedupSuffix = '' }) {
  const resolved = await resolveIa360Outbound(record, dedupSuffix);
  if (resolved.duplicate || resolved.error) return false;
  const { account } = resolved;

  // Audit visibility: persist the full interactive body so the owner can see the
  // exact selector text + options the client received (not just the short label).
  let auditBody = messageBody;
  try {
    const bodyText = interactive && interactive.body && interactive.body.text ? String(interactive.body.text) : '';
    const act = (interactive && interactive.action) || {};
    let opts = [];
    if (Array.isArray(act.buttons)) {
      opts = act.buttons.map(b => (b && b.reply && b.reply.title) ? b.reply.title : '').filter(Boolean);
    } else if (Array.isArray(act.sections)) {
      opts = act.sections.flatMap(s => Array.isArray(s.rows) ? s.rows.map(r => (r && r.title) ? r.title : '') : []).filter(Boolean);
    }
    const parts = [];
    if (bodyText) parts.push(bodyText);
    if (opts.length) parts.push('Opciones: ' + opts.join(' | '));
    if (parts.length) auditBody = messageBody + ' — ' + parts.join(' — ');
  } catch (e) { /* keep label-only body on any parsing issue */ }

  // G-BRAIN sandbox: interactivo al OWNER originado por inbound sintético del
  // harness => fila 'qa_sandboxed' sin egress real.
  const qaSandbox = normalizePhone(record.contact_number) === IA360_OWNER_NUMBER && isIa360SyntheticWamid(record.message_id);
  const localId = await insertPendingRow({
    account,
    toNumber: record.contact_number,
    messageType: 'interactive',
    messageBody: auditBody,
    templateMeta: {
      ux: 'ia360_lite',
      label,
      ia360_handler_for: dedupSuffix ? record.message_id + dedupSuffix : record.message_id,
      source: 'webhook_interactive_reply',
      ...(qaSandbox ? { qa_sandbox: true } : {}),
    },
    rawPayloadExtra: interactive,
    ...(qaSandbox ? { status: 'qa_sandboxed' } : {}),
  });
  if (!localId) return false; // dedupe atómico ON CONFLICT: otra ruta ya insertó este handler
  if (qaSandbox) {
    console.log('[ia360-qa-sandbox] interactivo al owner SIN egress real label=%s origen=%s', label, record.message_id);
    return true;
  }
  await enqueueSend({
    kind: 'interactive',
    accountId: account.id,
    to: record.contact_number,
    localMessageId: localId,
    payload: { interactive },
  });
  return true;
}

// FlowWire: build a WhatsApp Flow (type:'flow') interactive and enqueue it through the
// existing IA360 interactive path. metaSend.sendInteractive forwards `interactive` verbatim,
// so a flow object is sent as-is. Returns the bool from enqueueIa360Interactive
// (true once enqueued; downstream Meta rejection is NOT observable here).
async function enqueueIa360FlowMessage({ record, flowId, screen, cta, bodyText, mediaUrl, flowToken, label, footer = 'IA360' }) {
  const interactive = {
    type: 'flow',
    header: { type: 'image', image: { link: mediaUrl } },
    body: { text: bodyText },
    footer: { text: footer },
    action: {
      name: 'flow',
      parameters: {
        flow_message_version: '3',
        flow_token: flowToken,
        flow_id: flowId,
        flow_cta: cta,
        flow_action: 'navigate',
        flow_action_payload: { screen },
      },
    },
  };
  return enqueueIa360Interactive({
    record,
    label: label || `ia360_flow_${flowToken}`,
    messageBody: `IA360 Flow: ${cta}`,
    interactive,
  });
}

// W4 — "Enviar contexto" es stage-aware (DESAMBIGUACION del brief): si el contacto YA tiene
// slot agendado (ia360_bookings no vacio) abre el Flow pre_call (contexto para la llamada);
// si NO hay slot abre el Flow diagnostico ligero. El stage manda. Devuelve el bool de envio
// (true si se encolo). loadIa360Bookings/enqueueIa360FlowMessage estan hoisted (function decls).
async function dispatchContextFlow(record) {
  const bookings = await loadIa360Bookings(record.contact_number);
  const hasSlot = Array.isArray(bookings) && bookings.length > 0;
  console.log('[ia360-flowwire] send_context contact=%s hasSlot=%s -> %s', record.contact_number, hasSlot, hasSlot ? 'pre_call' : 'diagnostico');
  if (hasSlot) {
    return enqueueIa360FlowMessage({
      record,
      flowId: '862907796864124',
      screen: 'PRE_CALL_INTAKE',
      cta: 'Enviar contexto',
      bodyText: 'Para que Alek llegue preparado a tu llamada (no demo de cajón): cuéntame empresa, tu rol, el objetivo, los sistemas que usan hoy y qué sería un buen resultado.',
      mediaUrl: 'https://wa.geekstudio.dev/ia360-bca/transformacion.jpg',
      flowToken: 'ia360_pre_call',
      label: 'ia360_send_context_precall',
    });
  }
  return enqueueIa360FlowMessage({
    record,
    flowId: '995344356550872',
    screen: 'DIAGNOSTICO',
    cta: 'Abrir diagnóstico',
    bodyText: 'Para no darte algo genérico, cuéntame en 30 segundos dónde se te va el tiempo o el dinero. Lo aterrizo a tu caso.',
    mediaUrl: 'https://wa.geekstudio.dev/ia360-bca/dolor_ceo.jpg',
    flowToken: 'ia360_diagnostico',
    label: 'ia360_send_context_diag',
  });
}

async function enqueueIa360Text({ record, label, body, dedupSuffix = '' }) {
  // dedupSuffix (deuda G-LIVE): permite un SEGUNDO texto legítimo al mismo contacto
  // para el mismo inbound (p.ej. fallback del slot-confirm tras un prompt fallido)
  // sin que el dedupe por ia360_handler_for lo descarte. Default '' = sin cambio.
  const resolved = await resolveIa360Outbound(record, dedupSuffix);
  if (resolved.duplicate || resolved.error) return false;
  const { account } = resolved;

  // G-BRAIN sandbox: texto al OWNER originado por inbound sintético del harness
  // => fila 'qa_sandboxed' sin egress real.
  const qaSandbox = normalizePhone(record.contact_number) === IA360_OWNER_NUMBER && isIa360SyntheticWamid(record.message_id);
  const localId = await insertPendingRow({
    account,
    toNumber: record.contact_number,
    messageType: 'text',
    messageBody: body,
    templateMeta: {
      ux: 'ia360_100m',
      label,
      ia360_handler_for: dedupSuffix ? record.message_id + dedupSuffix : record.message_id,
      source: 'webhook_terminal_handoff',
      ...(qaSandbox ? { qa_sandbox: true } : {}),
    },
    ...(qaSandbox ? { status: 'qa_sandboxed' } : {}),
  });
  if (!localId) return false; // dedupe atómico ON CONFLICT: otra ruta ya insertó este handler
  if (qaSandbox) {
    console.log('[ia360-qa-sandbox] texto al owner SIN egress real label=%s origen=%s', label, record.message_id);
    return true;
  }
  await enqueueSend({
    kind: 'text',
    accountId: account.id,
    to: record.contact_number,
    localMessageId: localId,
    payload: { body, previewUrl: false },
  });
  return true;
}

// G-BRAIN: respuesta conversacional del AGENTE con candado anti-doble-ruta.
// El incidente José Ramón (ids 1651/1653): dos inbound casi simultáneos del mismo
// contacto (texto + botón) dispararon rutas paralelas — la seq_* contestó al
// instante y el agente (latencia 5-30 s) contestó LO MISMO 14 s después. El candado:
// dentro de UNA transacción con advisory lock por contacto, si ya existe una
// respuesta conversacional INSERTADA DESPUÉS de este inbound (o.id > inbound.id,
// ventana 120 s), el reply del agente se descarta. El INSERT de la fila pendiente
// ocurre en la MISMA transacción (no SELECT-then-INSERT): dos agentes concurrentes
// se serializan en el lock y el segundo ve la fila del primero.
// Devuelve: true = enviado; 'superseded' (truthy) = otra ruta ya contestó, el
// caller debe marcar responded sin alertar; false = error/dedupe duro.
async function enqueueIa360AgentReply({ record, label, body }) {
  const resolved = await resolveIa360Outbound(record);
  if (resolved.duplicate || resolved.error) return false;
  const { account } = resolved;
  const client = await pool.connect();
  let localId = null;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73601, hashtext($1))', [String(record.contact_number || '')]);
    const { rows } = await client.query(
      `SELECT o.id FROM coexistence.chat_history o
        WHERE o.direction = 'outgoing'
          AND o.contact_number = $1
          AND o.template_meta->>'source' IN ('webhook_terminal_handoff', 'webhook_interactive_reply')
          AND COALESCE(o.status, '') NOT IN ('failed', 'error')
          AND o.id > COALESCE((SELECT i.id FROM coexistence.chat_history i WHERE i.message_id = $2 LIMIT 1), 0)
          AND o.created_at > NOW() - INTERVAL '120 seconds'
        LIMIT 1`,
      [record.contact_number, record.message_id || '~none~']
    );
    if (rows.length) {
      await client.query('ROLLBACK');
      console.log('[ia360-dedupe] reply del agente DESCARTADO: otra ruta ya contestó (contact=%s inbound=%s outgoing_id=%s)',
        maskIa360Number(record.contact_number), record.message_id, rows[0].id);
      return 'superseded';
    }
    localId = await insertPendingRow({
      account,
      toNumber: record.contact_number,
      messageType: 'text',
      messageBody: body,
      templateMeta: {
        ux: 'ia360_100m',
        label,
        ia360_handler_for: record.message_id,
        source: 'webhook_terminal_handoff',
      },
      db: client,
    });
    await client.query(localId ? 'COMMIT' : 'ROLLBACK');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ya cerrada */ }
    console.error('[ia360-dedupe] agent reply tx error:', err.message);
    return false;
  } finally {
    client.release();
  }
  if (!localId) return false;
  await enqueueSend({
    kind: 'text',
    accountId: account.id,
    to: record.contact_number,
    localMessageId: localId,
    payload: { body, previewUrl: false },
  });
  return true;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseTemplateSamples(samples) {
  if (!samples) return {};
  if (typeof samples === 'object') return samples;
  try { return JSON.parse(samples); } catch { return {}; }
}

function templateBodyIndexes(body) {
  const out = new Set();
  for (const m of String(body || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) out.add(m[1]);
  return Array.from(out).sort((a, b) => Number(a) - Number(b));
}

function firstNameForTemplate(record) {
  const raw = String(record.contact_name || record.profile_name || '').trim();
  const cleaned = raw.replace(/\s+WhatsApp IA360$/i, '').trim();
  return cleaned.split(/\s+/).filter(Boolean)[0] || 'Alek';
}

async function resolveTemplateHeaderMediaId(tpl, account) {
  const headerType = String(tpl.header_type || 'NONE').toUpperCase();
  if (!['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) return null;
  if (!tpl.header_media_library_id) {
    throw new Error(`template ${tpl.name} requires ${headerType} header media but has no header_media_library_id`);
  }
  const { rows: mRows } = await pool.query(
    `SELECT * FROM coexistence.media_library WHERE id = $1 AND deleted_at IS NULL`,
    [tpl.header_media_library_id]
  );
  if (!mRows.length) throw new Error(`media library id ${tpl.header_media_library_id} not found`);
  const { rows: sRows } = await pool.query(
    `SELECT * FROM coexistence.media_meta_sync WHERE media_id = $1 AND account_id = $2`,
    [tpl.header_media_library_id, account.id]
  );
  let sync = sRows[0];
  const needsSync = !sync || sync.status !== 'synced' || !sync.meta_media_id || (sync.expires_at && new Date(sync.expires_at) <= new Date());
  if (needsSync) {
    const { syncMediaToAccount } = require('./mediaLibrary');
    const synced = await syncMediaToAccount(tpl.header_media_library_id, account.id);
    sync = { meta_media_id: synced.metaMediaId, expires_at: synced.expiresAt, status: synced.status };
  }
  if (!sync?.meta_media_id) throw new Error(`media library id ${tpl.header_media_library_id} has no Meta media id`);
  return sync.meta_media_id;
}

const { validateTemplateSend } = require('../integrations/templateValidator');

// Render a template body to plain text using the same param logic as
// buildIa360TemplateComponents ({{1}} = contact first name, {{n}} = vars[n] reales
// del flujo si traen contenido, si no samples[n]). Mantenerlo en paridad con
// buildIa360TemplateComponents: este render es lo que se persiste como
// message_body para que la auditoría del owner vea EXACTAMENTE lo que recibió
// el contacto, no el body crudo con {{1}} (gap de auditoría del id 1612).
function renderIa360TemplateBody(tpl, record, vars = null) {
  const samples = parseTemplateSamples(tpl.samples);
  return String(tpl.body || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, k) => {
    if (k === '1') return firstNameForTemplate(record);
    const v = vars?.[k];
    const hasVar = v != null && String(v).trim() !== '';
    return hasVar ? String(v) : String(samples[k] || ' ');
  });
}

async function buildIa360TemplateComponents(tpl, account, record, vars = null) {
  const components = [];
  const headerType = String(tpl.header_type || 'NONE').toUpperCase();
  const headerMediaId = await resolveTemplateHeaderMediaId(tpl, account);
  if (headerMediaId) {
    const key = headerType.toLowerCase();
    components.push({ type: 'header', parameters: [{ type: key, [key]: { id: headerMediaId } }] });
  }

  const samples = parseTemplateSamples(tpl.samples);
  const indexes = templateBodyIndexes(tpl.body);
  if (indexes.length) {
    components.push({
      type: 'body',
      // G-COLD: para índices distintos de '1', vars (valor real del flujo, p.ej.
      // quien_intro) tiene prioridad SOLO si trae contenido; si no, se conserva
      // el fallback samples[k] || ' ' de los flujos existentes.
      parameters: indexes.map(k => {
        if (k === '1') return { type: 'text', text: firstNameForTemplate(record) };
        const v = vars?.[k];
        const hasVar = v != null && String(v).trim() !== '';
        return { type: 'text', text: hasVar ? String(v) : String(samples[k] || ' ') };
      }),
    });
  }
  return components;
}

async function waitForIa360OutboundStatus(handlerFor, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(600);
    const { rows } = await pool.query(
      `SELECT status, error_message, message_id
         FROM coexistence.chat_history
        WHERE direction='outgoing'
          AND template_meta->>'ia360_handler_for'=$1
        ORDER BY id DESC
        LIMIT 1`,
      [handlerFor]
    );
    last = rows[0] || last;
    if (last && ['sent', 'failed'].includes(String(last.status || '').toLowerCase())) return last;
  }
  return last || { status: 'unknown' };
}

async function enqueueIa360Template({ record, label, templateName, templateId = null, vars = null, allowTextFallback = true }) {
  const resolved = await resolveIa360Outbound(record, `:${label}`);
  if (resolved.duplicate || resolved.error) return { ok: false, status: resolved.duplicate ? 'duplicate' : 'error', error: resolved.error || null };
  const { account } = resolved;
  let tpl = null;
  if (templateId) {
    const { rows } = await pool.query(
      `SELECT id, name, language, body, status, header_type, header_media_library_id, samples
         FROM coexistence.message_templates
        WHERE id=$1 AND status='APPROVED'
        LIMIT 1`,
      [templateId]
    );
    tpl = rows[0] || null;
  }
  if (!tpl && templateName) {
    const { rows } = await pool.query(
      `SELECT id, name, language, body, status, header_type, header_media_library_id, samples
         FROM coexistence.message_templates
        WHERE name=$1 AND status='APPROVED'
        ORDER BY updated_at DESC
        LIMIT 1`,
      [templateName]
    );
    tpl = rows[0] || null;
  }
  if (!tpl) {
    console.error('[ia360-owner-pipe] approved template not found:', templateName || templateId);
    return { ok: false, status: 'template_not_found', error: String(templateName || templateId || '') };
  }
  let components;
  try {
    components = await buildIa360TemplateComponents(tpl, account, record, vars);
  } catch (err) {
    console.error('[ia360-owner-pipe] template components error:', err.message);
    return { ok: false, status: 'template_components_error', error: err.message };
  }

  // Pre-Meta validation against the registered template spec. If the
  // outgoing component shape would be rejected by Meta (#132000/#132012),
  // do NOT send a broken template. Fall back to free text (rendered body):
  // inside the 24h service window Meta delivers it; outside it Meta rejects
  // free text and the row is marked failed (logged). That realizes
  // "ventana abierta -> texto libre; cerrada -> no enviar y avisar".
  try {
    const v = await validateTemplateSend(account, tpl.name, tpl.language || 'es_MX', components);
    if (!v.valid) {
      // G-COLD: fuera de ventana el fallback a texto libre está PROHIBIDO
      // (allowTextFallback:false): Meta lo rechazaría y aquí se reportaría un
      // éxito falso; además renderiza con samples, no con vars reales.
      if (!allowTextFallback) {
        console.error(`[ia360-owner-pipe] template "${tpl.name}" invalid vs Meta (${v.source}): ${v.errors.join('; ')} -> sin fallback (allowTextFallback=false)`);
        return { ok: false, status: 'template_invalid', error: v.errors.join('; ') };
      }
      console.error(`[ia360-owner-pipe] template "${tpl.name}" invalid vs Meta (${v.source}): ${v.errors.join('; ')} -> free-text fallback`);
      const sent = await enqueueIa360Text({ record, label: `${label}_textfallback`, body: renderIa360TemplateBody(tpl, record, vars) });
      return { ok: !!sent, status: sent ? 'text_fallback' : 'error', error: sent ? null : 'template invalid and text fallback failed' };
    }
  } catch (err) {
    console.error('[ia360-owner-pipe] template validation error:', err.message);
  }
  const handlerFor = `${record.message_id}:${label}`;
  const localId = await insertPendingRow({
    account,
    toNumber: record.contact_number,
    messageType: 'template',
    // G-BRAIN: persistir el body RENDERIZADO (mismos parámetros que los components
    // enviados a Graph), no el crudo con {{1}} — la fila de chat_history es la
    // evidencia de auditoría de lo que el contacto recibió de verdad.
    messageBody: renderIa360TemplateBody(tpl, record, vars) || tpl.name,
    templateMeta: {
      ux: 'ia360_owner_pipeline',
      label,
      ia360_handler_for: handlerFor,
      source: 'webhook_owner_pipe',
      template_name: tpl.name,
      template_id: tpl.id,
      header_type: tpl.header_type || 'NONE',
      header_media_library_id: tpl.header_media_library_id || null,
    },
  });
  if (!localId) return { ok: false, status: 'duplicate', error: null }; // dedupe atómico ON CONFLICT
  await enqueueSend({
    kind: 'template',
    accountId: account.id,
    to: record.contact_number,
    localMessageId: localId,
    payload: { name: tpl.name, languageCode: tpl.language || 'es_MX', components },
  });
  const status = await waitForIa360OutboundStatus(handlerFor);
  return {
    ok: String(status?.status || '').toLowerCase() === 'sent',
    status: status?.status || 'unknown',
    error: status?.error_message || null,
  };
}

async function emitIa360N8nHandoff({ record, eventType, targetStage, summary, priority = 'normal' }) {
  const url = process.env.N8N_IA360_HANDOFF_WEBHOOK_URL;
  if (!url) return false;
  try {
    const payload = {
      source: 'forgechat-ia360-webhook',
      eventType,
      priority,
      targetStage,
      summary,
      occurredAt: new Date().toISOString(),
      contact: {
        waNumber: record.wa_number,
        contactNumber: record.contact_number,
        contactName: record.contact_name || null,
      },
      trigger: {
        messageId: record.message_id,
        messageType: record.message_type,
        messageBody: record.message_body,
        timestamp: record.timestamp,
      },
      recommendedActions: [
        'upsert_espocrm_contact',
        'create_human_task',
        'prepare_call_context',
        'optionally_create_zoom_or_calendar_event',
      ],
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[ia360-n8n] handoff failed:', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[ia360-n8n] handoff error:', err.message);
    return false;
  }
}

async function requestIa360Availability({ record, day }) {
  const url = process.env.N8N_IA360_AVAILABILITY_WEBHOOK_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'forgechat-ia360-webhook',
        day,
        workStartHour: 10,
        workEndHour: 18,
        slotMinutes: 60,
        contact: {
          waNumber: record.wa_number,
          contactNumber: record.contact_number,
          contactName: record.contact_name || null,
        },
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('[ia360-calendar] availability failed:', res.status, text);
      return null;
    }
    return JSON.parse(text);
  } catch (err) {
    console.error('[ia360-calendar] availability error:', err.message);
    return null;
  }
}

function parseIa360SlotId(replyId) {
  const m = String(replyId || '').match(/^slot_(\d{8})t(\d{6})z$/i);
  if (!m) return null;
  const [, ymd, hms] = m;
  const start = `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}T${hms.slice(0,2)}:${hms.slice(2,4)}:${hms.slice(4,6)}.000Z`;
  const end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
  return { start, end };
}

async function bookIa360Slot({ record, start, end }) {
  const url = process.env.N8N_IA360_BOOK_WEBHOOK_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'forgechat-ia360-webhook',
        start,
        end,
        contact: {
          waNumber: record.wa_number,
          contactNumber: record.contact_number,
          contactName: record.contact_name || 'WhatsApp IA360',
        },
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('[ia360-calendar] book failed:', res.status, text);
      return { ok: false, reason: 'book_failed' };
    }
    return JSON.parse(text || '{}');
  } catch (err) {
    console.error('[ia360-calendar] book error:', err.message);
    return { ok: false, reason: 'book_error' };
  }
}

// Delega en el módulo puro ./ia360OpenerReply (mismo parse, sin DB) para que los
// tests ejerciten exactamente la extracción que corre en producción.
function getInteractiveReplyId(record) {
  return extractInteractiveReplyId(record);
}


// ── IA360 free-text AI agent (G-B fix) ───────────────────────────────────────
// When a prospect with an ACTIVE, NON-TERMINAL IA360 deal sends FREE TEXT (not a
// button), the button state machine no-ops. Instead of silence, hand off to the
// n8n AI agent which classifies intent + extracts a date, then ForgeChat acts:
//   - offer_slots: query REAL Calendar freebusy for the agent's date, send slots
//   - optout:      send reply, move deal to "Perdido / no fit"
//   - else:        send the agent's coherent reply (and advance pain if asked)
// Fire-and-forget from the inbound loop so it never blocks the Meta 200 ack.
async function getActiveNonTerminalIa360Deal(record) {
  const { rows: pipeRows } = await pool.query(
    `SELECT id FROM coexistence.pipelines WHERE name = 'IA360 WhatsApp Revenue Pipeline' LIMIT 1`
  );
  const pipelineId = pipeRows[0]?.id;
  if (!pipelineId) return null;
  const { rows } = await pool.query(
    `SELECT d.id, s.name AS stage_name, s.stage_type
       FROM coexistence.deals d
       JOIN coexistence.pipeline_stages s ON s.id = d.stage_id
      WHERE d.pipeline_id = $1 AND d.contact_wa_number = $2 AND d.contact_number = $3
      ORDER BY d.updated_at DESC NULLS LAST, d.id DESC
      LIMIT 1`,
    [pipelineId, record.wa_number, record.contact_number]
  );
  const deal = rows[0];
  if (!deal) {
    const contact = await loadIa360ContactContext(record).catch(() => null);
    if (isIa360ClienteActivoBetaContact(contact)) {
      return {
        id: null,
        stage_name: 'Cliente activo beta supervisado',
        stage_type: 'active_client_beta',
        memory_mode: 'cliente_activo_beta_supervisado',
        contact_context: contact,
      };
    }
    return null;
  }
  const txt = String(record.message_body || '').toLowerCase();
  // Reschedule intent: a prospect with an already-booked meeting who wants to move it
  // SHOULD reach the agent (we explicitly invite "escríbeme por aquí" in the confirmation).
  const wantsReschedule = /reagend|reprogram|mover|mu[eé]v|cambi|otro d[ií]a|otra hora|otro horario|otra fecha|posponer|recorr|adelantar|cancel|anul|ya no (podr|voy|asist)/.test(txt);
  // MULTI-CITA: un prospecto YA agendado puede querer una SEGUNDA reunión. Ese mensaje
  // ("y otra para el miércoles", "necesito otra reunión") NO es reagendar ni pasivo, así
  // que también debe llegar al agente. Sin esto el gate lo silenciaba (return null).
  const wantsBooking = /reuni[oó]n|cita|agend|coordin|horario|disponib|otra (para|cita|reuni)|una m[aá]s|otra m[aá]s|necesito una|quiero (una|agendar)|me gustar[ií]a (una|agendar)/i.test(txt);
  // LIST intent ("¿cuáles tengo?", "qué citas tengo", "mis reuniones"): un prospecto YA
  // agendado que quiere CONSULTAR sus citas debe llegar al agente (list_bookings). Sin
  // esto el gate lo silenciaba estando en "Reunión agendada".
  const wantsList = /(cu[aá]l|cu[aá]nt|qu[eé]).{0,14}(tengo|hay|agend|cita|reuni)|mis (citas|reuni)|ver (mis )?(citas|reuni)|tengo .{0,10}(agend|cita|reuni)/i.test(txt);
  // Always-terminal = won/lost → never auto-prospect. Explicit client-beta context
  // is the exception: it can learn/respond with delight guardrails, not sell.
  if (deal.stage_type === 'won' || deal.stage_type === 'lost' || deal.stage_name === 'Ganado' || deal.stage_name === 'Perdido / no fit') {
    const contact = await loadIa360ContactContext(record).catch(() => null);
    // Deuda G-LIVE cerrada: la marca beta en contacts MANDA aunque el último deal
    // sea lost — un cliente activo/beta con un deal viejo perdido seguía recibiendo
    // solo el holding del watchdog en vez de respuesta real del agente.
    if (isIa360ClienteActivoBetaContact(contact)) {
      return {
        ...deal,
        stage_name: 'Cliente activo beta supervisado',
        stage_type: 'active_client_beta',
        memory_mode: 'cliente_activo_beta_supervisado',
        contact_context: contact,
      };
    }
    return null;
  }
  // Gap#1: un contacto YA agendado que manda texto SUSTANTIVO (una duda, una pregunta)
  // debe recibir respuesta conversacional del agente. Solo silenciamos texto PASIVO
  // ("gracias"/"ok"/"nos vemos"/smalltalk) para no re-disparar el agente sin necesidad;
  // el resto pasa al agente y cae al reply DEFAULT abajo.
  if (deal.stage_name === 'Reunión agendada' && !wantsReschedule && !wantsBooking && !wantsList && isIa360PassiveMessage(record.message_body)) return null;
  return deal;
}

const N8N_IA360_CONTACT_INTEL_WEBHOOK_URL = process.env.N8N_IA360_CONTACT_INTEL_WEBHOOK_URL || 'https://n8n.geekstudio.dev/webhook/ia360-contact-intelligence-agent-draft';

function buildIa360AgentPayload({ record, stageName, history, source }) {
  return {
    source,
    channel: 'whatsapp',
    dry_run: source === 'forgechat-ia360-contact-intelligence-shadow',
    text: record.message_body || '',
    stage: stageName,
    history,
    message_id: record.message_id || null,
    wa_number: record.wa_number || null,
    contact_number: record.contact_number || null,
    contact_name: record.contact_name || record.profile_name || null,
  };
}

async function shadowIa360ContactIntelligence({ record, stageName, history }) {
  const url = N8N_IA360_CONTACT_INTEL_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildIa360AgentPayload({
        record,
        stageName,
        history,
        source: 'forgechat-ia360-contact-intelligence-shadow',
      })),
    });
    if (!res.ok) console.error('[ia360-contact-intel] shadow failed:', res.status);
  } catch (err) {
    console.error('[ia360-contact-intel] shadow error:', err.message);
  }
}

async function callIa360Agent({ record, stageName, roleHint = null, memory = null }) {
  // Recent conversation for context (last 8 messages).
  const { rows: hist } = await pool.query(
    `SELECT direction AS dir, message_body AS body
       FROM coexistence.chat_history
      WHERE wa_number = $1 AND contact_number = $2
      ORDER BY timestamp DESC LIMIT 8`,
    [record.wa_number, record.contact_number]
  );
  const history = hist.reverse().map(h => ({ dir: h.dir, body: h.body }));

  // EXPEDIENTE: memoria por contacto (facts+events) para que el agente responda
  // con contexto real del negocio del contacto, no en frio. Best-effort.
  // G-BRAIN: el caller puede pasarla precargada (memory) para no duplicar la
  // consulta cuando ya la usó para construir el roleHint.
  let agentMemory = memory;
  if (!agentMemory) {
    try {
      const memContact = await loadIa360ContactContext(record);
      agentMemory = await lookupIa360MemoryContext({ record, contact: memContact, limit: 8 });
    } catch (memErr) {
      console.error('[ia360-agent] memory lookup failed:', memErr.message);
    }
  }

  const primaryIa360AgentUrl = process.env.N8N_IA360_AGENT_WEBHOOK_URL;
  if (N8N_IA360_CONTACT_INTEL_WEBHOOK_URL && N8N_IA360_CONTACT_INTEL_WEBHOOK_URL !== primaryIa360AgentUrl) {
    shadowIa360ContactIntelligence({ record, stageName, history }).catch(() => {});
  }

  const url = primaryIa360AgentUrl;
  if (!url) return null;
  // n8n agent latency is ~16s in normal conditions; bound the call at 30s so a
  // hung n8n fails fast instead of riding undici's ~300s default. Empty/partial
  // bodies (n8n returning 200 with no JSON) degrade to null → holding reply.
  const ia360AgentController = new AbortController();
  const ia360AgentTimer = setTimeout(() => ia360AgentController.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...buildIa360AgentPayload({
          record,
          stageName,
          history,
          source: 'forgechat-ia360-webhook',
        }),
        memory: agentMemory,
        // G-LIVE: el Normalize del workflow mapea `role` a contact.role dentro del
        // agent_input — perfil de comunicación visible para el modelo sin tocar n8n.
        ...(roleHint ? { role: roleHint } : {}),
      }),
      signal: ia360AgentController.signal,
    });
    if (!res.ok) { console.error('[ia360-agent] failed:', res.status); return null; }
    const text = await res.text();
    if (!text || !text.trim()) {
      console.error('[ia360-agent] empty body: status=%s len=%s', res.status, text ? text.length : 0);
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (parseErr) {
      console.error('[ia360-agent] bad JSON: status=%s len=%s err=%s', res.status, text.length, parseErr.message);
      return null;
    }
  } catch (err) {
    console.error('[ia360-agent] error:', err.name === 'AbortError' ? 'timeout 30000ms' : err.message);
    return null;
  } finally {
    clearTimeout(ia360AgentTimer);
  }
}

// ── IA360 Human-in-the-loop (owner notify + cancelar conversacional) ─────────
// Owner = Alek. HOY su numero es el MISMO que el prospecto de prueba, asi que la
// rama owner discrimina por PREFIJO de id de boton ('owner_'), NO por numero.
// Reflejo por interaccion a EspoCRM: find-or-update de UN Contact con campos ia360_*.
// Best-effort: nunca bloquea la respuesta WA, nunca lanza, nunca toca ia360_bot_failures.
// Llave estable WA = espo_id cacheado en coexistence.contacts.custom_fields (no toca el phone de EspoCRM).
const N8N_IA360_UPSERT_WEBHOOK_URL = process.env.N8N_IA360_UPSERT_WEBHOOK_URL || 'https://n8n.geekstudio.dev/webhook/ia360-espocrm-upsert';
async function reflectIa360ToEspoCrm({ record, agent, channel = 'whatsapp' }) {
  try {
    if (!record || !record.wa_number || !record.contact_number) return;
    const { rows } = await pool.query(
      `SELECT custom_fields->>'espo_id' AS espo_id, COALESCE(name, profile_name) AS name
         FROM coexistence.contacts WHERE wa_number=$1 AND contact_number=$2 LIMIT 1`,
      [record.wa_number, record.contact_number]
    );
    const espoId = rows[0] && rows[0].espo_id ? rows[0].espo_id : null;
    const name = rows[0] && rows[0].name ? rows[0].name : null;
    const payload = {
      channel,
      identifier: record.contact_number,
      espo_id: espoId,
      name,
      intent: (agent && agent.intent) || null,
      action: (agent && agent.action) || null,
      extracted: (agent && agent.extracted) || {},
      last_message: buildIa360CrmCompactNote({ record, agent }),
      transcript_stored: false,
    };
    const res = await fetch(N8N_IA360_UPSERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { console.error('[ia360-crm] upsert failed:', res.status); return; }
    const out = await res.json().catch(() => null);
    if (out && out.ok && out.espo_id && out.espo_id !== espoId) {
      await mergeContactIa360State({
        waNumber: record.wa_number,
        contactNumber: record.contact_number,
        customFields: { espo_id: String(out.espo_id) },
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[ia360-crm] reflect error:', err.message);
  }
}

async function notifyOwnerVcardCaptured({ record, shared }) {
  const who = shared.name || shared.contactNumber;
  const body = `Alek, recibí un contacto compartido por WhatsApp y ya lo dejé capturado.\n\nNombre: ${who}\nWhatsApp: ${shared.contactNumber}\n\nPrimero clasifica qué tipo de persona/contacto es. En esta etapa NO envío secuencias automáticas desde vCard; solo guardo contexto para elegir después una secuencia lógica.`;
  return sendOwnerInteractive({
    record,
    label: `owner_vcard_captured_${shared.contactNumber}`,
    messageBody: `IA360: vCard ${who}`,
    targetContact: shared.contactNumber,
    ownerBudget: true,
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Contacto capturado' },
      body: { text: body },
      footer: { text: 'Captura primero, persona después, envío al final' },
      action: {
        button: 'Elegir persona',
        sections: [{
          title: 'Clasificación',
          rows: [
            { id: `owner_pipe:${shared.contactNumber}:persona_beta`, title: 'Beta / amigo', description: 'Técnico, conocido o prueba' },
            { id: `owner_pipe:${shared.contactNumber}:persona_referido`, title: 'Referido / BNI', description: 'Intro o recomendación' },
            { id: `owner_pipe:${shared.contactNumber}:persona_aliado`, title: 'Aliado / socio', description: 'Canal o proveedor' },
            { id: `owner_pipe:${shared.contactNumber}:persona_cliente`, title: 'Cliente activo', description: 'Engage o deleitar' },
            { id: `owner_pipe:${shared.contactNumber}:persona_sponsor`, title: 'Sponsor ejecutivo', description: 'Buyer o dueño' },
            { id: `owner_pipe:${shared.contactNumber}:persona_comercial`, title: 'Director comercial', description: 'Ventas o pipeline' },
            { id: `owner_pipe:${shared.contactNumber}:persona_cfo`, title: 'CFO / finanzas', description: 'Control, datos o dinero' },
            { id: `owner_pipe:${shared.contactNumber}:persona_tecnico`, title: 'Guardián técnico', description: 'Integración o permisos' },
            { id: `owner_pipe:${shared.contactNumber}:guardar`, title: 'Solo guardar', description: 'Captura sin envío' },
            { id: `owner_pipe:${shared.contactNumber}:excluir`, title: 'No contactar', description: 'Exclusión sin envío' },
          ],
        }],
      },
    },
  });
}

const IA360_PERSONA_SEQUENCE_FLOWS = {
  persona_beta: {
    personaContext: 'Beta / amigo',
    relationshipContext: 'beta_amigo',
    flywheelPhase: 'Engage',
    riskLevel: 'low',
    notes: 'Contacto de confianza o prueba técnica; no tratar como prospecto frío.',
    sequences: [
      {
        id: 'beta_architectura',
        uiTitle: 'Validar arquitectura',
        label: 'Validar arquitectura IA360',
        goal: 'validar si el flujo persona-first se entiende',
        expectedSignal: 'feedback sobre claridad, límites y arquitectura del flujo',
        nextAction: 'Alek revisa si la explicación técnica tiene sentido antes de pedir feedback real.',
        cta: 'pedir permiso para una pregunta corta de validación',
        step2: {
          si_pregunta: 'Va la pregunta: si este mensaje te hubiera llegado sin conocer a Alek, ¿se entiende qué es IA360 y qué puedo y no puedo hacer como IA, o hay algo que te haría desconfiar? Dímelo con toda franqueza; para eso es esta prueba.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Alek está construyendo IA360, un sistema que conecta WhatsApp, CRM y memoria de clientes, y me pidió validarlo con gente de su confianza antes de usarlo con clientes reales. No te quiero vender nada: solo necesito tu ojo técnico. ¿Me dejas hacerte una pregunta corta?`,
        metaTemplateName: 'ia360_beta_architectura', // G-COLD: template frío con los mismos botones del opener
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_beta_architectura:si_pregunta', title: 'Sí, pregúntame' },
            { id: 'seq_beta_architectura:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_beta_architectura:ahora_no', title: 'Ahora no' },
          ],
        },
      },
      {
        id: 'beta_feedback',
        uiTitle: 'Pedir feedback técnico',
        label: 'Pedir feedback técnico',
        goal: 'obtener crítica concreta',
        expectedSignal: 'comentario técnico accionable sobre una parte del sistema',
        nextAction: 'Alek edita la pregunta técnica y decide si la manda como prueba controlada.',
        cta: 'pedir una crítica concreta del flujo',
        step2: {
          si_pregunta: 'Gracias. ¿Cómo se siente recibir un mensaje así de una IA: natural, raro o invasivo? Lo que me digas se lo paso a Alek tal cual, sin suavizarlo.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Alek está probando IA360 (su sistema de WhatsApp + CRM con memoria) con contactos de confianza y quiere críticas directas, no cumplidos. ¿Me dejas hacerte una pregunta breve sobre cómo se siente recibir mensajes de una IA como esta?`,
        metaTemplateName: 'ia360_beta_feedback', // G-COLD
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_beta_feedback:si_pregunta', title: 'Sí, pregúntame' },
            { id: 'seq_beta_feedback:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_beta_feedback:ahora_no', title: 'Ahora no' },
          ],
        },
      },
      {
        id: 'beta_memoria',
        uiTitle: 'Probar memoria/contexto',
        label: 'Probar memoria/contexto',
        goal: 'probar si IA360 recuerda contexto útil',
        expectedSignal: 'validación de si el contexto guardado ayuda o estorba',
        nextAction: 'Alek confirma qué contexto usar en la prueba antes de escribir.',
        cta: 'probar memoria con una pregunta controlada',
        step2: {
          si_a_ver: 'Va. Pregúntame algo que Alek y tú hayan platicado o trabajado antes, y te digo qué tengo registrado. Tú pones la prueba.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Estoy aprendiendo a recordar el contexto de cada persona sin volverme invasiva, y Alek me pidió probarlo contigo porque te tiene confianza. ¿Me dejas hacerte una pregunta corta para poner a prueba mi memoria?`,
        metaTemplateName: 'ia360_beta_memoria', // G-COLD
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_beta_memoria:si_a_ver', title: 'Sí, a ver' },
            { id: 'seq_beta_memoria:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_beta_memoria:ahora_no', title: 'Ahora no' },
          ],
        },
      },
    ],
  },
  persona_referido: {
    personaContext: 'Referido / BNI',
    relationshipContext: 'referido_bni',
    flywheelPhase: 'Attract',
    riskLevel: 'medium',
    notes: 'Proteger reputación del canal; pedir contexto y permiso antes de vender.',
    sequences: [
      {
        id: 'referido_contexto',
        uiTitle: 'Pedir contexto intro',
        label: 'Pedir contexto de intro',
        goal: 'entender de dónde viene la intro',
        expectedSignal: 'origen de la introducción, dolor probable o permiso para avanzar',
        nextAction: 'Alek completa el contexto del referidor antes de mandar cualquier mensaje.',
        cta: 'pedir contexto breve de la introducción',
        step2: {
          pregunta: '¿Qué te contó la persona que nos presentó sobre lo que hace Alek, y qué te llamó la atención para aceptar la introducción? Con eso evitamos mandarte algo fuera de lugar.',
        },
        draft: ({ name, quienIntro }) => `Hola ${name}, soy la IA de Alek. Te escribo porque nos presentó ${quienIntro || '{{quien_intro}}'} y, antes de mandarte cualquier propuesta, Alek quiere entender tu contexto para no escribirte algo fuera de lugar. ¿Cómo prefieres empezar?`,
        // G-COLD: el {{2}} del template es quien_intro; en frío se exige el dato
        // antes de aprobar (ver handleIa360OwnerApproveSend).
        metaTemplateName: 'ia360_referido_contexto',
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_referido_contexto:pregunta', title: 'Hazme una pregunta' },
            { id: 'seq_referido_contexto:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_referido_contexto:ahora_no', title: 'Ahora no' },
          ],
        },
      },
      {
        id: 'referido_oneliner',
        uiTitle: 'One-liner cuidadoso',
        label: 'One-liner cuidadoso',
        goal: 'explicar IA360 sin pitch agresivo',
        expectedSignal: 'interés inicial sin romper la confianza del canal',
        nextAction: 'Alek ajusta el one-liner según quién hizo la introducción.',
        cta: 'pedir permiso para explicar IA360 en una línea',
        step2: {
          si_cuentame: 'Va la versión completa en corto: IA360 conecta WhatsApp, CRM, agenda y memoria de clientes para que el seguimiento no dependa de la memoria de nadie. ¿En tu operación dónde se cae más el seguimiento hoy: mensajes, CRM o agenda?',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Nos presentaron hace poco y Alek prefiere darte la versión corta antes que una llamada a ciegas: IA360 evita que el seguimiento se caiga entre WhatsApp, el CRM, la agenda y la gente. ¿Quieres explorar si aplica a tu caso?`,
        metaTemplateName: 'ia360_referido_oneliner', // G-COLD
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_referido_oneliner:si_cuentame', title: 'Sí, cuéntame más' },
            { id: 'seq_referido_oneliner:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_referido_oneliner:ahora_no', title: 'Por ahora no' },
          ],
        },
      },
      {
        id: 'referido_permiso_agenda',
        uiTitle: 'Agendar con permiso',
        label: 'Agendar con permiso',
        goal: 'pedir permiso antes de agenda',
        expectedSignal: 'permiso explícito para explorar una llamada o siguiente paso',
        nextAction: 'Alek confirma que la introducción justifica proponer agenda.',
        cta: 'pedir permiso para sugerir una llamada',
        step2: {
          pregunta: 'Claro, pregunta con confianza: qué hace IA360, cómo trabaja Alek o qué implicaría la llamada. Te respondo aquí mismo.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Vienes de una introducción y Alek no quiere mandarte una agenda sin contexto. Si ordenar WhatsApp, CRM y seguimiento te suena útil, puedo proponerte una llamada corta con él. ¿Cómo lo ves?`,
        metaTemplateName: 'ia360_referido_permiso_agenda_v2',
        // G-COLD: el template v2 ya trae los mismos botones del opener; el alias
        // mapea su afirmativo a la rama de horarios.
        templateAliasOption: 'horarios',
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_referido_permiso_agenda:horarios', title: 'Proponme horarios' },
            { id: 'seq_referido_permiso_agenda:pregunta', title: 'Primero una pregunta' },
            { id: 'seq_referido_permiso_agenda:ahora_no', title: 'Ahora no' },
          ],
        },
      },
    ],
  },
  persona_aliado: {
    personaContext: 'Aliado / socio',
    relationshipContext: 'aliado_socio',
    flywheelPhase: 'Engage',
    riskLevel: 'medium',
    notes: 'Explorar colaboración, canal o reventa sin exponer datos sensibles.',
    sequences: [
      {
        id: 'aliado_mapa_colaboracion',
        uiTitle: 'Mapa colaboración',
        label: 'Mapa de colaboración',
        goal: 'detectar cómo pueden colaborar',
        expectedSignal: 'tipo de colaboración posible y segmento de clientes compatible',
        nextAction: 'Alek define si la conversación es canal, proveedor, implementación o co-venta.',
        cta: 'mapear fit de colaboración',
        step2: {
          si_pregunta: 'Gracias. ¿Qué tipo de clientes atiendes hoy y dónde los ves sufrir más: WhatsApp desordenado, CRM sin seguimiento o procesos repetidos a mano? Con eso mapeamos el fit.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Alek me pidió escribirte porque te ve como posible aliado, no como cliente: quiere explorar si IA360 les sirve a los clientes que tú ya atiendes cuando tienen fricción en WhatsApp, CRM o procesos repetidos. ¿Te hago una pregunta corta para mapear si hay fit?`,
        metaTemplateName: 'ia360_aliado_mapa_colaboracion_v2', // G-COLD: v2 con botones QUICK_REPLY del opener
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_aliado_mapa_colaboracion:si_pregunta', title: 'Sí, pregúntame' },
            { id: 'seq_aliado_mapa_colaboracion:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_aliado_mapa_colaboracion:ahora_no', title: 'Ahora no' },
          ],
        },
      },
      {
        id: 'aliado_criterios_fit',
        uiTitle: 'Criterios de fit',
        label: 'Criterios de fit',
        goal: 'definir a quién sí conviene presentar',
        expectedSignal: 'criterios de cliente ideal o señales para descartar',
        nextAction: 'Alek valida criterios de fit antes de pedir intros.',
        cta: 'pedir señales de cliente compatible',
        step2: {
          si_pregunta: 'Va: cuando un cliente tuyo ya necesita ordenar WhatsApp, CRM o seguimiento, ¿qué señales lo delatan primero? Con eso definimos juntos a quién sí presentarle IA360.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Alek no quiere pedirte intros a ciegas: primero quiere definir contigo qué tipo de empresa sí tiene sentido para IA360. ¿Me dejas preguntarte qué señales ves cuando un cliente ya necesita ordenar su WhatsApp, CRM o seguimiento?`,
        metaTemplateName: 'ia360_aliado_criterios_fit', // G-COLD
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_aliado_criterios_fit:si_pregunta', title: 'Sí, pregúntame' },
            { id: 'seq_aliado_criterios_fit:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_aliado_criterios_fit:ahora_no', title: 'Ahora no' },
          ],
        },
      },
      {
        id: 'aliado_caso_reventa',
        uiTitle: 'Caso NDA-safe',
        label: 'Caso NDA-safe',
        goal: 'dar material para explicar IA360 sin exponer datos',
        expectedSignal: 'interés en caso seguro para presentar o revender',
        nextAction: 'Alek elige el caso NDA-safe correcto antes de compartirlo.',
        cta: 'ofrecer caso seguro y resumido',
        step2: {
          si_comparte: 'Va el caso NDA-safe en corto: una empresa de servicios perdía seguimiento entre WhatsApp y su CRM; con IA360 cada conversación queda registrada, el pipeline se mueve solo y el dueño revisa su semana en un tablero. ¿Le haría sentido a alguno de tus clientes?',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Alek preparó un caso NDA-safe de IA360 (el problema, la operación antes y el resultado esperado) para que puedas explicárselo a tus clientes sin exponer datos de nadie. ¿Te lo comparto?`,
        metaTemplateName: 'ia360_aliado_caso_reventa', // G-COLD
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_aliado_caso_reventa:si_comparte', title: 'Sí, compártelo' },
            { id: 'seq_aliado_caso_reventa:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_aliado_caso_reventa:ahora_no', title: 'Ahora no' },
          ],
        },
      },
    ],
  },
  persona_cliente: {
    personaContext: 'Cliente activo',
    relationshipContext: 'cliente_activo',
    flywheelPhase: 'Deleitar',
    riskLevel: 'low',
    notes: 'Primero continuidad, adopción o soporte; no abrir venta nueva sin contexto.',
    sequences: [
      {
        id: 'cliente_readout',
        uiTitle: 'Readout de avance',
        label: 'Readout de avance',
        goal: 'mostrar valor logrado',
        expectedSignal: 'avance confirmado, evidencia o siguiente punto pendiente',
        nextAction: 'Alek revisa el avance real del proyecto antes de enviar readout.',
        cta: 'pedir validación del avance',
        step2: {
          si_cuento: 'Te leo. Cuéntame el avance, la fricción o el pendiente con el detalle que quieras; se lo dejo a Alek con contexto hoy mismo.',
          todo_bien: 'Qué bueno. Le paso a Alek que todo va en orden. Cualquier cosa que surja, me escribes por aquí y se lo pongo enfrente.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Como ya estamos trabajando juntos, Alek me pidió darle seguimiento a tu proyecto sin esperar a la siguiente reunión. ¿Hay algún avance, fricción o pendiente que quieras que le ponga enfrente hoy?`,
        metaTemplateName: 'ia360_cliente_readout', // G-COLD
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_cliente_readout:si_cuento', title: 'Sí, te cuento' },
            { id: 'seq_cliente_readout:todo_bien', title: 'Todo va bien' },
            { id: 'seq_cliente_readout:alek_directo', title: 'Que me escriba Alek' },
          ],
        },
      },
      {
        id: 'cliente_soporte',
        uiTitle: 'Soporte rápido',
        label: 'Soporte rápido',
        goal: 'resolver fricción y aprender',
        expectedSignal: 'bloqueo operativo, duda o necesidad de soporte',
        nextAction: 'Alek confirma si hay soporte pendiente antes de abrir expansión.',
        cta: 'detectar fricción concreta',
        step2: {
          hay_tema: 'Cuéntame el tema con el detalle que quieras; se lo paso a Alek hoy mismo con prioridad para que no se quede atorado.',
          todo_orden: 'Perfecto, me da gusto. Le confirmo a Alek que no hay pendientes de su lado. Aquí sigo si surge algo.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Antes de hablar de siguientes pasos en tu proyecto, Alek quiere asegurarse de que nada esté atorado de su lado. ¿Hay alguna fricción concreta que quieras que vea primero?`,
        metaTemplateName: 'ia360_cliente_soporte', // G-COLD
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_cliente_soporte:hay_tema', title: 'Sí, hay un tema' },
            { id: 'seq_cliente_soporte:todo_orden', title: 'Todo en orden' },
            { id: 'seq_cliente_soporte:alek_directo', title: 'Que me escriba Alek' },
          ],
        },
      },
      {
        id: 'cliente_expansion',
        uiTitle: 'Detectar expansión',
        label: 'Detectar expansión',
        goal: 'identificar siguiente módulo',
        expectedSignal: 'área donde el cliente ya ve oportunidad de continuidad',
        nextAction: 'Alek valida que exista adopción o evidencia antes de proponer expansión.',
        cta: 'identificar siguiente módulo con permiso',
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Te escribo de su parte porque tú y Alek ya tienen un proyecto andando, y Alek quiere ubicar dónde estaría el siguiente paso con más impacto, sin empujarte nada fuera de tiempo. De estas áreas, ¿cuál te quita más tiempo hoy?`,
        requiresLiveDeal: true,
        metaTemplateName: 'ia360_cliente_expansion', // G-COLD: en frío sale como QUICK_REPLY (la lista vive en el flujo caliente)
        openerOptions: {
          kind: 'list',
          button: 'Elegir área',
          options: [
            { id: 'seq_cliente_expansion:whatsapp', title: 'WhatsApp y mensajes' },
            { id: 'seq_cliente_expansion:crm', title: 'CRM y clientes' },
            { id: 'seq_cliente_expansion:datos', title: 'Datos y reportes' },
            { id: 'seq_cliente_expansion:agenda', title: 'Agenda y citas' },
            { id: 'seq_cliente_expansion:seguimiento', title: 'Seguimiento de ventas' },
            { id: 'seq_cliente_expansion:alek_directo', title: 'Hablar con Alek' },
          ],
        },
      },
    ],
  },
  persona_sponsor: {
    personaContext: 'Sponsor ejecutivo',
    relationshipContext: 'sponsor_ejecutivo',
    flywheelPhase: 'Attract',
    riskLevel: 'medium',
    notes: 'Traducir IA a tiempo, dinero, riesgo y conversación ejecutiva.',
    sequences: [
      {
        id: 'sponsor_diagnostico',
        uiTitle: 'Diagnóstico ejecutivo',
        label: 'Diagnóstico ejecutivo',
        goal: 'ubicar cuello que mueve tiempo/dinero',
        expectedSignal: 'cuello ejecutivo prioritario y disposición a conversar',
        nextAction: 'Alek decide si la pregunta va a operación, ventas, datos o seguimiento.',
        cta: 'detectar cuello ejecutivo',
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Alek me pidió contactarte antes de mandarte una demo genérica: prefiere ubicar primero dónde habría valor real para tu operación. De estas áreas, ¿dónde sientes el cuello de botella que más mueve la aguja?`,
        metaTemplateName: 'ia360_sponsor_diagnostico', // G-COLD
        openerOptions: {
          kind: 'list',
          button: 'Elegir área',
          options: [
            { id: 'seq_sponsor_diagnostico:operacion', title: 'Operación' },
            { id: 'seq_sponsor_diagnostico:ventas', title: 'Ventas' },
            { id: 'seq_sponsor_diagnostico:datos', title: 'Datos y reportes' },
            { id: 'seq_sponsor_diagnostico:seguimiento', title: 'Seguimiento' },
            { id: 'seq_sponsor_diagnostico:alek_directo', title: 'Hablar con Alek' },
          ],
        },
      },
      {
        id: 'sponsor_fuga_valor',
        uiTitle: 'Fuga tiempo/dinero',
        label: 'Fuga de tiempo/dinero',
        goal: 'traducir IA a impacto de negocio',
        expectedSignal: 'mención de costo, demora, retrabajo o pérdida de visibilidad',
        nextAction: 'Alek prepara una lectura de impacto antes de sugerir solución.',
        cta: 'pedir síntoma de fuga de valor',
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Cuando IA360 sí aplica, se nota en cuatro fugas: tiempo perdido en tareas manuales, seguimiento que se cae, datos poco confiables y decisiones lentas. ¿Cuál de esas te preocupa más hoy?`,
        metaTemplateName: 'ia360_sponsor_fuga_valor', // G-COLD
        openerOptions: {
          kind: 'list',
          button: 'Elegir fuga',
          options: [
            { id: 'seq_sponsor_fuga_valor:tiempo', title: 'Tiempo perdido' },
            { id: 'seq_sponsor_fuga_valor:seguimiento', title: 'Seguimiento que se cae' },
            { id: 'seq_sponsor_fuga_valor:datos', title: 'Datos poco confiables' },
            { id: 'seq_sponsor_fuga_valor:decisiones', title: 'Decisiones lentas' },
            { id: 'seq_sponsor_fuga_valor:alek_directo', title: 'Hablar con Alek' },
          ],
        },
      },
      {
        id: 'sponsor_caso_ndasafe',
        uiTitle: 'Caso NDA-safe',
        label: 'Caso NDA-safe',
        goal: 'dar prueba sin exponer clientes',
        expectedSignal: 'interés en evidencia ejecutiva sin datos sensibles',
        nextAction: 'Alek elige el caso más parecido antes de compartirlo.',
        cta: 'ofrecer prueba segura',
        step2: {
          si_manda: 'Va el caso en corto: una operación que dependía de WhatsApp y Excel perdía seguimiento y visibilidad; con IA360 los mensajes alimentan el CRM, el pipeline se mueve solo y la dirección revisa su semana en un tablero. Si quieres, Alek te aterriza el paralelo con tu operación en una llamada corta.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Si prefieres ver evidencia antes de hablar de soluciones, Alek puede compartirte un caso NDA-safe de IA360: el problema, el enfoque y el resultado esperado, sin exponer datos de ningún cliente. ¿Te lo mando?`,
        metaTemplateName: 'ia360_sponsor_caso_ndasafe', // G-COLD
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_sponsor_caso_ndasafe:si_manda', title: 'Sí, mándalo' },
            { id: 'seq_sponsor_caso_ndasafe:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_sponsor_caso_ndasafe:ahora_no', title: 'Ahora no' },
          ],
        },
      },
    ],
  },
  persona_comercial: {
    personaContext: 'Director comercial',
    relationshipContext: 'director_comercial',
    flywheelPhase: 'Attract',
    riskLevel: 'medium',
    notes: 'Centrar la conversación en fuga de leads, seguimiento y WhatsApp/CRM.',
    sequences: [
      {
        id: 'comercial_pipeline',
        uiTitle: 'Auditar pipeline',
        label: 'Auditar pipeline',
        goal: 'detectar fuga de leads',
        expectedSignal: 'fuga en generación, seguimiento, cierre o visibilidad',
        nextAction: 'Alek confirma si conviene hacer diagnóstico comercial antes de proponer.',
        cta: 'ubicar fuga principal del pipeline',
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Alek trabaja ayudando a equipos comerciales y casi siempre el problema aparece en uno de tres lugares. En tu equipo, ¿cuál duele más hoy?`,
        metaTemplateName: 'ia360_comercial_pipeline', // G-COLD
        openerOptions: {
          kind: 'list',
          button: 'Elegir',
          options: [
            { id: 'seq_comercial_pipeline:leads', title: 'Leads que no llegan' },
            { id: 'seq_comercial_pipeline:seguimiento', title: 'Seguimiento que se cae' },
            { id: 'seq_comercial_pipeline:contexto', title: 'WhatsApp sin contexto' },
            { id: 'seq_comercial_pipeline:alek_directo', title: 'Hablar con Alek' },
          ],
        },
      },
      {
        id: 'comercial_wa_crm',
        uiTitle: 'WhatsApp + CRM',
        label: 'WhatsApp + CRM',
        goal: 'mapear seguimiento y contexto',
        expectedSignal: 'dolor entre conversaciones, CRM y seguimiento comercial',
        nextAction: 'Alek revisa si el caso pide orden operativo o motor de ventas.',
        cta: 'mapear seguimiento WhatsApp/CRM',
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Muchas fugas comerciales no vienen del vendedor, sino de WhatsApp y el CRM trabajando sin contexto compartido. En tu operación, ¿qué se pierde más hoy?`,
        metaTemplateName: 'ia360_comercial_wa_crm', // G-COLD
        openerOptions: {
          kind: 'list',
          button: 'Elegir',
          options: [
            { id: 'seq_comercial_wa_crm:historial', title: 'Historial de clientes' },
            { id: 'seq_comercial_wa_crm:seguimiento', title: 'Seguimiento' },
            { id: 'seq_comercial_wa_crm:prioridad', title: 'Prioridad de leads' },
            { id: 'seq_comercial_wa_crm:datos', title: 'Datos para decidir' },
            { id: 'seq_comercial_wa_crm:alek_directo', title: 'Hablar con Alek' },
          ],
        },
      },
      {
        id: 'comercial_motor_prospeccion',
        uiTitle: 'Motor prospección',
        label: 'Motor de prospección',
        goal: 'conectar dolor con oferta concreta',
        expectedSignal: 'canal, segmento o proceso que podría convertirse en motor comercial',
        nextAction: 'Alek valida segmento y oferta antes de hablar de prospección.',
        cta: 'detectar si hay motor comercial repetible',
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Para aplicar IA360 a prospección hacen falta tres piezas: un segmento claro, un mensaje repetible y un seguimiento medible. ¿Qué parte de ese motor está más débil en tu equipo hoy?`,
        metaTemplateName: 'ia360_comercial_motor_prospeccion', // G-COLD
        openerOptions: {
          kind: 'list',
          button: 'Elegir',
          options: [
            { id: 'seq_comercial_motor_prospeccion:segmento', title: 'Segmento claro' },
            { id: 'seq_comercial_motor_prospeccion:mensaje', title: 'Mensaje repetible' },
            { id: 'seq_comercial_motor_prospeccion:seguimiento', title: 'Seguimiento medible' },
            { id: 'seq_comercial_motor_prospeccion:alek_directo', title: 'Hablar con Alek' },
          ],
        },
      },
    ],
  },
  persona_cfo: {
    personaContext: 'CFO / finanzas',
    relationshipContext: 'cfo_finanzas',
    flywheelPhase: 'Attract',
    riskLevel: 'medium',
    notes: 'Hablar de control, confiabilidad de datos, cartera, comisiones o conciliación.',
    sequences: [
      {
        id: 'cfo_control',
        uiTitle: 'Auditar control',
        label: 'Auditar control',
        goal: 'detectar pérdida de control operativo',
        expectedSignal: 'dolor de control, visibilidad o retrabajo financiero',
        nextAction: 'Alek decide si el ángulo financiero es control, cartera o comisiones.',
        cta: 'detectar punto de control débil',
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Alek trabaja con equipos de finanzas que terminan operando a mano porque no pueden confiar rápido en sus datos. En tu caso, ¿dónde está el mayor dolor hoy?`,
        metaTemplateName: 'ia360_cfo_control', // G-COLD
        openerOptions: {
          kind: 'list',
          button: 'Elegir área',
          options: [
            { id: 'seq_cfo_control:cartera', title: 'Cartera' },
            { id: 'seq_cfo_control:comisiones', title: 'Comisiones' },
            { id: 'seq_cfo_control:reportes', title: 'Reportes' },
            { id: 'seq_cfo_control:conciliacion', title: 'Conciliación' },
            { id: 'seq_cfo_control:alek_directo', title: 'Hablar con Alek' },
          ],
        },
      },
      {
        id: 'cfo_cartera_datos',
        uiTitle: 'Cartera/datos',
        label: 'Cartera/datos',
        goal: 'ubicar dinero o datos poco visibles',
        expectedSignal: 'mención de cartera, cobranza, datos dispersos o visibilidad lenta',
        nextAction: 'Alek confirma si hay un flujo de datos que se pueda ordenar sin invadir sistemas.',
        cta: 'ubicar datos financieros poco visibles',
        step2: {
          respondo: 'Te leo. Cuéntame qué información te cuesta más tener confiable y a tiempo (cartera, cobranza, reportes), y se la paso a Alek aterrizada.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Cuando la cartera o los datos viven dispersos, la decisión financiera llega tarde. ¿Qué información te cuesta más tener confiable y a tiempo?`,
        metaTemplateName: 'ia360_cfo_cartera_datos', // G-COLD
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_cfo_cartera_datos:respondo', title: 'Te respondo aquí' },
            { id: 'seq_cfo_cartera_datos:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_cfo_cartera_datos:ahora_no', title: 'Ahora no' },
          ],
        },
      },
      {
        id: 'cfo_comisiones',
        uiTitle: 'Comisiones/reglas',
        label: 'Comisiones / conciliación',
        goal: 'detectar reglas que generan errores',
        expectedSignal: 'regla manual, conciliación lenta o disputa por cálculo',
        nextAction: 'Alek valida si el caso se puede convertir en diagnóstico de reglas y datos.',
        cta: 'detectar reglas financieras propensas a error',
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. En comisiones y conciliación, el problema suele estar en reglas manuales, excepciones y datos que no cuadran. ¿Dónde se te va más tiempo revisando o corrigiendo?`,
        metaTemplateName: 'ia360_cfo_comisiones', // G-COLD
        openerOptions: {
          kind: 'list',
          button: 'Elegir',
          options: [
            { id: 'seq_cfo_comisiones:reglas', title: 'Reglas manuales' },
            { id: 'seq_cfo_comisiones:excepciones', title: 'Excepciones' },
            { id: 'seq_cfo_comisiones:datos', title: 'Datos que no cuadran' },
            { id: 'seq_cfo_comisiones:alek_directo', title: 'Hablar con Alek' },
          ],
        },
      },
    ],
  },
  persona_tecnico: {
    personaContext: 'Guardián técnico',
    relationshipContext: 'guardian_tecnico',
    flywheelPhase: 'Engage',
    riskLevel: 'medium',
    notes: 'Reducir fricción técnica con permisos, trazabilidad, integración y rollback.',
    sequences: [
      {
        id: 'tecnico_arquitectura',
        uiTitle: 'Arquitectura/permisos',
        label: 'Arquitectura y permisos',
        goal: 'explicar integración sin invadir',
        expectedSignal: 'preguntas sobre permisos, datos, sistemas o alcance técnico',
        nextAction: 'Alek prepara mapa técnico mínimo antes de pedir acceso o integración.',
        cta: 'pedir revisión de mapa de integración',
        step2: {
          mapa: 'Va el mapa corto: WhatsApp Cloud API → ForgeChat (bandeja y reglas) → n8n (orquestación) → CRM y memoria por contacto. Todo con permisos mínimos, trazabilidad de cada mensaje y aprobación humana antes de cualquier envío sensible. Si quieres el detalle técnico completo, Alek te lo manda directo.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Alek me pidió contactarte porque eres quien cuida la parte técnica, y una revisión seria de IA360 empieza por permisos, datos, trazabilidad y rollback. ¿Cómo prefieres revisarlo?`,
        metaTemplateName: 'ia360_tecnico_arquitectura', // G-COLD
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_tecnico_arquitectura:mapa', title: 'Mándame el mapa' },
            { id: 'seq_tecnico_arquitectura:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_tecnico_arquitectura:ahora_no', title: 'Ahora no' },
          ],
        },
      },
      {
        id: 'tecnico_rollback',
        uiTitle: 'Riesgos/rollback',
        label: 'Riesgos / rollback',
        goal: 'bajar objeción técnica',
        expectedSignal: 'riesgo técnico prioritario o condición para prueba segura',
        nextAction: 'Alek define guardrails técnicos antes de proponer piloto.',
        cta: 'identificar riesgo técnico principal',
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Antes de hablar de funciones, Alek quiere entender qué riesgo técnico habría que controlar primero en una integración con IA360. ¿Cuál revisarías antes que nada?`,
        metaTemplateName: 'ia360_tecnico_rollback', // G-COLD
        openerOptions: {
          kind: 'list',
          button: 'Elegir riesgo',
          options: [
            { id: 'seq_tecnico_rollback:permisos', title: 'Permisos' },
            { id: 'seq_tecnico_rollback:datos', title: 'Datos' },
            { id: 'seq_tecnico_rollback:trazabilidad', title: 'Trazabilidad' },
            { id: 'seq_tecnico_rollback:reversibilidad', title: 'Reversibilidad' },
            { id: 'seq_tecnico_rollback:dependencia', title: 'Dependencia operativa' },
            { id: 'seq_tecnico_rollback:alek_directo', title: 'Hablar con Alek' },
          ],
        },
      },
      {
        id: 'tecnico_integracion',
        uiTitle: 'Integración controlada',
        label: 'Integración controlada',
        goal: 'definir prueba segura',
        expectedSignal: 'condiciones para una prueba limitada y auditable',
        nextAction: 'Alek confirma límites de piloto antes de tocar sistemas.',
        cta: 'definir prueba técnica controlada',
        step2: {
          respondo: 'Te leo. Dime qué condición tendría que cumplirse para que la prueba te parezca segura (permisos, alcance, datos, reversibilidad) y la registro tal cual para Alek.',
        },
        draft: ({ name }) => `Hola ${name}, soy la IA de Alek. Si hacemos una prueba técnica de IA360, Alek la quiere limitada, trazable y reversible. ¿Qué condición tendría que cumplirse para que te parezca segura?`,
        metaTemplateName: 'ia360_tecnico_integracion', // G-COLD
        openerOptions: {
          kind: 'buttons',
          options: [
            { id: 'seq_tecnico_integracion:respondo', title: 'Te respondo aquí' },
            { id: 'seq_tecnico_integracion:alek_directo', title: 'Que me escriba Alek' },
            { id: 'seq_tecnico_integracion:ahora_no', title: 'Ahora no' },
          ],
        },
      },
    ],
  },
};

const IA360_TERMINAL_VCARD_CHOICES = {
  guardar: {
    personaContext: 'Solo guardar',
    relationshipContext: 'solo_guardar',
    flywheelPhase: 'Unknown',
    riskLevel: 'low',
    sequence: {
      id: 'solo_guardar',
      label: 'Captura sin acción',
      goal: 'conservar contacto sin ruido ni riesgo',
      expectedSignal: 'ninguna señal esperada; solo conservar contexto',
      nextAction: 'No contactar. Alek puede reclasificar después si existe contexto.',
      cta: 'sin CTA',
      copyStatus: 'blocked',
      draft: ({ name }) => `No se genera borrador comercial para ${name}. El contacto queda guardado sin acción externa.`,
    },
  },
  excluir: {
    personaContext: 'No contactar',
    relationshipContext: 'no_contactar',
    flywheelPhase: 'Unknown',
    riskLevel: 'high',
    sequence: {
      id: 'no_contactar',
      label: 'Bloqueo',
      goal: 'respetar exclusión y evitar secuencia comercial',
      expectedSignal: 'ninguna; bloqueo operativo',
      nextAction: 'Mantener exclusión. No crear secuencia ni oportunidad comercial.',
      cta: 'sin CTA',
      copyStatus: 'blocked',
      draft: ({ name }) => `No se genera borrador comercial para ${name}. El contacto queda marcado como no contactar.`,
    },
  },
};

function findIa360SequenceFlow(sequenceId) {
  const target = String(sequenceId || '').toLowerCase();
  for (const flow of Object.values(IA360_PERSONA_SEQUENCE_FLOWS)) {
    const sequence = flow.sequences.find(s => s.id === target);
    if (sequence) return { flow, sequence };
  }
  return null;
}

function compactForWhatsApp(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function hasUnresolvedIa360Placeholder(text) {
  return /\{\{\s*(?:\d+|nombre|referidor)[^}]*\}\}|\{\{[^}]+\}\}/i.test(String(text || ''));
}

// Openers v2: saludo con primer nombre (D9). Limpia el sufijo de QA y toma el
// primer token; si no hay nada usable devuelve el valor original.
function ia360FirstNameFrom(name) {
  const raw = String(name || '').trim().replace(/\s+WhatsApp IA360$/i, '').trim();
  return raw.split(/\s+/).filter(Boolean)[0] || raw;
}

// Openers v2: arma el objeto `interactive` de un opener desde sequence.openerOptions
// (kind 'buttons' ≤3 opciones, kind 'list' 4+). Sin header ni footer: el copy
// aprobado por Alek va fiel en body.text. Devuelve null si la secuencia no tiene
// openerOptions (esas siguen saliendo como texto plano).
function buildIa360OpenerInteractive({ sequence, bodyText }) {
  const opts = sequence && sequence.openerOptions;
  if (!opts || !Array.isArray(opts.options) || !opts.options.length) return null;
  if (opts.kind === 'list') {
    return {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: opts.button || 'Elegir',
        sections: [{
          title: 'Opciones',
          rows: opts.options.map(o => ({ id: o.id, title: o.title, ...(o.description ? { description: o.description } : {}) })),
        }],
      },
    };
  }
  return {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: opts.options.slice(0, 3).map(o => ({ type: 'reply', reply: { id: o.id, title: o.title } })),
    },
  };
}

// ── G-C: ruteo real de respuestas seq_* (openers v2) ─────────────────────────
// Un botón/fila `seq_<secuencia>:<opcion>` del catálogo persona-first SIEMPRE
// recibe un siguiente paso real: paso 2 definido en el catálogo (`step2`),
// manejo semántico compartido (alek_directo / ahora_no / horarios) o acuse
// específico con eco de la elección + aviso al owner con la nextAction de la
// secuencia. Devuelve true si lo manejó; false SOLO para ids seq_* que no están
// en el catálogo (esos sí caen al fallback global, porque son inválidos).
async function handleIa360SequenceReply({ record, replyId, contact = null }) {
  const m = /^seq_([a-z0-9_]+):([a-z0-9_]+)$/.exec(String(replyId || '').trim().toLowerCase());
  if (!m) return false;
  const sequenceId = m[1];
  const optionKey = m[2];
  const found = findIa360SequenceFlow(sequenceId);
  if (!found) return false;
  const { flow, sequence } = found;
  // G8: aliado_socio / referido_bni → pipeline "Partners / Aliados (BNI)" (id 6);
  // el resto de personas (cliente, beta, sponsor, …) sigue en el Revenue genérico.
  const dealPipelineName = ia360PipelineForRelationship(flow?.relationshipContext);
  const option = (sequence.openerOptions?.options || [])
    .find(o => String(o.id).toLowerCase() === `seq_${sequenceId}:${optionKey}`);
  if (!option) return false;
  try {
    const ctx = contact || await loadIa360ContactContext(record).catch(() => null);
    const cf = ctx?.custom_fields || {};
    const contactName = ctx?.name || record.contact_name || record.contact_number;
    const safeName = sanitizeIa360IntroName(contactName) || record.contact_number;
    const nowIso = new Date().toISOString();

    // Guard de estado (paridad con el router 100M): si la conversación ya avanzó
    // a agenda/reunión/handoff humano, un botón seq_* de un opener viejo NO mueve
    // el deal hacia atrás; responde continuidad y el owner se entera del tap.
    const guard = await ia360HundredMAdvancedGuard(record);
    if (guard.advanced) {
      await enqueueIa360Text({ record, label: `ia360_seq_continuity_${sequenceId}`, body: guard.body });
      await sendIa360DirectText({
        record,
        toNumber: IA360_OWNER_NUMBER,
        label: `owner_seq_stale_${sequenceId}`,
        body: `Alek, ${safeName} (${record.contact_number}) tocó "${option.title}" de un opener viejo ("${sequence.label}"), pero su proceso ya va más adelante. No moví nada; le respondí con continuidad.`,
        targetContact: record.contact_number,
        ownerBudget: true,
      }).catch(e => console.error('[ia360-seq] stale notify:', e.message));
      return true;
    }

    // Dedupe de doble tap del contacto: misma secuencia+opción ya registrada →
    // continuidad corta, sin re-registro ni avisos duplicados al owner.
    const prev = cf.ia360_seq_last_response || null;
    if (prev && prev.sequence === sequenceId && prev.option === optionKey) {
      await enqueueIa360Text({
        record,
        label: `ia360_seq_dup_${sequenceId}`,
        body: `Ya tengo registrada tu respuesta "${option.title}" y Alek ya tiene el contexto. Quedo al pendiente; cualquier cosa me escribes por aquí.`,
      });
      return true;
    }

    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['ia360-seq-respuesta', `seq-${sequenceId}`],
      customFields: {
        ia360_seq_last_response: { sequence: sequenceId, option: optionKey, title: option.title, at: nowIso },
        ia360_ultima_respuesta: option.title,
        ultimo_cta_enviado: `ia360_seq_reply_${sequenceId}_${optionKey}`,
      },
    }).catch(e => console.error('[ia360-seq] merge state:', e.message));

    const notifyOwner = (detalle) => sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: `owner_seq_reply_${sequenceId}`,
      body: `Alek, ${safeName} (${record.contact_number}) respondió "${option.title}" al opener "${sequence.label}". ${detalle}`,
      targetContact: record.contact_number,
      ownerBudget: true,
    }).catch(e => console.error('[ia360-seq] notify owner:', e.message));

    // 1) Salida directa con Alek.
    if (optionKey === 'alek_directo') {
      await enqueueIa360Text({
        record,
        label: `ia360_seq_alek_directo_${sequenceId}`,
        body: 'Perfecto, le aviso a Alek ahora mismo para que te escriba directo. Gracias por responder.',
      });
      await syncIa360Deal({
        record,
        targetStageName: 'Requiere Alek',
        titleSuffix: sequence.label,
        notes: `Respuesta al opener ${sequence.id}: pidió hablar directo con Alek.`,
        pipelineName: dealPipelineName,
      }).catch(e => console.error('[ia360-seq] deal alek_directo:', e.message));
      await notifyOwner('Pidió que le escribas TÚ directo. Deal en "Requiere Alek".');
      return true;
    }

    // 2) Cierre suave → nutrición.
    if (optionKey === 'ahora_no') {
      await enqueueIa360Text({
        record,
        label: `ia360_seq_ahora_no_${sequenceId}`,
        body: 'De acuerdo, no te insisto. Si más adelante quieres retomarlo, me escribes por aquí y seguimos donde lo dejamos.',
      });
      await mergeContactIa360State({
        waNumber: record.wa_number,
        contactNumber: record.contact_number,
        tags: ['nutricion-suave'],
        customFields: {},
      }).catch(e => console.error('[ia360-seq] tag nutricion:', e.message));
      await syncIa360Deal({
        record,
        targetStageName: 'Nutrición',
        titleSuffix: sequence.label,
        notes: `Respuesta al opener ${sequence.id}: ahora no. Pasa a nutrición suave.`,
        pipelineName: dealPipelineName,
      }).catch(e => console.error('[ia360-seq] deal ahora_no:', e.message));
      await notifyOwner('Respondió que ahora no; queda en nutrición suave.');
      return true;
    }

    // 3) Agenda con permiso (referido_permiso_agenda:horarios).
    if (optionKey === 'horarios') {
      await enqueueIa360Interactive({
        record,
        label: `ia360_seq_horarios_${sequenceId}`,
        messageBody: 'IA360: preferencia para agendar',
        interactive: {
          type: 'button',
          body: { text: 'Perfecto. ¿Qué ventana te acomoda mejor para la llamada con Alek?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'sched_today', title: 'Hoy' } },
              { type: 'reply', reply: { id: 'sched_tomorrow', title: 'Mañana' } },
              { type: 'reply', reply: { id: 'sched_week', title: 'Esta semana' } },
            ],
          },
        },
      });
      await syncIa360Deal({
        record,
        targetStageName: 'Agenda en proceso',
        titleSuffix: sequence.label,
        notes: `Respuesta al opener ${sequence.id}: pidió horarios. Deal a "Agenda en proceso".`,
        pipelineName: dealPipelineName,
      }).catch(e => console.error('[ia360-seq] deal horarios:', e.message));
      await notifyOwner('Pidió horarios para una llamada contigo. Deal en "Agenda en proceso".');
      return true;
    }

    // 4) Paso 2 definido en el catálogo.
    const step2 = sequence.step2 && sequence.step2[optionKey];
    if (step2) {
      await enqueueIa360Text({
        record,
        label: `ia360_seq_step2_${sequenceId}_${optionKey}`,
        body: step2,
      });
      await syncIa360Deal({
        record,
        targetStageName: 'Intención detectada',
        titleSuffix: sequence.label,
        notes: `Respuesta al opener ${sequence.id}: "${option.title}". Paso 2 de la secuencia enviado.`,
        pipelineName: dealPipelineName,
      }).catch(e => console.error('[ia360-seq] deal step2:', e.message));
      await notifyOwner(`Le envié el paso 2 de la secuencia. Next action sugerida: ${sequence.nextAction}`);
      return true;
    }

    // 5) Sin paso 2 en el catálogo (temas de lista): acuse específico con eco de
    // la elección + aviso al owner con la respuesta y la next action sugerida.
    await enqueueIa360Text({
      record,
      label: `ia360_seq_ack_${sequenceId}_${optionKey}`,
      body: `Gracias, registré tu respuesta: "${option.title}". Le paso este contexto a Alek para que el siguiente paso vaya directo a eso, sin rodeos. Te escribe él con una propuesta concreta.`,
    });
    await syncIa360Deal({
      record,
      targetStageName: 'Intención detectada',
      titleSuffix: sequence.label,
      notes: `Respuesta al opener ${sequence.id}: "${option.title}". Acuse enviado; siguiente paso con Alek.`,
      pipelineName: dealPipelineName,
    }).catch(e => console.error('[ia360-seq] deal ack:', e.message));
    await notifyOwner(`Next action sugerida: ${sequence.nextAction}`);
    return true;
  } catch (err) {
    console.error('[ia360-seq] reply error:', err.message);
    // Nunca mudo: acuse mínimo aunque el registro haya fallado.
    await enqueueIa360Text({
      record,
      label: 'ia360_seq_ack_error',
      body: 'Recibí tu respuesta y ya se la pasé a Alek. Te escribe él en corto.',
    }).catch(() => {});
    return true;
  }
}

// ── G-C: CTAs únicos — alias de botones de template (quick replies de texto) ──
// Los templates fríos (p. ej. ia360_referido_apertura = template 41,
// ia360_aliado_mapa_colaboracion = template 43) llegan con button.payload =
// TEXTO del botón, no un id estructurado, por lo que "Sí, cuéntame" era ambiguo
// entre Revenue OS y Referidos. Revenue OS se resuelve ANTES en el dispatch
// (handleRevenueOsButton, gateado por ia360_revenue_state); si no era suyo, este
// alias traduce el texto al id seq_* ÚNICO de la secuencia persona-first cuyo
// opener realmente se le envió al contacto (pf.sequence_candidate.id + pf.send).
const IA360_SEQ_ALIAS_NEGATIVE = new Set(['ahora no', 'por ahora no', 'no por ahora']);
const IA360_SEQ_ALIAS_HANDOFF = new Set(['que me escriba alek', 'hablar con alek']);
// Solo frases genuinamente afirmativas. Los títulos exactos del catálogo
// ("Proponme horarios", "Te respondo aquí", "Hazme una pregunta", etc.) se
// resuelven ANTES por match exacto de título (paso 1 del resolver), no por
// semántica: ponerlos aquí fabricaría elecciones equivocadas. Estos sets solo
// aplican cuando el texto del botón NO coincide con ningún título del opener.
const IA360_SEQ_ALIAS_AFFIRMATIVE = new Set([
  'sí, cuéntame', 'si, cuéntame', 'sí, cuentame', 'si, cuentame',
  'sí, cuéntame más', 'si, cuentame mas',
  'sí, pregúntame', 'si, preguntame',
  'sí, mándalo', 'si, mandalo',
  'sí, compártelo', 'si, compartelo',
  'sí, a ver', 'si, a ver',
  'sí, te cuento', 'si, te cuento',
  'sí, hay un tema', 'si, hay un tema',
  'me interesa', 'sí, me interesa', 'si, me interesa',
]);

function resolveIa360TemplateButtonAlias({ replyId, contact }) {
  const key = String(replyId || '').trim().toLowerCase();
  if (!key || key.startsWith('seq_')) return null;
  const pf = contact?.custom_fields?.ia360_persona_first;
  const seqId = pf?.sequence_candidate?.id;
  if (!seqId || !pf?.send?.sent_at) return null; // solo si su opener realmente salió
  const found = findIa360SequenceFlow(seqId);
  if (!found) return null;
  const opts = found.sequence.openerOptions?.options || [];
  // 1) Match exacto por título visible del botón — ANTES del gate semántico:
  // los botones legítimos de los templates fríos ("Hazme una pregunta",
  // "Te respondo aquí", "Todo va bien", "Mándame el mapa", "Proponme
  // horarios"...) rutean por su propio título aunque no estén en los sets.
  const byTitle = opts.find(o => String(o.title).trim().toLowerCase() === key);
  if (byTitle) return String(byTitle.id).toLowerCase();
  // 2) Gate semántico, solo si no hubo match por título.
  const isNeg = IA360_SEQ_ALIAS_NEGATIVE.has(key);
  const isHand = IA360_SEQ_ALIAS_HANDOFF.has(key);
  const isAff = IA360_SEQ_ALIAS_AFFIRMATIVE.has(key);
  if (!isNeg && !isHand && !isAff) return null;
  // 3) Por semántica: negativo → ahora_no; handoff → alek_directo; afirmativo →
  // la primera opción que no sea ninguna de las dos (el camino afirmativo).
  const bySuffix = (suffix) => opts.find(o => String(o.id).toLowerCase().endsWith(`:${suffix}`));
  if (isNeg) { const o = bySuffix('ahora_no'); return o ? String(o.id).toLowerCase() : null; }
  if (isHand) { const o = bySuffix('alek_directo'); return o ? String(o.id).toLowerCase() : null; }
  // Afirmativo SOLO cuando es inequívoco: la secuencia declara su opción de
  // template (templateAliasOption) o existe exactamente UNA opción no terminal.
  // Con varias opciones posibles (listas de temas) NO se fabrica una elección:
  // se devuelve null y el fallback global acusa recibo y avisa al owner.
  if (found.sequence.templateAliasOption) {
    const o = bySuffix(found.sequence.templateAliasOption);
    if (o) return String(o.id).toLowerCase();
  }
  const nonTerminal = opts.filter(o => {
    const id = String(o.id).toLowerCase();
    return !id.endsWith(':ahora_no') && !id.endsWith(':alek_directo');
  });
  return nonTerminal.length === 1 ? String(nonTerminal[0].id).toLowerCase() : null;
}

// ── G-C: anti-loop del router 100M ───────────────────────────────────────────
// Nodos que en las pruebas reales generaron ciclos (doc 2026-06-10, chat_history
// 1068-1079 y 1135-1142): exploración, mecanismos, mapa y ejemplo. Una visita
// repetida ya no reenvía el bloque completo: responde una versión condensada con
// salidas terminales (agendar / llamada / más adelante).
const IA360_100M_LOOP_PRONE = new Set([
  'explorando',
  'mecanismo-whatsapp-crm',
  'mecanismo-erp-bi',
  'mecanismo-agentic-followup',
  'mapa-30-60-90-solicitado',
  'ejemplo-solicitado',
]);
// Etapas donde la conversación ya avanzó a agenda/handoff humano: un botón 100M
// de un mensaje viejo NO debe reabrir la rama (guard de estado/versión).
const IA360_100M_ADVANCED_STAGES = new Set(['Agenda en proceso', 'Reunión agendada', 'Requiere Alek']);

async function ia360HundredMAdvancedGuard(record) {
  const out = { advanced: false, body: '', visited: {}, visitedOk: false };
  try {
    const contact = await loadIa360ContactContext(record).catch(() => null);
    const cf = contact?.custom_fields || {};
    if (contact) {
      out.visited = (cf.ia360_100m_visited && typeof cf.ia360_100m_visited === 'object') ? cf.ia360_100m_visited : {};
      out.visitedOk = true; // lectura confiable: se puede escribir sin pisar el mapa
    }
    // Solo reuniones FUTURAS cuentan como "en curso": el cache crudo ia360_bookings
    // conserva citas pasadas y atraparía al contacto para siempre.
    const bookings = await loadIa360BookingsForList(record.contact_number).catch(() => []);
    const hasBooking = Array.isArray(bookings) && bookings.length > 0;
    let stageName = '';
    const deal = await getActiveNonTerminalIa360Deal(record).catch(() => null);
    if (deal) stageName = deal.stage_name || '';
    if (hasBooking || IA360_100M_ADVANCED_STAGES.has(stageName)) {
      out.advanced = true;
      out.body = (hasBooking || stageName === 'Reunión agendada')
        ? 'Vi tu respuesta, pero tu proceso ya va más adelante: tienes una reunión en curso con Alek. Sigo con eso para no regresarte al inicio. Si quieres mover la reunión o retomar otro tema, dímelo por aquí.'
        : 'Vi tu respuesta a un mensaje anterior, pero tu proceso ya va más adelante: estamos en la parte de agenda con Alek. Sigo con eso para no darte vueltas; si quieres retomar otro tema, dímelo por aquí y lo vemos.';
    }
  } catch (err) {
    console.error('[ia360-100m] advanced guard:', err.message);
  }
  return out;
}

function buildIa360PersonaPayload({ record, contact, targetContact, flow, sequence, ownerAction = 'sequence_selected' }) {
  const customFields = contact?.custom_fields || {};
  const name = contact?.name || targetContact;
  // Openers v2: saludo con primer nombre (D9) + quién hizo la introducción (D6).
  const draftName = ia360FirstNameFrom(name);
  const quienIntro = String(customFields.quien_intro || '').trim() || null;
  const draft = typeof sequence.draft === 'function' ? sequence.draft({ name: draftName, quienIntro }) : String(sequence.draft || '');
  const relationshipContext = flow.relationshipContext || '';
  const isCapturedOnly = relationshipContext === 'solo_guardar';
  const isDoNotContact = relationshipContext === 'no_contactar';
  const copyStatus = isCapturedOnly
    ? 'captured_only'
    : hasUnresolvedIa360Placeholder(draft) ? 'blocked' : (sequence.copyStatus || 'draft');
  const approvalStatus = isCapturedOnly ? 'no_action' : isDoNotContact ? 'do_not_contact' : 'requires_alek';
  const approvalReason = isCapturedOnly
    ? 'Captura sin acción: no existe borrador ni intento de envío por aprobar.'
    : isDoNotContact
      ? 'Exclusión operativa: no contactar ni crear secuencia.'
      : 'Requiere aprobación humana antes de cualquier envío externo.';
  const currentBlock = isCapturedOnly
    ? 'captured_only'
    : isDoNotContact ? 'do_not_contact' : 'requires_human_approval';
  return {
    schema: 'persona_first_vcard.v1',
    request_id: `${record.message_id || 'owner'}:${targetContact}:${sequence.id}`,
    source: 'forgechat_b29_vcard_intake',
    received_at: customFields.captured_at || record.timestamp || new Date().toISOString(),
    dry_run: true,
    requires_human_approval: !(isCapturedOnly || isDoNotContact),
    owner: {
      wa_id: IA360_OWNER_NUMBER,
      role: 'Alek',
    },
    contact: {
      forgechat_contact_id: contact?.id || '',
      espo_contact_id: customFields.espo_id || '',
      wa_id: customFields.vcard_wa_id || targetContact,
      phone_e164: targetContact ? `+${targetContact}` : '',
      name,
      email: customFields.email || '',
      source_message_id: customFields.source_message_id || '',
      staged: true,
      consent_status: flow.relationshipContext === 'no_contactar' ? 'do_not_contact' : 'unknown',
    },
    identity: {
      dedupe_method: 'wa_number_contact_number',
      confidence: contact?.id ? 0.85 : 0.5,
      existing_relationship: flow.personaContext || '',
      matched_records: [],
    },
    classification: {
      persona_context: flow.personaContext,
      relationship_context: flow.relationshipContext,
      flywheel_phase: flow.flywheelPhase,
      intent: ownerAction,
      risk_level: flow.riskLevel || 'medium',
      notes: flow.notes || '',
    },
    sequence_candidate: {
      id: sequence.id,
      label: sequence.label,
      goal: sequence.goal,
      product: 'IA360',
      proof_asset: sequence.proofAsset || '',
      cta: sequence.cta || '',
      copy_status: copyStatus,
      media_status: 'not_required',
      crm_expected_state: 'no_opportunity_auto',
      draft,
    },
    approval: {
      status: approvalStatus,
      approved_by: '',
      approved_at: '',
      reason: approvalReason,
    },
    guardrail: {
      current_block: currentBlock,
      external_send_allowed: false,
      allowed_recipient: 'owner_only',
    },
    learning: {
      expected_signal: sequence.expectedSignal || '',
      response_summary: '',
      objection: '',
      next_step: sequence.nextAction || '',
      update_crm: false,
      update_memory: false,
    },
  };
}

function describeIa360CurrentBlock(payload) {
  const status = payload?.approval?.status || '';
  if (status === 'no_action') return 'captura sin acción; no hay borrador ni envío externo al contacto.';
  if (status === 'do_not_contact') return 'no contactar; exclusión operativa sin envío externo al contacto.';
  return 'requiere aprobación humana; no hay envío externo al contacto.';
}

function buildIa360SequenceReadout({ name, targetContact, flow, sequence, payload }) {
  return [
    'Readout IA360 persona-first',
    '',
    `Contacto: ${name} (${targetContact})`,
    `Persona: ${flow.personaContext}`,
    `Fase flywheel sugerida: ${flow.flywheelPhase}`,
    `Logro esperado del flujo: ${sequence.goal}`,
    `Secuencia elegida: ${sequence.label} (${sequence.id})`,
    '',
    'Borrador propuesto:',
    payload.sequence_candidate.draft,
    ...(sequence.openerOptions && Array.isArray(sequence.openerOptions.options)
      ? ['', `Opciones del mensaje (${sequence.openerOptions.kind === 'list' ? 'lista' : 'botones'}): ${sequence.openerOptions.options.map(o => o.title).join(' | ')}`]
      : []),
    '',
    `Bloqueo actual: ${describeIa360CurrentBlock(payload)}`,
    `Siguiente acción recomendada: ${sequence.nextAction || 'Alek revisa y aprueba solo si el contexto lo justifica.'}`,
  ].join('\n');
}

async function loadIa360OwnerReplyContext({ record }) {
  if (!record?.context_message_id) return { ok: false, reason: 'missing_context_message_id' };
  const { rows } = await pool.query(
    `SELECT message_id, message_body, template_meta->>'label' AS label
       FROM coexistence.chat_history
      WHERE wa_number=$1
        AND contact_number=$2
        AND direction='outgoing'
        AND message_id=$3
        AND template_meta->>'ux'='ia360_owner'
      LIMIT 1`,
    [record.wa_number, IA360_OWNER_NUMBER, record.context_message_id]
  );
  if (!rows.length) return { ok: false, reason: 'context_owner_message_not_found' };
  return { ok: true, row: rows[0], label: rows[0].label || '' };
}

async function blockIa360OwnerContextMismatch({ record, targetContact, action, reason, expectedLabel }) {
  if (targetContact) {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: targetContact,
      tags: ['ia360-owner-context-blocked'],
      customFields: {
        ia360_owner_reply_blocked_at: new Date().toISOString(),
        ia360_owner_reply_blocked_action: action || '',
        ia360_owner_reply_blocked_reason: reason || '',
        ia360_owner_reply_expected_context: expectedLabel || '',
      },
    }).catch(e => console.error('[ia360-owner-context] persist block:', e.message));
  }
  await sendIa360DirectText({
    record,
    toNumber: IA360_OWNER_NUMBER,
    label: 'owner_context_mismatch_blocked',
    body: `Bloqueé esa acción IA360 porque el botón no coincide con el mensaje/contexto esperado para ${targetContact || 'ese contacto'}. No envié nada al contacto.`,
    targetContact,
    ownerBudget: true,
  });
}

async function validateIa360OwnerContext({ record, targetContact, action, expectedLabelPrefix }) {
  if (normalizePhone(record.contact_number) !== IA360_OWNER_NUMBER) {
    return { ok: false, reason: 'not_owner_contact' };
  }
  const ctx = await loadIa360OwnerReplyContext({ record });
  if (!ctx.ok) return ctx;
  if (expectedLabelPrefix && !String(ctx.label || '').startsWith(expectedLabelPrefix)) {
    return { ok: false, reason: 'context_label_mismatch', label: ctx.label || '' };
  }
  return { ok: true, label: ctx.label || '', row: ctx.row };
}

async function persistIa360PersonaPayload({ record, targetContact, flow, sequence, payload, tags = [] }) {
  const stage =
    flow.relationshipContext === 'no_contactar' ? 'No contactar'
      : flow.relationshipContext === 'solo_guardar' ? 'Capturado / Sin acción'
        : sequence.id === 'persona_selected' ? 'Persona seleccionada / Por secuencia'
          : 'Requiere Alek';
  await mergeContactIa360State({
    waNumber: record.wa_number,
    contactNumber: targetContact,
    tags: ['ia360-persona-first', `persona:${flow.relationshipContext}`, `sequence:${sequence.id}`, ...tags],
    customFields: {
      staged: true,
      stage,
      persona_context: flow.personaContext,
      fase_flywheel: flow.flywheelPhase,
      sequence_candidate: sequence.id,
      owner_action: payload.classification.intent,
      owner_action_at: new Date().toISOString(),
      ia360_persona_first: payload,
    },
  });
}

// G-D: pipelines donde un deal vivo habilita la jugada de expansión (D7).
const IA360_EXPANSION_PIPELINES = ['IA360 WhatsApp Revenue Pipeline', 'Champions — Adopción y expansión'];

// G-COLD: status real en Meta de los templates fríos, en UNA sola consulta.
// Si un nombre tiene varias filas gana APPROVED si alguna lo está (mismo
// criterio que enqueueIa360Template); si no, la más reciente por updated_at.
// En error de DB devuelve NULL (no {}): un {} significaría "template
// inexistente" y daría diagnóstico falso. Cada call site decide: la UX sale
// sin marcas (fail-open) y el envío se bloquea con aviso honesto (fail-closed).
async function loadIa360ColdTemplateStatuses(names) {
  const list = [...new Set((names || []).filter(Boolean).map(String))];
  if (!list.length) return {};
  try {
    const { rows } = await pool.query(
      `SELECT name, status
         FROM coexistence.message_templates
        WHERE name = ANY($1)
        ORDER BY updated_at DESC NULLS LAST, id DESC`,
      [list]
    );
    const out = {};
    for (const row of rows) {
      if (String(out[row.name] || '').toUpperCase() === 'APPROVED') continue;
      if (String(row.status || '').toUpperCase() === 'APPROVED') { out[row.name] = row.status; continue; }
      if (!(row.name in out)) out[row.name] = row.status; // primera fila = más reciente
    }
    return out;
  } catch (e) {
    console.error('[ia360-cold] template statuses lookup:', e.message);
    return null;
  }
}

// G-COLD: traduce el status de Meta a disponibilidad para envío en frío.
function ia360ColdAvailability(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'APPROVED') return { sendable: true, label: '✓ lista para frío' };
  if (['PENDING', 'SUBMITTED', 'IN_REVIEW'].includes(s)) return { sendable: false, label: 'template en revisión Meta' };
  if (s === 'REJECTED') return { sendable: false, label: 'template rechazado por Meta' };
  return { sendable: false, label: 'sin template frío' };
}

// G-COLD: ¿el contacto está fuera de la ventana de servicio de 24h? Mismo
// umbral 23.5h que approve-send. Error o cuenta sin resolver → {known:false}
// (fail-open: la UX del selector nunca debe romperse por esta verificación).
async function ia360OutsideWindow24h({ record, targetContact }) {
  try {
    const { account, error } = await resolveAccount({ fromPhoneNumber: record.wa_number });
    if (error || !account) return { known: false, outside: false };
    const secs = await secondsSinceLastIncoming({ accountPhoneNumberId: account.phoneNumberId, contactNumber: targetContact });
    return { known: true, outside: !(secs != null && secs < 23.5 * 3600) };
  } catch (e) {
    console.error('[ia360-cold] window check:', e.message);
    return { known: false, outside: false };
  }
}

// G-D: señales reales del contacto para el ranker del selector de secuencias.
// Cada consulta tiene su propio try/catch (fail-open): si la DB falla, esa señal
// queda en null y el selector sale con el orden default — nunca mudo.
// OJO: ia360_memory_* tiene doble keying en contact_wa_number (a veces la línea
// del bot, a veces el número del contacto); la llave confiable es contact_number.
async function gatherIa360ContactSignals({ waNumber, contactNumber }) {
  const signals = { liveDeal: null, quienIntro: null, lastFact: null, lastEvent: null, lastIncomingAt: null };
  try {
    const { rows } = await pool.query(
      `SELECT d.title, p.name AS pipeline_name, s.name AS stage_name
         FROM coexistence.deals d
         JOIN coexistence.pipelines p ON p.id = d.pipeline_id
         JOIN coexistence.pipeline_stages s ON s.id = d.stage_id
        WHERE d.contact_wa_number = $1 AND d.contact_number = $2 AND d.status = 'open'
        ORDER BY d.updated_at DESC NULLS LAST, d.id DESC
        LIMIT 1`,
      [waNumber, contactNumber]
    );
    if (rows.length) signals.liveDeal = { title: rows[0].title, pipelineName: rows[0].pipeline_name, stageName: rows[0].stage_name };
  } catch (e) { console.error('[ia360-rank] deal lookup:', e.message); }
  try {
    const { rows } = await pool.query(
      `SELECT custom_fields->>'quien_intro' AS quien_intro, custom_fields->>'referido_por' AS referido_por
         FROM coexistence.contacts
        WHERE wa_number = $1 AND contact_number = $2
        LIMIT 1`,
      [waNumber, contactNumber]
    );
    const quienIntro = String(rows[0]?.quien_intro || '').trim();
    if (quienIntro) {
      signals.quienIntro = quienIntro;
    } else {
      // referido_por guarda el NÚMERO de quien compartió el vCard. Solo cuenta
      // como introductor si NO es el owner, ni el bot, ni el propio contacto;
      // y solo con un nombre presentable (no citamos números pelones).
      const referidoPor = normalizePhone(String(rows[0]?.referido_por || '').trim());
      if (referidoPor && referidoPor !== IA360_OWNER_NUMBER && referidoPor !== normalizePhone(waNumber) && referidoPor !== normalizePhone(contactNumber)) {
        const { rows: introRows } = await pool.query(
          `SELECT name, profile_name FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2 LIMIT 1`,
          [waNumber, referidoPor]
        );
        const introName = String(introRows[0]?.name || introRows[0]?.profile_name || '').trim();
        if (introName) signals.quienIntro = introName;
      }
    }
  } catch (e) { console.error('[ia360-rank] quien_intro lookup:', e.message); }
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(recurring_pain, preference, objection, role) AS texto, last_seen_at
         FROM coexistence.ia360_memory_facts
        WHERE contact_number = $1
          AND COALESCE(recurring_pain, preference, objection, role) IS NOT NULL
        ORDER BY last_seen_at DESC
        LIMIT 1`,
      [contactNumber]
    );
    if (rows.length) signals.lastFact = { text: rows[0].texto, lastSeenAt: rows[0].last_seen_at };
  } catch (e) { console.error('[ia360-rank] facts lookup:', e.message); }
  try {
    const { rows } = await pool.query(
      `SELECT summary, created_at
         FROM coexistence.ia360_memory_events
        WHERE contact_number = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [contactNumber]
    );
    if (rows.length) signals.lastEvent = { summary: rows[0].summary, createdAt: rows[0].created_at };
  } catch (e) { console.error('[ia360-rank] events lookup:', e.message); }
  try {
    const { rows } = await pool.query(
      `SELECT MAX(created_at) AS last_in
         FROM coexistence.chat_history
        WHERE wa_number = $1 AND contact_number = $2 AND direction = 'incoming'`,
      [waNumber, contactNumber]
    );
    if (rows[0]?.last_in) signals.lastIncomingAt = rows[0].last_in;
  } catch (e) { console.error('[ia360-rank] chat_history lookup:', e.message); }
  return signals;
}

// G-D: ranker rule-based (SIN LLM). Solo REORDENA las secuencias de la persona
// elegida; cada razón cita una señal que existe en la base. Sin señales que
// matcheen secuencias de esta persona → orden de catálogo y cero razones
// inventadas (honestidad del ranker).
function rankIa360Sequences({ flow, signals }) {
  const scores = new Map();
  const reasons = new Map();
  const bump = (id, pts, reason) => {
    scores.set(id, (scores.get(id) || 0) + pts);
    if (reason && !reasons.has(id)) reasons.set(id, reason);
  };
  const s = signals || {};
  if (s.liveDeal) {
    const dealReason = `Deal vivo «${s.liveDeal.title}» en ${s.liveDeal.pipelineName}`;
    if (IA360_EXPANSION_PIPELINES.includes(s.liveDeal.pipelineName)) {
      bump('cliente_expansion', 35, dealReason);
      bump('cliente_readout', 20, dealReason);
      bump('cliente_soporte', 10, dealReason);
    } else {
      bump('cliente_readout', 30, dealReason);
      bump('cliente_soporte', 20, dealReason);
    }
  }
  if (s.quienIntro) {
    const introReason = `Te lo presentó ${s.quienIntro}`;
    bump('referido_contexto', 30, introReason);
    bump('referido_permiso_agenda', 15, introReason);
    bump('referido_oneliner', 10, introReason);
  }
  const memorySignal = s.lastEvent || s.lastFact;
  if (memorySignal) {
    // 40 y no más: "Sugerida: Memoria registrada: " + frag debe caber en los
    // 72 chars de la description de Meta sin perder el final de la razón.
    const frag = compactForWhatsApp(s.lastEvent ? s.lastEvent.summary : s.lastFact.text, 40);
    const memReason = `Memoria registrada: ${frag}`;
    bump('beta_memoria', 15, memReason);
    bump('cliente_readout', 10, memReason);
  }
  const ordered = (flow.sequences || [])
    .map((seq, idx) => ({ seq, idx, score: scores.get(seq.id) || 0 }))
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  const ranked = ordered.length > 0 && ordered[0].score > 0;
  return {
    ordered: ordered.map(o => o.seq),
    suggestedId: ranked ? ordered[0].seq.id : null,
    reasonFor: (id) => reasons.get(id) || null,
    ranked,
  };
}

// G-D: resumen de 2 líneas del contacto para el cuerpo de la tarjeta. Solo
// afirma lo que existe; sin señales devuelve una sola línea honesta.
function buildIa360ContactSummaryLines(signals) {
  const s = signals || {};
  const fmtDate = (d) => {
    try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; }
  };
  if (!s.liveDeal && !s.quienIntro && !s.lastFact && !s.lastEvent) {
    return ['Aún no tengo señales registradas de este contacto (sin deal, sin memoria, sin introductor).'];
  }
  // Tope de 180: título/pipeline/etapa vienen de la base sin límite y el body
  // del interactive de Meta admite 1024 como máximo — si se excede, la tarjeta
  // se vuelve muda. Acotado aquí, el body completo queda siempre < 1024.
  const line1 = s.liveDeal
    ? compactForWhatsApp(`Deal vivo: «${s.liveDeal.title}» — ${s.liveDeal.pipelineName}${s.liveDeal.stageName ? ` / ${s.liveDeal.stageName}` : ''}.`, 180)
    : 'Sin deal vivo registrado.';
  let line2;
  if (s.lastEvent) {
    const fecha = fmtDate(s.lastEvent.createdAt);
    line2 = `Último evento${fecha ? ` (${fecha})` : ''}: ${compactForWhatsApp(s.lastEvent.summary, 120)}`;
  } else if (s.lastFact) {
    const fecha = fmtDate(s.lastFact.lastSeenAt);
    line2 = `Memoria${fecha ? ` (${fecha})` : ''}: ${compactForWhatsApp(s.lastFact.text, 120)}`;
  } else if (s.quienIntro) {
    line2 = `Lo presentó: ${s.quienIntro}.`;
  } else if (s.lastIncomingAt) {
    line2 = `Última interacción: ${fmtDate(s.lastIncomingAt)}.`;
  } else {
    line2 = 'Sin memoria registrada todavía.';
  }
  return [line1, line2];
}

async function sendIa360SequenceSelector({ record, targetContact, contact, flowKey, flow }) {
  const name = contact?.name || targetContact;
  const payload = buildIa360PersonaPayload({
    record,
    contact,
    targetContact,
    flow,
    sequence: {
      id: 'persona_selected',
      label: 'Persona seleccionada',
      goal: 'elegir una secuencia lógica por persona antes de redactar',
      expectedSignal: 'Alek selecciona el flujo correcto',
      nextAction: 'Elegir una secuencia filtrada por persona.',
      cta: 'elegir secuencia',
      copyStatus: 'draft',
      draft: () => 'Pendiente: Alek debe elegir una secuencia antes de generar borrador.',
    },
    ownerAction: 'persona_selected',
  });
  await persistIa360PersonaPayload({
    record,
    targetContact,
    flow,
    sequence: payload.sequence_candidate,
    payload,
    tags: [`persona-choice:${flowKey}`],
  });
  // G-D: ranker rule-based sobre señales reales — la sugerida primero con el
  // porqué en su descripción; sin señales → orden de catálogo sin razones.
  const signals = await gatherIa360ContactSignals({ waNumber: record.wa_number, contactNumber: targetContact });
  const ranking = rankIa360Sequences({ flow, signals });
  const summaryLines = buildIa360ContactSummaryLines(signals);
  // G-COLD: si el contacto está fuera de la ventana de 24h, cada fila antepone
  // la disponibilidad real del template frío (status en coexistence.message_templates).
  // Fail-open con try/catch: si algo falla, el selector sale como hoy y se loggea.
  let coldInfo = null;
  try {
    const win = await ia360OutsideWindow24h({ record, targetContact });
    if (win.known && win.outside) {
      const statuses = await loadIa360ColdTemplateStatuses(
        (flow.sequences || []).map(s => s.metaTemplateName).filter(Boolean)
      );
      // null = falló el lookup (≠ inexistente): selector sin marcas, como hoy.
      if (statuses === null) {
        console.error('[ia360-cold] selector: lookup de statuses falló; selector sin marcas frías');
      } else {
        coldInfo = { outsideWindow: true, statuses };
      }
    }
  } catch (e) { console.error('[ia360-cold] selector availability:', e.message); }
  const bodyText = [
    `Alek, ${name} quedó como ${flow.personaContext}.`,
    ...summaryLines,
    ...(coldInfo ? ['Fuera de ventana de 24h: solo las secuencias marcadas «lista para frío» pueden salir hoy (como template de Meta).'] : []),
    'Elige una secuencia. Sigo en dry-run: no enviaré nada al contacto.',
  ].join('\n');
  const suggestedReason = ranking.suggestedId ? ranking.reasonFor(ranking.suggestedId) : null;
  // G-COLD: las filas se calculan una sola vez — se renderizan en la tarjeta y
  // se persisten tal cual en ia360_selector_ranking.rows (auditoría 1:1).
  const selectorRows = ranking.ordered.map(seq => {
    const reason = ranking.suggestedId === seq.id ? ranking.reasonFor(seq.id) : null;
    let description;
    if (coldInfo) {
      const avail = ia360ColdAvailability(seq.metaTemplateName ? coldInfo.statuses[seq.metaTemplateName] : undefined);
      description = compactForWhatsApp(`${avail.label} · ${reason ? `Sugerida: ${reason}` : seq.goal}`, 72);
    } else {
      description = compactForWhatsApp(reason ? `Sugerida: ${reason}` : seq.goal, 72);
    }
    return {
      id: `owner_seq:${targetContact}:${seq.id}`,
      title: compactForWhatsApp(seq.uiTitle || seq.label, 24),
      description,
    };
  });
  // G-D: el ranking queda auditable en custom_fields (orden, sugerida, razón,
  // resumen) — best-effort, no bloquea el envío de la tarjeta.
  await mergeContactIa360State({
    waNumber: record.wa_number,
    contactNumber: targetContact,
    customFields: {
      ia360_selector_ranking: {
        at: new Date().toISOString(),
        persona: flowKey,
        ranked: ranking.ranked,
        suggested: ranking.suggestedId,
        reason: suggestedReason,
        order: ranking.ordered.map(seq => seq.id),
        summary: summaryLines,
        // G-COLD: filas tal como se renderizaron en la tarjeta.
        rows: selectorRows,
        ...(coldInfo ? {
          cold: {
            outside_window: true,
            availability: Object.fromEntries(
              (flow.sequences || [])
                .filter(seq => seq.metaTemplateName)
                .map(seq => {
                  const status = coldInfo.statuses[seq.metaTemplateName] || null;
                  return [seq.id, { template: seq.metaTemplateName, status, label: ia360ColdAvailability(status).label }];
                })
            ),
          },
        } : {}),
      },
    },
  }).catch(e => console.error('[ia360-rank] persist ranking:', e.message));
  return sendOwnerInteractive({
    record,
    label: `owner_sequence_selector_${targetContact}_${flowKey}`,
    messageBody: ranking.ranked
      ? `IA360: secuencias ${name} — sugerida: ${ranking.suggestedId} (${suggestedReason})`
      : `IA360: secuencias ${name}`,
    targetContact,
    ownerBudget: true,
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Elegir secuencia' },
      body: { text: bodyText },
      footer: {
        text: ranking.ranked
          ? 'Sugerida primero por señales; aprobación antes de envío'
          : 'Persona antes de secuencia; aprobación antes de envío',
      },
      action: {
        button: 'Elegir secuencia',
        sections: [{
          title: compactForWhatsApp(flow.personaContext, 24),
          // G-COLD: mismas filas que quedaron persistidas en el ranking.
          rows: selectorRows,
        }],
      },
    },
  });
}

async function handleIa360PersonaChoice({ record, targetContact, personaChoice }) {
  const flow = IA360_PERSONA_SEQUENCE_FLOWS[personaChoice];
  const contact = await loadIa360ContactForOwnerAction({ waNumber: record.wa_number, contactNumber: targetContact });
  const name = contact?.name || targetContact;
  if (!flow) {
    await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_persona_unknown', body: `No reconozco la persona elegida para ${name}. No envié nada y queda para revisión de Alek.`, targetContact, ownerBudget: true });
    return;
  }
  await sendIa360SequenceSelector({ record, targetContact, contact, flowKey: personaChoice, flow });
}

async function handleIa360OwnerSequenceChoice({ record, targetContact, sequenceId }) {
  if (!targetContact) {
    await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_sequence_missing_target', body: 'No encontré el número del contacto para esa secuencia. No envié nada.' });
    return;
  }
  const found = findIa360SequenceFlow(sequenceId);
  const contact = await loadIa360ContactForOwnerAction({ waNumber: record.wa_number, contactNumber: targetContact });
  const name = contact?.name || targetContact;
  if (!found) {
    await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_sequence_unknown', body: `La secuencia elegida para ${name} no está en el catálogo persona-first. No envié nada.`, targetContact, ownerBudget: true });
    return;
  }
  const { flow, sequence } = found;
  const ctx = await validateIa360OwnerContext({
    record,
    targetContact,
    action: 'owner_seq',
    expectedLabelPrefix: `owner_sequence_selector_${targetContact}_`,
  });
  if (!ctx.ok) {
    await blockIa360OwnerContextMismatch({
      record,
      targetContact,
      action: 'owner_seq',
      reason: ctx.reason,
      expectedLabel: `owner_sequence_selector_${targetContact}_*`,
    });
    return;
  }
  const contextFlowKey = String(ctx.label || '').slice(`owner_sequence_selector_${targetContact}_`.length);
  const contextFlow = IA360_PERSONA_SEQUENCE_FLOWS[contextFlowKey];
  const previousRel = contact?.custom_fields?.ia360_persona_first?.classification?.relationship_context || '';
  if ((contextFlow && contextFlow.relationshipContext !== flow.relationshipContext) ||
      (previousRel && previousRel !== flow.relationshipContext)) {
    await blockIa360OwnerContextMismatch({
      record,
      targetContact,
      action: 'owner_seq',
      reason: 'sequence_persona_mismatch',
      expectedLabel: `persona=${contextFlowKey || previousRel}`,
    });
    return;
  }
  const payload = buildIa360PersonaPayload({ record, contact, targetContact, flow, sequence, ownerAction: 'sequence_selected' });
  let readout = buildIa360SequenceReadout({ name, targetContact, flow, sequence, payload });
  if (hasUnresolvedIa360Placeholder(readout)) {
    payload.sequence_candidate.copy_status = 'blocked';
    payload.approval.reason = 'Borrador bloqueado por placeholder sin resolver.';
  }
  await persistIa360PersonaPayload({ record, targetContact, flow, sequence, payload, tags: ['owner-sequence-selected'] });
  // G-COLD: aviso pre-aprobación. Si el contacto está fuera de la ventana de 24h,
  // el owner debe saber ANTES de aprobar si el opener saldrá como template de
  // Meta (mismo copy, con botones) o si no puede salir nada todavía.
  // Fail-open: si la verificación falla, el readout sale como hoy.
  let coldBlocked = false;
  let coldNotice = null;
  try {
    const win = await ia360OutsideWindow24h({ record, targetContact });
    if (win.known && win.outside) {
      const tplName = sequence.metaTemplateName || null;
      if (!tplName) {
        // Defensivo: hoy las 24 secuencias tienen template mapeado, pero si una
        // nueva llega sin él, el aviso no debe imprimir «null».
        coldBlocked = true;
        readout += `\n\nAVISO: ${name} está fuera de la ventana de 24h y esta secuencia no tiene template frío mapeado. Si apruebas ahora NO puede salir nada.`;
        coldNotice = 'Fuera de ventana de 24h y sin template frío mapeado: hoy no puede salir nada.';
      } else {
        const statuses = await loadIa360ColdTemplateStatuses([tplName]);
        if (statuses === null) {
          // null = falló el lookup (≠ inexistente): sin aviso ni coldBlocked,
          // comportamiento previo; el cinturón del approve-send re-verifica.
          console.error('[ia360-cold] readout: lookup de statuses falló; readout sin aviso frío');
        } else {
          const avail = ia360ColdAvailability(statuses[tplName]);
          if (avail.sendable) {
            readout += `\n\nFuera de ventana de 24h: si apruebas, el opener saldrá como template aprobado de Meta «${tplName}» (mismo copy, con sus botones), no como texto libre.`;
            coldNotice = `Fuera de ventana de 24h: el opener saldrá como template «${tplName}».`;
          } else {
            coldBlocked = true;
            readout += `\n\nAVISO: ${name} está fuera de la ventana de 24h y el template «${tplName}» de esta secuencia aún no está aprobado por Meta (${avail.label}). Si apruebas ahora NO puede salir nada. Opciones: espera la aprobación de Meta, elige una secuencia marcada «lista para frío» o toma el contacto manual.`;
            coldNotice = `Fuera de ventana de 24h y sin template aprobado (${avail.label}): hoy no puede salir nada.`;
          }
        }
      }
    }
  } catch (e) { console.error('[ia360-cold] readout availability:', e.message); }
  // G-COLD: best-effort, solo auditoría/QA — el cinturón del approve-send
  // re-consulta el status en vivo; nadie lee este campo en runtime.
  await mergeContactIa360State({
    waNumber: record.wa_number,
    contactNumber: targetContact,
    customFields: { ia360_approve_card_cold_blocked: coldBlocked },
  }).catch(e => console.error('[ia360-cold] persist cold_blocked:', e.message));
  await sendIa360DirectText({
    record,
    toNumber: IA360_OWNER_NUMBER,
    label: `owner_sequence_readout_${sequence.id}`,
    body: readout,
    targetContact,
    ownerBudget: true,
  });
  // APPROVE-SEND: tras el readout, el owner decide con una tarjeta (mismo patrón
  // que la tarjeta de cancelación). Solo si el payload realmente requiere
  // aprobación humana (no para solo_guardar / no_contactar / copy bloqueado).
  if (payload.approval.status === 'requires_alek' && payload.sequence_candidate.copy_status !== 'blocked') {
    await sendIa360ApproveCard({ record, targetContact, name, flow, sequence, coldBlocked, coldNotice });
  }
}

// ============================================================================
// APPROVE-SEND — "último metro" del P0: el owner aprueba y el opener de la
// secuencia sale al CONTACTO (egress único vía messageSender/sendQueue).
// Gate de seguridad: solo números en IA360_APPROVE_SEND_ALLOWLIST (env, CSV).
// Sin allowlist o fuera de ella → solo readout, NUNCA envía.
// ============================================================================

function ia360ApproveSendAllowlist() {
  return String(process.env.IA360_APPROVE_SEND_ALLOWLIST || '')
    .split(',')
    .map(s => s.replace(/\D/g, ''))
    .filter(Boolean);
}

async function sendIa360ApproveCard({ record, targetContact, name, flow, sequence, coldBlocked = false, coldNotice = null }) {
  // G-COLD: con coldNotice el owner ve en la tarjeta cómo saldría el opener (o
  // por qué no puede salir); con coldBlocked se RETIRA la fila "Aprobar y
  // enviar" — el owner jamás debe poder aprobar algo imposible.
  let bodyText = `Alek, el borrador para ${name} (${flow.personaContext}, secuencia ${sequence.label}) está arriba en el readout. ¿Qué hago?`;
  if (coldNotice) bodyText += `\n${coldNotice}`;
  if (bodyText.length > 1024) bodyText = compactForWhatsApp(bodyText, 1024);
  const rows = [
    ...(coldBlocked ? [] : [{ id: `owner_approve_send:${targetContact}:${sequence.id}`, title: 'Aprobar y enviar', description: 'Envío el opener al contacto y avanzo el pipeline' }]),
    { id: `owner_approve_edit:${targetContact}:${sequence.id}`, title: 'Editar copy', description: 'Queda en borrador; lo editas antes de enviar' },
    { id: `owner_approve_keep:${targetContact}:${sequence.id}`, title: 'Solo guardar', description: 'Captura sin envío ni secuencia' },
    { id: `owner_approve_dnc:${targetContact}:${sequence.id}`, title: 'No contactar', description: 'Exclusión operativa, sin envío' },
    { id: `owner_approve_manual:${targetContact}:${sequence.id}`, title: 'Tomar manual', description: 'Tú le escribes; muevo el deal a Requiere Alek' },
  ];
  return sendOwnerInteractive({
    record,
    label: `owner_approve_card_${targetContact}_${sequence.id}`,
    messageBody: `IA360: aprobar envío a ${name}`,
    targetContact,
    ownerBudget: true,
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Aprobar envío' },
      body: { text: bodyText },
      footer: { text: 'Solo envío con tu aprobación explícita' },
      action: {
        button: 'Decidir',
        sections: [{
          title: 'Acciones',
          rows,
        }],
      },
    },
  });
}

async function ia360ApproveSendDeny({ record, targetContact, reason, body }) {
  if (targetContact) {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: targetContact,
      tags: ['ia360-approve-send-blocked'],
      customFields: {
        ia360_approve_send_blocked_at: new Date().toISOString(),
        ia360_approve_send_blocked_reason: reason,
      },
    }).catch(e => console.error('[ia360-approve] persist deny:', e.message));
  }
  console.warn('[ia360-approve] blocked target=%s reason=%s', targetContact || '-', reason);
  await sendIa360DirectText({
    record,
    toNumber: IA360_OWNER_NUMBER,
    label: 'owner_approve_send_blocked',
    body,
    targetContact,
    ownerBudget: true,
  });
}

async function handleIa360OwnerApproveSend({ record, targetContact, sequenceId }) {
  const deny = (reason, body) => ia360ApproveSendDeny({ record, targetContact, reason, body });
  if (!targetContact) return deny('missing_target', 'No encontré el número del contacto de esa aprobación. No envié nada.');
  if (isIa360OwnerNumber(targetContact)) return deny('target_is_owner', 'Ese número es el tuyo (owner). No envío secuencias al owner.');
  if (normalizePhone(targetContact) === normalizePhone(record.wa_number)) return deny('target_is_system_number', 'Ese número es el del propio bot. No envié nada.');

  const found = findIa360SequenceFlow(sequenceId);
  if (!found) return deny('unknown_sequence', `La secuencia "${sequenceId}" no está en el catálogo persona-first. No envié nada.`);
  const { flow, sequence } = found;

  // Contexto: el tap debe responder a la tarjeta de aprobación de ESTE contacto+secuencia.
  const ctx = await validateIa360OwnerContext({
    record,
    targetContact,
    action: 'owner_approve_send',
    expectedLabelPrefix: `owner_approve_card_${targetContact}_`,
  });
  if (!ctx.ok) {
    await blockIa360OwnerContextMismatch({
      record,
      targetContact,
      action: 'owner_approve_send',
      reason: ctx.reason,
      expectedLabel: `owner_approve_card_${targetContact}_${sequenceId}`,
    });
    return;
  }
  const cardSeq = String(ctx.label || '').slice(`owner_approve_card_${targetContact}_`.length);
  if (cardSeq !== String(sequenceId)) {
    await blockIa360OwnerContextMismatch({
      record,
      targetContact,
      action: 'owner_approve_send',
      reason: 'card_sequence_mismatch',
      expectedLabel: `owner_approve_card_${targetContact}_${sequenceId}`,
    });
    return;
  }

  const contact = await loadIa360ContactForOwnerAction({ waNumber: record.wa_number, contactNumber: targetContact });
  if (!contact) return deny('contact_not_found', `No encontré al contacto ${targetContact} en la base. No envié nada.`);
  const name = contact.name || targetContact;

  // do_not_contact: por tag o por estado persona-first previo.
  const { rows: dncRows } = await pool.query(
    `SELECT (tags ? 'no-contactar') AS dnc FROM coexistence.contacts WHERE wa_number=$1 AND contact_number=$2 LIMIT 1`,
    [record.wa_number, targetContact]
  );
  const pf = contact.custom_fields?.ia360_persona_first || null;
  if (dncRows[0]?.dnc || pf?.classification?.relationship_context === 'no_contactar' || pf?.contact?.consent_status === 'do_not_contact') {
    return deny('do_not_contact', `${name} está marcado como NO CONTACTAR. No envié nada.`);
  }

  // El estado persistido debe coincidir con el último readout (misma secuencia).
  if (!pf || pf.sequence_candidate?.id !== String(sequenceId)) {
    return deny('readout_state_mismatch', `El estado guardado de ${name} no coincide con el último readout (${sequenceId}). Repite la selección de secuencia. No envié nada.`);
  }
  if (pf.sequence_candidate.copy_status === 'blocked') {
    return deny('copy_blocked', `El borrador de ${name} está bloqueado (placeholder sin resolver). No envié nada.`);
  }

  // G-C: dedupe de doble tap. Si esta misma secuencia ya fue aprobada y su envío
  // ya salió SIN fallar, un segundo tap de la tarjeta NO debe generar otro egress.
  // Un envío fallido NO bloquea: el owner puede reintentar con la misma tarjeta.
  if (pf.approval?.status === 'approved' && pf.send?.sent_at && String(pf.send.send_status || '').toLowerCase() !== 'failed' && !pf.send.error) {
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'owner_approve_send_dup',
      body: `Ese opener ("${sequence.label}") ya se había enviado a ${name} (${pf.send.sent_at}). Detecté un doble tap y no envié nada nuevo.`,
      targetContact,
      ownerBudget: true,
    });
    return;
  }

  // GUARDIA cliente_expansion (D7): la secuencia presupone un proyecto andando.
  // Solo dispara si el contacto tiene un deal vivo (status='open') en P2 (IA360
  // WhatsApp Revenue Pipeline) o P7 (Champions). Sin deal vivo → bloquear con aviso.
  // G-C: con try/catch — si la consulta falla, el owner se entera (nunca mudo) y
  // NO se envía nada (fail-closed).
  if (sequence.requiresLiveDeal) {
    let liveRows;
    try {
      ({ rows: liveRows } = await pool.query(
        `SELECT 1
           FROM coexistence.deals d
           JOIN coexistence.pipelines p ON p.id = d.pipeline_id
          WHERE p.name IN ('IA360 WhatsApp Revenue Pipeline', 'Champions — Adopción y expansión')
            AND d.contact_wa_number = $1
            AND d.contact_number = $2
            AND d.status = 'open'
          LIMIT 1`,
        [record.wa_number, targetContact]
      ));
    } catch (liveErr) {
      console.error('[ia360-approve] live deal check failed:', liveErr.message);
      return deny('live_deal_check_failed', `No pude verificar si ${name} tiene un proyecto activo (error de base de datos). Por seguridad no envié nada; reintenta en un momento.`);
    }
    if (!liveRows.length) {
      return deny('no_live_deal', `${name} no tiene un proyecto activo (deal vivo en P2/P7). La secuencia ${sequence.id} solo aplica a clientes con proyecto en curso; elige otra secuencia. No envié nada.`);
    }
  }

  // G-BRAIN: un tap de aprobación SINTÉTICO (harness E2E) solo puede disparar
  // envíos a números QA o al owner. Un harness con un vCard de contacto REAL
  // (clase incidente José Ramón) se detiene aquí, en el último metro.
  if (isIa360SyntheticWamid(record.message_id)
      && !(IA360_QA_NUMBER_RE.test(normalizePhone(targetContact)) || normalizePhone(targetContact) === IA360_OWNER_NUMBER)) {
    return deny('synthetic_approve_real_contact', `Gate QA: la aprobación vino de un payload sintético del harness y ${name} (${targetContact}) es un contacto real. No envié nada.`);
  }

  // GATE DE SEGURIDAD: allowlist de prueba. Sin allowlist o fuera de ella → NO envía.
  // '*' = la aprobación explícita del owner autoriza a cualquier contacto.
  const allowRaw = String(process.env.IA360_APPROVE_SEND_ALLOWLIST || '').trim();
  const allow = ia360ApproveSendAllowlist();
  if (allowRaw !== '*' && (!allow.length || !allow.includes(normalizePhone(targetContact)))) {
    return deny('not_in_test_allowlist', `Gate de seguridad: ${name} (${targetContact}) no está en IA360_APPROVE_SEND_ALLOWLIST. Aprobación registrada pero NO envié nada al contacto.`);
  }

  // Ventana de servicio 24h: dentro → texto libre (el draft). Fuera → se requiere
  // template aprobado por Meta (validado vía templateValidator en enqueueIa360Template).
  // G-COLD: las 24 secuencias persona-first ya tienen metaTemplateName mapeado;
  // el deny outside_window_no_template queda solo como red de seguridad.
  const { account, error: accErr } = await resolveAccount({ fromPhoneNumber: record.wa_number });
  if (accErr || !account) return deny('account_resolve_failed', 'No pude resolver la cuenta de WhatsApp. No envié nada.');
  const secs = await secondsSinceLastIncoming({ accountPhoneNumberId: account.phoneNumberId, contactNumber: targetContact });
  const insideWindow = secs != null && secs < 23.5 * 3600;
  const targetRecord = { ...record, contact_number: targetContact, contact_name: name };
  let sendResult = { ok: false, status: 'not_sent', error: null };
  const openerLabel = `ia360_seq_opener_${sequence.id}`;
  if (insideWindow) {
    // Openers v2: dentro de ventana el opener sale como interactive (botones/lista)
    // con el copy aprobado en el readout; secuencias sin openerOptions siguen en texto.
    const openerInteractive = buildIa360OpenerInteractive({ sequence, bodyText: pf.sequence_candidate.draft });
    let sent;
    let handlerFor;
    if (openerInteractive) {
      sent = await enqueueIa360Interactive({
        record: targetRecord,
        label: openerLabel,
        messageBody: `IA360 opener: ${sequence.label}`,
        interactive: openerInteractive,
        dedupSuffix: `:opener:${targetContact}`,
      });
      handlerFor = `${record.message_id}:opener:${targetContact}`;
    } else {
      sent = await sendIa360DirectText({
        record,
        toNumber: targetContact,
        label: openerLabel,
        body: pf.sequence_candidate.draft,
      });
      // Paridad con el nuevo formato de sendIa360DirectText (incluye label).
      handlerFor = `${record.message_id}:direct:${targetContact}:${openerLabel}`;
    }
    if (!sent) return deny('enqueue_failed', `No pude encolar el opener para ${name}. No se envió.`);
    const status = await waitForIa360OutboundStatus(handlerFor);
    sendResult = { ok: String(status?.status || '').toLowerCase() === 'sent', status: status?.status || 'unknown', error: status?.error_message || null, message_id: status?.message_id || null };
  } else if (sequence.metaTemplateName) {
    // G-COLD: cinturón contra tarjetas viejas o races. La tarjeta sin la fila
    // "Aprobar y enviar" protege la UX, pero un tap sobre una tarjeta emitida
    // antes (o un cambio de status en Meta entre tarjeta y tap) llegaría hasta
    // aquí: se consulta el status REAL del template antes de encolar nada.
    const coldStatuses = await loadIa360ColdTemplateStatuses([sequence.metaTemplateName]);
    if (coldStatuses === null) {
      // null = falló la consulta (≠ template inexistente): fail-closed en el
      // envío, pero con diagnóstico honesto para el owner.
      return deny('cold_template_status_check_failed', `No pude verificar el status del template «${sequence.metaTemplateName}» en la base (error de consulta). Por seguridad no envié nada; reintenta en un momento.`);
    }
    const coldStatus = coldStatuses[sequence.metaTemplateName] || null;
    if (String(coldStatus || '').toUpperCase() !== 'APPROVED') {
      return deny('outside_window_template_not_approved', `${name} está fuera de la ventana de 24h y el template «${sequence.metaTemplateName}» de la secuencia ${sequence.id} aún no está aprobado por Meta (${coldStatus || 'inexistente'}). No envié nada.`);
    }
    // G-COLD: referido_contexto en frío necesita el {{2}} (quien_intro), igual
    // que el draft caliente lo calcula buildIa360PersonaPayload. Sin el dato,
    // el template saldría con un hueco — mejor avisar con honestidad.
    // Sanitizado vía compactForWhatsApp (colapsa espacios/saltos y topa a 60):
    // Meta rechaza parámetros con saltos de línea o 4+ espacios consecutivos.
    let templateVars = null;
    if (sequence.id === 'referido_contexto') {
      const quienIntro = compactForWhatsApp(contact.custom_fields?.quien_intro || '', 60);
      if (!quienIntro) {
        return deny('cold_send_missing_quien_intro', `El template de ${sequence.id} necesita saber quién hizo la introducción y ${name} no tiene quien_intro registrado. Captura ese dato (o elige otra secuencia) y vuelve a intentar. No envié nada.`);
      }
      templateVars = { '2': quienIntro };
    }
    // allowTextFallback:false — en frío un fallback a texto libre sería
    // rechazado por Meta y reportaría éxito falso (ver enqueueIa360Template).
    const res = await enqueueIa360Template({ record: targetRecord, label: openerLabel, templateName: sequence.metaTemplateName, vars: templateVars, allowTextFallback: false });
    sendResult = { ok: res.ok, status: res.status, error: res.error || null, message_id: null };
  } else {
    return deny('outside_window_no_template', `${name} está fuera de la ventana de 24h y la secuencia ${sequence.id} no tiene template aprobado por Meta. No envié nada.`);
  }

  // Persistencia de la aprobación + resultado del envío.
  const nowIso = new Date().toISOString();
  const pfUpdated = {
    ...pf,
    dry_run: false,
    approval: { status: 'approved', approved_by: IA360_OWNER_NUMBER, approved_at: nowIso, reason: 'Aprobado por Alek desde la tarjeta de aprobación.' },
    guardrail: { ...(pf.guardrail || {}), current_block: 'none', external_send_allowed: true, allowed_recipient: targetContact },
    send: {
      sent_at: nowIso,
      send_status: sendResult.status,
      send_mode: insideWindow ? 'text_inside_window' : 'template_outside_window',
      outbound_message_id: sendResult.message_id || null,
      error: sendResult.error || null,
    },
  };
  await mergeContactIa360State({
    waNumber: record.wa_number,
    contactNumber: targetContact,
    tags: ['ia360-approve-send', `approved-seq:${sequence.id}`],
    customFields: {
      ia360_persona_first: pfUpdated,
      approved_by: IA360_OWNER_NUMBER,
      approved_at: nowIso,
      sent_at: nowIso,
      send_status: sendResult.status,
      outbound_message_id: sendResult.message_id || null,
      // G-C: un opener nuevo abre un ciclo nuevo — la respuesta del ciclo anterior
      // no debe activar el dedupe del router seq_* (el contacto debe poder volver
      // a elegir la misma opción y recibir su paso 2).
      ia360_seq_last_response: null,
    },
  }).catch(e => console.error('[ia360-approve] persist approval:', e.message));

  if (!sendResult.ok) {
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'owner_approve_send_failed',
      body: `Aprobado, pero el envío a ${name} quedó en estado "${sendResult.status}"${sendResult.error ? ' (' + sendResult.error + ')' : ''}. Revisa chat_history; no avancé el pipeline.`,
      targetContact,
      ownerBudget: true,
    });
    return;
  }

  // Avance del pipeline: el opener salió → "Diagnóstico enviado" (genérico) o, para
  // aliado/referido BNI, "Introducción enviada" del pipeline Partners (id 6).
  await syncIa360Deal({
    record: targetRecord,
    targetStageName: 'Diagnóstico enviado',
    titleSuffix: 'Opener aprobado',
    notes: `Opener de secuencia ${sequence.id} aprobado por Alek y enviado (${insideWindow ? 'texto, ventana abierta' : 'template'}). Stage → Diagnóstico enviado.`,
    pipelineName: ia360PipelineForRelationship(flow?.relationshipContext),
  }).catch(e => console.error('[ia360-approve] syncIa360Deal:', e.message));

  await sendIa360DirectText({
    record,
    toNumber: IA360_OWNER_NUMBER,
    label: 'owner_approve_send_done',
    body: `Listo. Envié el opener de "${sequence.label}" a ${name} (${targetContact}) y moví su deal a "Diagnóstico enviado".`,
    targetContact,
    ownerBudget: true,
  });
}

async function handleIa360OwnerApproveManual({ record, targetContact }) {
  const contact = await loadIa360ContactForOwnerAction({ waNumber: record.wa_number, contactNumber: targetContact });
  const name = contact?.name || targetContact;
  await mergeContactIa360State({
    waNumber: record.wa_number,
    contactNumber: targetContact,
    tags: ['ia360-tomar-manual'],
    customFields: { ia360_owner_takeover_at: new Date().toISOString(), stage: 'Requiere Alek' },
  }).catch(e => console.error('[ia360-approve] manual persist:', e.message));
  await syncIa360Deal({
    record: { ...record, contact_number: targetContact, contact_name: name },
    targetStageName: 'Requiere Alek',
    titleSuffix: 'Tomado manual',
    notes: 'Alek tomó el contacto manualmente desde la tarjeta de aprobación. Sin envío del bot.',
    // G8: si el contacto es aliado/referido BNI, el takeover manual también cae en
    // el pipeline Partners (id 6); si no hay relación partner, queda en el genérico.
    pipelineName: ia360PipelineForRelationship(contact?.custom_fields?.relationship_context),
  }).catch(e => console.error('[ia360-approve] manual deal:', e.message));
  await sendIa360DirectText({
    record,
    toNumber: IA360_OWNER_NUMBER,
    label: 'owner_approve_manual_ack',
    body: `Ok, tú le escribes a ${name}. No envié nada y moví su deal a "Requiere Alek".`,
    targetContact,
    ownerBudget: true,
  });
}

async function handleIa360TerminalVcardChoice({ record, targetContact, terminalChoice }) {
  const terminal = IA360_TERMINAL_VCARD_CHOICES[terminalChoice];
  const contact = await loadIa360ContactForOwnerAction({ waNumber: record.wa_number, contactNumber: targetContact });
  const name = contact?.name || targetContact;
  if (!terminal) return false;
  const payload = buildIa360PersonaPayload({
    record,
    contact,
    targetContact,
    flow: terminal,
    sequence: terminal.sequence,
    ownerAction: terminalChoice === 'excluir' ? 'no_contactar_selected' : 'solo_guardar_selected',
  });
  await persistIa360PersonaPayload({
    record,
    targetContact,
    flow: terminal,
    sequence: terminal.sequence,
    payload,
    tags: terminalChoice === 'excluir' ? ['no-contactar'] : ['solo-guardar'],
  });
  const readout = buildIa360SequenceReadout({ name, targetContact, flow: terminal, sequence: terminal.sequence, payload });
  await sendIa360DirectText({
    record,
    toNumber: IA360_OWNER_NUMBER,
    label: `owner_terminal_${terminal.sequence.id}`,
    body: readout,
    targetContact,
    ownerBudget: true,
  });
  return true;
}

async function handleIa360LegacyOwnerPipeChoice({ record, targetContact, choice, contact }) {
  const name = contact?.name || targetContact;
  const legacyFlow = {
    personaContext: 'Requiere Alek',
    relationshipContext: 'legacy_button_guard',
    flywheelPhase: 'Unknown',
    riskLevel: 'high',
    notes: 'Botón heredado de pipeline o nutrición bloqueado por regla persona-first.',
  };
  const legacySequence = {
    id: `legacy_${String(choice || 'sin_ruta').replace(/[^a-z0-9_]+/g, '_')}`,
    label: `Botón heredado: ${choice || 'sin ruta'}`,
    goal: 'bloquear rutas antiguas hasta que Alek apruebe persona, secuencia y copy',
    expectedSignal: 'Alek revisa manualmente si el botón antiguo debe rediseñarse',
    nextAction: 'No usar el botón heredado. Reclasificar persona y elegir una secuencia persona-first.',
    cta: 'bloquear botón heredado',
    copyStatus: 'blocked',
    draft: () => `No se genera borrador para ${name}; el botón heredado "${choice || 'sin ruta'}" queda bloqueado.`,
  };
  const payload = buildIa360PersonaPayload({
    record,
    contact,
    targetContact,
    flow: legacyFlow,
    sequence: legacySequence,
    ownerAction: 'legacy_button_blocked',
  });
  await persistIa360PersonaPayload({
    record,
    targetContact,
    flow: legacyFlow,
    sequence: legacySequence,
    payload,
    tags: ['legacy-owner-pipe-blocked'],
  });
  await sendIa360DirectText({
    record,
    toNumber: IA360_OWNER_NUMBER,
    label: 'owner_pipe_legacy_blocked',
    body: `Botón heredado bloqueado para ${name}: ${choice || 'sin ruta'}.\n\nEstado: Requiere Alek.\nNo envié nada al contacto. No creé oportunidad comercial. Reclasifica persona y elige una secuencia persona-first si quieres preparar borrador.`,
    targetContact,
    ownerBudget: true,
  });
}

async function handleIa360SharedContacts(record) {
  if (!record || record.direction !== 'incoming' || record.message_type !== 'contacts') return false;
  try {
    const sharedContacts = extractSharedContactsFromRecord(record);
    if (!sharedContacts.length) {
      await sendIa360DirectText({
        record,
        toNumber: IA360_OWNER_NUMBER,
        label: 'owner_vcard_parse_failed',
        body: 'Recibí una tarjeta de contacto, pero no pude extraer un número de WhatsApp. Revísala manualmente.',
        ownerBudget: true,
      });
      // G-LIVE: el remitente tampoco debe quedar mudo cuando la tarjeta no se pudo leer.
      if (!isIa360OwnerNumber(record.contact_number)) {
        await enqueueIa360Text({
          record,
          label: 'ia360_vcard_ack',
          body: 'Recibí la tarjeta, pero no pude leer bien el número. Se la paso a Alek para revisarla y te confirmo por aquí.',
        }).catch(e => console.error('[ia360-vcard] parse-fail ack error:', e.message));
      }
      return true;
    }

    for (const shared of sharedContacts.slice(0, 5)) {
      if (isIa360OwnerNumber(shared.contactNumber)) {
        await recordBlockedOwnerNumberVcard({ record, shared });
        continue;
      }
      const saved = await upsertIa360SharedContact({ record, shared });
      console.log('[ia360-vcard] captured contact=%s name=%s source=%s', shared.contactNumber, shared.name || '-', record.contact_number || '-');
      const targetRecord = {
        ...record,
        contact_number: shared.contactNumber,
        contact_name: shared.name,
        message_type: 'contacts',
        message_body: `Contacto compartido por WhatsApp: ${shared.name || shared.contactNumber}`,
      };
      reflectIa360ToEspoCrm({
        record: targetRecord,
        channel: 'whatsapp-vcard',
        agent: {
          intent: 'owner_shared_contact_capture',
          action: 'stage_contact',
          extracted: {
            intake_source: 'b29-vcard-whatsapp',
            staged: true,
            contact_id: saved?.id || null,
            referred_by: record.contact_number || null,
          },
        },
      }).catch(e => console.error('[ia360-vcard] crm reflect:', e.message));
      await notifyOwnerVcardCaptured({ record, shared });
    }
    // G-LIVE (auditoría 06-11): un CONTACTO (no owner) que comparte una tarjeta
    // merece acuse — antes solo se notificaba al owner y el remitente quedaba mudo.
    if (!isIa360OwnerNumber(record.contact_number)) {
      await enqueueIa360Text({
        record,
        label: 'ia360_vcard_ack',
        body: 'Recibí la tarjeta, gracias. La registro y le digo a Alek; cualquier siguiente paso te lo confirmo por aquí.',
      }).catch(e => console.error('[ia360-vcard] contact ack error:', e.message));
    }
    return true;
  } catch (err) {
    console.error('[ia360-vcard] handler error:', err.message);
    return false;
  }
}

async function loadIa360ContactForOwnerAction({ waNumber, contactNumber }) {
  const { rows } = await pool.query(
    `SELECT id, COALESCE(name, profile_name, $2) AS name, custom_fields
       FROM coexistence.contacts
      WHERE wa_number=$1 AND contact_number=$2
      LIMIT 1`,
    [waNumber, contactNumber]
  );
  return rows[0] || null;
}

async function sendOwnerPipelineSlots({ record }) {
  const url = process.env.N8N_IA360_AVAILABILITY_WEBHOOK_URL;
  if (!url) return false;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'forgechat-ia360-owner-pipe',
      nextAvailable: true,
      workStartHour: 10,
      workEndHour: 18,
      slotMinutes: 60,
      contact: {
        waNumber: record.wa_number,
        contactNumber: record.contact_number,
        contactName: record.contact_name || null,
      },
    }),
  }).catch(e => {
    console.error('[ia360-owner-pipe] availability request failed:', e.message);
    return null;
  });
  if (!res || !res.ok) {
    console.error('[ia360-owner-pipe] availability failed:', res && res.status);
    return false;
  }
  const data = await res.json().catch(() => null);
  const slots = (data && Array.isArray(data.slots)) ? data.slots : [];
  if (!slots.length) {
    await enqueueIa360Text({
      record,
      label: 'owner_pipe_no_slots',
      body: 'Alek me pidió agendar contigo, pero no encontré espacios libres en los próximos días. Te escribo en cuanto confirme opciones.',
    });
    return true;
  }
  await enqueueIa360Interactive({
    record,
    label: 'owner_pipe_available_slots',
    messageBody: 'IA360: horarios disponibles',
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Horarios libres' },
      body: { text: 'Alek me pidió pasarte opciones para revisar tu caso. Estos espacios de 1 hora están libres (hora CDMX). Elige uno y lo confirmo con Calendar + Zoom.' },
      footer: { text: 'Se revalida antes de reservar' },
      action: {
        button: 'Elegir hora',
        sections: [{
          title: 'Disponibles',
          rows: slots.slice(0, 10).map(slot => ({
            id: slot.id,
            title: String(slot.title || '').slice(0, 24),
            description: slot.description || '',
          })),
        }],
      },
    },
  });
  return true;
}

async function handleIa360OwnerPipelineChoice({ record, targetContact, pipeline }) {
  if (!targetContact) {
    await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_pipe_missing_target', body: 'No encontré el número del contacto de esa acción.' });
    return;
  }
  const ctx = await validateIa360OwnerContext({
    record,
    targetContact,
    action: 'owner_pipe',
    expectedLabelPrefix: `owner_vcard_captured_${targetContact}`,
  });
  if (!ctx.ok) {
    await blockIa360OwnerContextMismatch({
      record,
      targetContact,
      action: 'owner_pipe',
      reason: ctx.reason,
      expectedLabel: `owner_vcard_captured_${targetContact}`,
    });
    return;
  }
  const contact = await loadIa360ContactForOwnerAction({ waNumber: record.wa_number, contactNumber: targetContact });
  const name = contact?.name || targetContact;
  const choice = String(pipeline || '').toLowerCase();
  const qaExpectedChoice = contact?.custom_fields?.qa_persona_expected_choice || null;
  if (qaExpectedChoice && choice !== qaExpectedChoice) {
    await blockIa360OwnerContextMismatch({
      record,
      targetContact,
      action: 'owner_pipe',
      reason: `qa_persona_hint_mismatch:${choice || 'empty'}`,
      expectedLabel: `qa_expected=${qaExpectedChoice}`,
    });
    return;
  }
  const targetRecord = {
    ...record,
    contact_number: targetContact,
    contact_name: name,
    message_type: 'owner_pipe',
    message_body: `Alek eligió pipeline ${choice}`,
  };

  if (IA360_PERSONA_SEQUENCE_FLOWS[choice]) {
    await handleIa360PersonaChoice({ record, targetContact, personaChoice: choice });
    return;
  }

  if (IA360_TERMINAL_VCARD_CHOICES[choice]) {
    await handleIa360TerminalVcardChoice({ record, targetContact, terminalChoice: choice });
    return;
  }

  await handleIa360LegacyOwnerPipeChoice({ record: targetRecord, targetContact, choice, contact });
}

async function handleIa360OwnerVcardAction({ record, ownerAction, targetContact }) {
  if (!targetContact) {
    await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_vcard_missing_target', body: 'No encontré el número del contacto de esa acción.' });
    return;
  }
  const contact = await loadIa360ContactForOwnerAction({ waNumber: record.wa_number, contactNumber: targetContact });
  const name = contact?.name || targetContact;
  const targetRecord = {
    ...record,
    contact_number: targetContact,
    contact_name: name,
    message_type: 'owner_action',
    message_body: `Acción owner sobre vCard: ${ownerAction}`,
  };

  if (ownerAction === 'owner_vcard_pipe') {
    await notifyOwnerVcardCaptured({
      record,
      shared: { name, contactNumber: targetContact },
    });
    return;
  }

  if (ownerAction === 'owner_vcard_take') {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: targetContact,
      tags: ['requiere-alek', 'owner-manual'],
      customFields: {
        staged: false,
        stage: 'Requiere Alek',
        owner_action: 'manual_take',
        owner_action_at: new Date().toISOString(),
      },
    });
    await syncIa360Deal({
      record: targetRecord,
      targetStageName: 'Requiere Alek',
      titleSuffix: 'vCard',
      notes: 'Alek tomo manualmente este contacto compartido por vCard.',
    });
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'owner_vcard_take_ack',
      body: `Ok, ${name} quedó en Requiere Alek para que lo tomes manualmente. No le envié mensaje.`,
    });
    return;
  }

  if (ownerAction === 'owner_vcard_keep') {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: targetContact,
      tags: ['solo-guardar'],
      customFields: {
        staged: true,
        stage: 'Capturado / Por rutear',
        owner_action: 'solo_guardar',
        owner_action_at: new Date().toISOString(),
      },
    });
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'owner_vcard_keep_ack',
      body: `Guardado: ${name} (${targetContact}) queda capturado sin pipeline ni envío.`,
    });
  }
}

const IA360_OWNER_NUMBER = '5213322638033';

function parsePositiveIntEnv(name, fallback, min = 1) {
  const value = parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

const IA360_OWNER_NOTIFY_WINDOW_SECONDS = parsePositiveIntEnv('IA360_OWNER_NOTIFY_WINDOW_SECONDS', 60, 10);
const IA360_OWNER_NOTIFY_MAX_PER_WINDOW = parsePositiveIntEnv('IA360_OWNER_NOTIFY_MAX_PER_WINDOW', 6, 1);

function inferIa360OwnerNotifyTarget(label) {
  const m = String(label || '').match(/(?:owner_vcard_captured|owner_sequence_selector)_(\d+)/);
  return m ? m[1] : null;
}

async function recordIa360OwnerNotifySuppressed({ record, label, targetContact, reason }) {
  const contactNumber = targetContact || inferIa360OwnerNotifyTarget(label);
  console.warn('[ia360-owner] suppressed notify label=%s target=%s reason=%s', label || '-', contactNumber || '-', reason || '-');
  if (!contactNumber || !record?.wa_number) return;
  await mergeContactIa360State({
    waNumber: record.wa_number,
    contactNumber,
    customFields: {
      ia360_owner_notify_suppressed_at: new Date().toISOString(),
      ia360_owner_notify_suppressed_label: label || '',
      ia360_owner_notify_suppressed_reason: reason || '',
      ia360_owner_notify_window_seconds: IA360_OWNER_NOTIFY_WINDOW_SECONDS,
      ia360_owner_notify_max_per_window: IA360_OWNER_NOTIFY_MAX_PER_WINDOW,
    },
  }).catch(e => console.error('[ia360-owner] suppress persist:', e.message));
}

async function canEnqueueIa360OwnerNotify({ record, label, targetContact, ownerBudget }) {
  if (!ownerBudget) return true;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM coexistence.chat_history
      WHERE wa_number=$1
        AND contact_number=$2
        AND direction='outgoing'
        AND template_meta->>'ux'='ia360_owner'
        AND created_at > NOW() - ($3::int * INTERVAL '1 second')`,
    [record.wa_number, IA360_OWNER_NUMBER, IA360_OWNER_NOTIFY_WINDOW_SECONDS]
  );
  const count = rows[0]?.count || 0;
  if (count < IA360_OWNER_NOTIFY_MAX_PER_WINDOW) return true;
  await recordIa360OwnerNotifySuppressed({
    record,
    label,
    targetContact,
    reason: `owner_notify_budget_exceeded:${count}/${IA360_OWNER_NOTIFY_MAX_PER_WINDOW}/${IA360_OWNER_NOTIFY_WINDOW_SECONDS}s`,
  });
  return false;
}

// G-BRAIN sandbox QA (incidente 06-11: el harness inundó el WhatsApp real de Alek
// con tarjetas/readouts de contactos QA). Una tarjeta/texto al OWNER cuyo origen es
// un inbound SINTÉTICO (wamid.e2e.* / qa-*) NO egresa al WhatsApp real: queda como
// evidencia verificable en coexistence.ia360_qa_evidence (los harness E2E leen esa
// tabla). Devuelve true si el egress quedó sandboxeado (el caller sigue su flujo
// normal creyendo que envió, que es exactamente la semántica del sandbox).
async function recordIa360QaEvidence({ record, toNumber, kind, label, messageBody, payload = null }) {
  try {
    await pool.query(
      `INSERT INTO coexistence.ia360_qa_evidence
         (origin_wamid, contact_number, to_number, kind, label, message_body, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record?.message_id || null,
        record?.contact_number || null,
        String(toNumber || ''),
        kind,
        label || null,
        messageBody || null,
        payload ? JSON.stringify(payload) : null,
      ]
    );
    console.log('[ia360-qa-sandbox] egress al owner OMITIDO (origen sintético) label=%s origen=%s', label, record?.message_id);
    return true;
  } catch (err) {
    console.error('[ia360-qa-sandbox] evidence insert error:', err.message);
    return true; // sandbox fail-closed: aunque falle la evidencia, NO egresar al owner real
  }
}

// Envia un interactivo al OWNER (Alek), no al record.contact_number. Construye la
// fila + encola apuntando a IA360_OWNER_NUMBER. NO pasa por resolveIa360Outbound
// (su dedup es por contact_number+ia360_handler_for; aqui el destino es otro
// numero, no colisiona). try/catch propio: nunca tumba el webhook.
async function sendOwnerInteractive({ record, interactive, label, messageBody, targetContact = null, ownerBudget = false }) {
  try {
    // G-BRAIN sandbox: origen sintético (harness E2E) => la tarjeta se persiste en
    // chat_history con status='qa_sandboxed' (los harness la correlacionan por
    // message_id como contexto de taps) pero JAMÁS se encola hacia Meta: cero
    // tarjetas de QA en el WhatsApp real de Alek.
    const qaSandbox = isIa360SyntheticWamid(record?.message_id);
    if (!qaSandbox && !(await canEnqueueIa360OwnerNotify({ record, label, targetContact, ownerBudget }))) return false;
    const { account, error } = await resolveAccount({ fromPhoneNumber: record.wa_number });
    if (error || !account) { console.error('[ia360-owner] account resolve failed:', error || 'unknown'); return false; }
    const localId = await insertPendingRow({
      account,
      toNumber: IA360_OWNER_NUMBER,
      messageType: 'interactive',
      messageBody: messageBody || 'IA360 owner',
      templateMeta: { ux: 'ia360_owner', label, ia360_handler_for: `${record.message_id}:owner:${label}`, source: 'webhook_owner_notify', ...(qaSandbox ? { qa_sandbox: true } : {}) },
      ...(qaSandbox ? { status: 'qa_sandboxed' } : {}),
    });
    if (!localId) return false; // dedupe atómico ON CONFLICT (p.ej. doble tarjeta del mismo wamid)
    if (qaSandbox) {
      console.log('[ia360-qa-sandbox] tarjeta al owner SIN egress real label=%s origen=%s', label, record?.message_id);
      return true;
    }
    await enqueueSend({ kind: 'interactive', accountId: account.id, to: IA360_OWNER_NUMBER, localMessageId: localId, payload: { interactive } });
    return true;
  } catch (err) {
    console.error('[ia360-owner] sendOwnerInteractive error:', err.message);
    return false;
  }
}

// Envia texto libre a un numero ARBITRARIO (p.ej. el contacto cuya cita se cancela
// desde la rama owner, donde record.contact_number es Alek, no el prospecto).
async function sendIa360DirectText({ record, toNumber, body, label, targetContact = null, ownerBudget = false }) {
  try {
    // G-BRAIN sandbox: texto al OWNER real con origen sintético => fila
    // 'qa_sandboxed' (visible para los harness), sin egress a Meta.
    const qaSandbox = normalizePhone(toNumber) === IA360_OWNER_NUMBER && isIa360SyntheticWamid(record?.message_id);
    if (!qaSandbox && normalizePhone(toNumber) === IA360_OWNER_NUMBER &&
        !(await canEnqueueIa360OwnerNotify({ record, label, targetContact, ownerBudget }))) return false;
    const { account, error } = await resolveAccount({ fromPhoneNumber: record.wa_number });
    if (error || !account) { console.error('[ia360-owner] direct text account resolve failed:', error || 'unknown'); return false; }
    const localId = await insertPendingRow({
      account,
      toNumber,
      messageType: 'text',
      messageBody: body,
      // G-BRAIN: el label forma parte del handler — dos textos DISTINTOS al mismo
      // destino para el mismo inbound (p.ej. readout + "listo, enviado") son
      // legítimos y el índice único no debe colapsarlos.
      templateMeta: { ux: 'ia360_owner', label, ia360_handler_for: `${record.message_id}:direct:${toNumber}:${label}`, source: 'webhook_owner_direct', ...(qaSandbox ? { qa_sandbox: true } : {}) },
      ...(qaSandbox ? { status: 'qa_sandboxed' } : {}),
    });
    if (!localId) return false; // dedupe atómico ON CONFLICT
    if (qaSandbox) {
      console.log('[ia360-qa-sandbox] texto al owner SIN egress real label=%s origen=%s', label, record?.message_id);
      return true;
    }
    await enqueueSend({ kind: 'text', accountId: account.id, to: toNumber, localMessageId: localId, payload: { body, previewUrl: false } });
    return true;
  } catch (err) {
    console.error('[ia360-owner] sendIa360DirectText error:', err.message);
    return false;
  }
}

// ─── G5: Circuit breaker de PAGO / elegibilidad de Meta ─────────────────────
// Engancha en el procesamiento de webhooks de STATUS. El 131042 NO llega como
// excepción en el envío síncrono (Meta devuelve accepted+wamid); llega DESPUÉS
// como status "failed" con errors[].code=131042. Por eso el breaker vive aquí,
// no sólo en el envío. La LÓGICA (clasificación, flag por cuenta, anti-spam) está
// en services/paymentCircuitBreaker.js; esta función sólo traduce la decisión en
// una alerta al owner vía sendIa360DirectText (UNA vez por bloqueo/día/código).
async function handleIa360PaymentCircuitBreaker(record) {
  const decision = evaluatePaymentStatus(record);
  if (decision.action === 'none') return;

  if (decision.action === 'recover') {
    console.log('[ia360-payment-cb] cuenta %s RECUPERADA (status=%s, facturable entregado) — flag limpiado',
      decision.accountKey, record.status);
    // Aviso de recuperación: también es un mensaje de sesión al owner (entrega
    // aunque la cuenta estuviera bloqueada para templates).
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'owner_payment_recovered',
      body: '✅ WhatsApp volvió a entregar templates: el bloqueo por pago/elegibilidad de Meta quedó resuelto. Reanudo envíos normales.',
    }).catch(e => console.error('[ia360-payment-cb] aviso recuperación falló:', e.message));
    return;
  }

  // action === 'block'
  if (!decision.shouldAlert) {
    console.log('[ia360-payment-cb] cuenta %s ya bloqueada code=%s — alerta suprimida (anti-spam)',
      decision.accountKey, decision.code);
    return;
  }

  const cuenta = record.wa_number || decision.accountKey;
  const body =
    `🚨 *WhatsApp bloqueó tus envíos* (cuenta ${cuenta}).\n\n` +
    `Meta marcó un mensaje como *failed* por *${decision.title}* (código ${decision.code}).\n\n` +
    `Esto bloquea los *templates* (mensajes iniciados por el negocio). Los mensajes de sesión (respuestas dentro de 24 h) siguen funcionando.\n\n` +
    (decision.href ? `Resuélvelo aquí:\n${decision.href}` : 'Revisa el Billing Hub de Meta para liquidar el saldo pendiente.');

  const sent = await sendIa360DirectText({
    record,
    toNumber: IA360_OWNER_NUMBER,
    label: `owner_payment_block_${decision.code}`,
    body,
  }).catch(e => { console.error('[ia360-payment-cb] alerta owner falló:', e.message); return false; });
  console.log('[ia360-payment-cb] ALERTA owner cuenta=%s code=%s alerta#%d enviada=%s',
    decision.accountKey, decision.code, decision.alertCount, sent);
}

// ─── Expediente del owner: "qué sabes de <nombre|número>" ──────────────────
// Comando read-only del owner: arma un expediente con los facts y eventos de
// coexistence.ia360_memory_* para un contacto, resuelto por número o por
// nombre (tolerante a acentos y a typos simples tipo Emmanuel/Emanuel).
// Egress SOLO vía sendIa360DirectText; nunca escribe memoria y SIEMPRE
// responde algo (sin expediente / candidatos / error), nunca queda mudo.
const IA360_BOT_WA_NUMBER = '5213321594582'; // número del bot: jamás es contacto

function parseIa360OwnerMemoryQuery(body) {
  const text = String(body || '').trim();
  const m = text.match(/^¿?\s*(?:qu[eé]|qui[eé]n)\s+sabes\s+(?:de\s+la|de\s+el|del|de|sobre)\s+(.+?)\s*\?*$/i);
  if (!m) return null;
  const q = m[1].trim();
  return q || null;
}

// Normaliza para comparar nombres: minúsculas, sin acentos y con letras
// repetidas colapsadas ("Emmanuel" y "Emanuel" → "emanuel").
function ia360NormalizeNameForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(.)\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveIa360MemoryTarget(query) {
  const digits = String(query || '').replace(/\D/g, '');
  if (digits.length >= 10) {
    // Número directo: 10 dígitos MX → prefijo 521 (formato ForgeChat).
    const number = digits.length === 10 ? `521${digits}` : digits;
    return { kind: 'number', candidates: [{ contact_number: number, contact_name: null }] };
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT contact_number, contact_name FROM (
       SELECT contact_number, contact_name
         FROM coexistence.ia360_memory_events
        WHERE contact_name IS NOT NULL AND contact_number IS NOT NULL
       UNION ALL
       SELECT contact_number, COALESCE(name, profile_name) AS contact_name
         FROM coexistence.contacts
        WHERE COALESCE(name, profile_name) IS NOT NULL AND contact_number IS NOT NULL
     ) t
     WHERE contact_number <> $1`,
    [IA360_BOT_WA_NUMBER]
  );
  const needle = ia360NormalizeNameForMatch(query);
  if (!needle) return { kind: 'none', candidates: [] };
  const byNumber = new Map();
  for (const r of rows) {
    if (!ia360NormalizeNameForMatch(r.contact_name).includes(needle)) continue;
    if (!byNumber.has(r.contact_number)) byNumber.set(r.contact_number, r);
  }
  const candidates = [...byNumber.values()];
  if (!candidates.length) return { kind: 'none', candidates: [] };
  if (candidates.length > 1) return { kind: 'ambiguous', candidates };
  return { kind: 'name', candidates };
}

async function buildIa360ContactDossier(contactNumber) {
  const num = normalizePhone(contactNumber);
  const { rows: factRows } = await pool.query(
    `SELECT project_name, persona, role, account_name, preference, objection,
            recurring_pain, affected_process, missing_metric
       FROM coexistence.ia360_memory_facts
      WHERE contact_number = $1
      ORDER BY last_seen_at DESC, id DESC`,
    [num]
  );
  const { rows: eventRows } = await pool.query(
    `SELECT contact_name, area, signal_type, summary
       FROM coexistence.ia360_memory_events
      WHERE contact_number = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 12`,
    [num]
  );
  if (!factRows.length && !eventRows.length) return null;

  const name = eventRows.find(e => e.contact_name)?.contact_name || null;
  const header = [`Expediente IA360: ${name || 'contacto'} (${num})`];
  const meta = [];
  const accountRow = factRows.find(f => f.account_name);
  const projectRow = factRows.find(f => f.project_name);
  const personaRow = factRows.find(f => f.persona);
  if (accountRow) meta.push(`Cuenta: ${accountRow.account_name}`);
  if (projectRow) meta.push(`Proyecto: ${projectRow.project_name}`);
  if (personaRow) meta.push(`Persona: ${personaRow.persona}`);
  if (meta.length) header.push(meta.join(' · '));

  // Los facts viven duplicados por el doble keying de contact_wa_number
  // (monolito vs lookup v2): dedupe por contenido, no por fila.
  const factLines = [];
  const seenFacts = new Set();
  for (const f of factRows) {
    for (const field of ['preference', 'objection', 'recurring_pain', 'affected_process', 'missing_metric']) {
      const val = String(f[field] || '').trim();
      if (!val) continue;
      const key = `${field}:${val}`;
      if (seenFacts.has(key)) continue;
      seenFacts.add(key);
      factLines.push(`- ${val.length > 300 ? `${val.slice(0, 297)}...` : val}`);
    }
  }
  const eventLines = [];
  const seenEvents = new Set();
  for (const e of eventRows) {
    const val = String(e.summary || '').trim();
    if (!val) continue;
    const key = `${e.area}|${e.signal_type}|${val}`;
    if (seenEvents.has(key)) continue;
    seenEvents.add(key);
    eventLines.push(`- [${e.area}/${e.signal_type}] ${val.length > 220 ? `${val.slice(0, 217)}...` : val}`);
  }

  const lines = [...header, ''];
  if (factLines.length) lines.push(`Facts (${factLines.length}):`, ...factLines, '');
  if (eventLines.length) lines.push(`Eventos recientes (${eventLines.length}):`, ...eventLines);
  let body = lines.join('\n').trim();
  // Límite duro de WhatsApp: 4096 chars por texto.
  if (body.length > 3900) body = `${body.slice(0, 3880)}\n... (recortado)`;
  return body;
}

async function handleIa360OwnerMemoryQuery({ record, query }) {
  let body;
  try {
    const target = await resolveIa360MemoryTarget(query);
    if (target.kind === 'none') {
      body = `Sin expediente: no encontré facts ni eventos para "${query}". Revisa el nombre o mándame el número completo.`;
    } else if (target.kind === 'ambiguous') {
      const list = target.candidates.slice(0, 8)
        .map(c => `- ${c.contact_name || 'sin nombre'} (${c.contact_number})`).join('\n');
      body = `Encontré varios contactos que coinciden con "${query}". ¿De cuál quieres el expediente?\n${list}\n\nMándame "qué sabes de <número>" para verlo.`;
    } else {
      const dossier = await buildIa360ContactDossier(target.candidates[0].contact_number);
      body = dossier
        || `Sin expediente: el contacto ${target.candidates[0].contact_number} no tiene facts ni eventos guardados todavía.`;
    }
  } catch (err) {
    console.error('[ia360-expediente] dossier error:', err.message);
    body = `No pude leer el expediente de "${query}" ahora mismo (error interno). Inténtalo de nuevo en un momento.`;
  }
  await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_memory_dossier', body });
}

// ─── G-RAG: puente seguro AlekContenido ↔ RAG IA360 (2026-06-11) ────────────
// El vault de Obsidian se indexa desde el HOST (scripts/vault-bridge.js: el
// contenedor backend NO monta el vault); el backend solo lee ia360_vault_notes
// y administra los vínculos contacto↔nota en ia360_vault_links. Reglas duras:
// auto-match SOLO por teléfono (el nombre JAMÁS auto-matchea: homónimos), el
// owner confirma por tarjeta los candidatos por nombre, y los facts destilados
// caen en ia360_memory_facts con source='alekcontenido' (provenance reversible
// vía fact_key y payload.note_path).

let ia360VaultTablesReady = null;

async function ensureIa360VaultTables() {
  if (!ia360VaultTablesReady) {
    ia360VaultTablesReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS coexistence.ia360_vault_notes (
          note_id BIGSERIAL UNIQUE,
          note_path TEXT PRIMARY KEY,
          nombre TEXT,
          nombre_normalizado TEXT,
          telefono_wa TEXT,
          project_name TEXT,
          rol TEXT,
          empresa TEXT,
          frontmatter JSONB NOT NULL DEFAULT '{}'::jsonb,
          contenido TEXT,
          file_mtime TIMESTAMPTZ,
          indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          missing_since TIMESTAMPTZ
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS ia360_vault_notes_tel_idx
          ON coexistence.ia360_vault_notes (telefono_wa) WHERE telefono_wa IS NOT NULL
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS ia360_vault_notes_nombre_idx
          ON coexistence.ia360_vault_notes (nombre_normalizado)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS coexistence.ia360_vault_links (
          id BIGSERIAL PRIMARY KEY,
          forgechat_contact_id BIGINT NOT NULL,
          contact_number TEXT NOT NULL,
          note_path TEXT NOT NULL,
          project_name TEXT,
          estado TEXT NOT NULL CHECK (estado IN ('vinculado','rechazado')),
          matched_by TEXT NOT NULL CHECK (matched_by IN ('telefono','owner_tap','owner_reject')),
          confirmado_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (forgechat_contact_id, note_path)
        )
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ia360_vault_links_note_vinculado_uidx
          ON coexistence.ia360_vault_links (note_path) WHERE estado = 'vinculado'
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS ia360_vault_links_contact_idx
          ON coexistence.ia360_vault_links (contact_number, estado)
      `);
    })().catch(err => {
      ia360VaultTablesReady = null;
      throw err;
    });
  }
  return ia360VaultTablesReady;
}

// Blocklist del puente: bot, owner y TODO número QA/sintético 521999*.
function ia360VaultBlocklisted(num) {
  const n = String(num || '');
  return n === IA360_BOT_WA_NUMBER || n === IA360_OWNER_NUMBER || /^521999/.test(n);
}

// Levenshtein chico para el fuzzy de candidatos (Antúnez/Antunes ⇒ distancia 1
// tras normalizar). Tokens cortos, sin librería.
function ia360Levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Carga la ficha de contacto por número; si el mismo número vive bajo varias
// cuentas WA, gana la del bot (la conversación IA360 real).
async function loadIa360VaultContactByNumber(contactNumber) {
  const num = normalizePhone(contactNumber);
  if (!num) return null;
  const { rows } = await pool.query(
    `SELECT id, wa_number, contact_number, name, profile_name, custom_fields
       FROM coexistence.contacts
      WHERE contact_number = $1
      ORDER BY (wa_number = $2) DESC
      LIMIT 1`,
    [num, IA360_BOT_WA_NUMBER]
  );
  return rows[0] || null;
}

// Auto-match SOLO por teléfono. El COUNT(DISTINCT)=1 garantiza que un teléfono
// jamás apunte a 2 contactos; el NOT EXISTS respeta vínculos de otros contactos
// y rechazos sellados de este contacto. El nombre JAMÁS auto-matchea.
async function ensureIa360VaultAutoLinks({ contact }) {
  if (!contact || ia360VaultBlocklisted(contact.contact_number)) return [];
  await ensureIa360VaultTables();
  const { rows } = await pool.query(
    `INSERT INTO coexistence.ia360_vault_links
       (forgechat_contact_id, contact_number, note_path, project_name, estado, matched_by, confirmado_at)
     SELECT $1, $2, n.note_path, n.project_name, 'vinculado', 'telefono', NOW()
       FROM coexistence.ia360_vault_notes n
      WHERE n.telefono_wa = $2 AND n.missing_since IS NULL
        AND (SELECT COUNT(DISTINCT c2.id) FROM coexistence.contacts c2 WHERE c2.contact_number = $2) = 1
        AND NOT EXISTS (SELECT 1 FROM coexistence.ia360_vault_links l
                         WHERE l.note_path = n.note_path
                           AND (l.estado = 'vinculado' OR l.forgechat_contact_id = $1))
     ON CONFLICT (forgechat_contact_id, note_path) DO NOTHING
     RETURNING note_path`,
    [contact.id, contact.contact_number]
  );
  return rows.map(r => r.note_path);
}

// Limpieza de valores del vault: [[wikilinks]] → texto interno, sin markdown
// de negritas, espacios colapsados, tope 300 chars.
function ia360CleanVaultValue(v) {
  return String(v == null ? '' : v)
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

// Destilación DETERMINISTA de una nota del vault (sin LLM): frontmatter a
// slots de ia360_memory_facts + hasta 3 dolores de la tabla del cuerpo.
function distillIa360VaultNote(note) {
  const fm = note?.frontmatter || {};
  const facts = [];
  const push = (slot, valor, sufijo) => {
    const v = ia360CleanVaultValue(valor);
    if (v) facts.push({ slot, valor: v, sufijo });
  };
  const pick = (...keys) => {
    for (const k of keys) {
      if (fm[k] != null && String(fm[k]).trim() !== '') return fm[k];
    }
    return null;
  };
  push('role', pick('rol', 'cargo', 'rol_principal', 'rol_en_meta'), 'rol');
  push('account_name', pick('empresa', 'organizacion', 'organización'), 'empresa');
  push('persona', pick('tipo', 'tipo_referencia', 'nivel_decision'), 'tipo');
  const canal = pick('canal_preferido');
  if (canal) push('preference', `Canal preferido: ${ia360CleanVaultValue(canal)}`, 'canal');
  // Filas de la tabla de dolores del cuerpo: "| 1 | **dolor** | ...".
  const re = /^\|\s*\d+\s*\|\s*\*\*(.+?)\*\*/gm;
  let m;
  let i = 0;
  while ((m = re.exec(String(note?.contenido || ''))) && i < 3) {
    i += 1;
    push('recurring_pain', m[1], `pain${i}`);
  }
  return facts;
}

const IA360_VAULT_SLOT_COLUMNS = {
  role: 'role',
  account_name: 'account_name',
  persona: 'persona',
  preference: 'preference',
  recurring_pain: 'recurring_pain',
};

// Vuelca a ia360_memory_facts lo destilado de las notas VINCULADAS del
// contacto. fact_key = 'alekcontenido:<note_path>#<sufijo>' (dedupe natural);
// project_name = el de la NOTA (jaula correcta; notas de Areas/CRM traen NULL
// = fact general de persona). Devuelve { notas, facts, proyectos }.
async function enrichIa360ContactFromVault({ record, contact }) {
  await ensureIa360VaultTables();
  const { rows: notes } = await pool.query(
    `SELECT n.note_path, n.project_name, n.frontmatter, n.contenido
       FROM coexistence.ia360_vault_links l
       JOIN coexistence.ia360_vault_notes n ON n.note_path = l.note_path
      WHERE l.forgechat_contact_id = $1 AND l.estado = 'vinculado'
        AND n.missing_since IS NULL
      ORDER BY l.confirmado_at DESC NULLS LAST`,
    [contact.id]
  );
  const result = { notas: [], facts: 0, proyectos: [] };
  if (!notes.length) return result;
  for (const note of notes) {
    result.notas.push({ note_path: note.note_path, project_name: note.project_name || null });
    if (note.project_name && !result.proyectos.includes(note.project_name)) result.proyectos.push(note.project_name);
    for (const f of distillIa360VaultNote(note)) {
      const col = IA360_VAULT_SLOT_COLUMNS[f.slot];
      if (!col) continue;
      const factKey = `alekcontenido:${note.note_path}#${f.sufijo}`;
      const payload = { note_path: note.note_path, origen: 'vault', valor: f.valor };
      await pool.query(
        `INSERT INTO coexistence.ia360_memory_facts
           (fact_key, source, contact_wa_number, contact_number, forgechat_contact_id,
            project_name, ${col}, confidence, owner_review_status, status, payload)
         VALUES ($1,'alekcontenido',$2,$3,$4,$5,$6,0.950,'owner_curated','confirmed',$7::jsonb)
         ON CONFLICT (fact_key) DO UPDATE SET
           ${col} = EXCLUDED.${col},
           project_name = EXCLUDED.project_name,
           payload = EXCLUDED.payload,
           evidence_count = coexistence.ia360_memory_facts.evidence_count + 1,
           last_seen_at = NOW(), updated_at = NOW()`,
        [
          factKey,
          contact.wa_number,
          contact.contact_number,
          contact.id,
          note.project_name || null,
          f.valor,
          JSON.stringify(payload),
        ]
      );
      result.facts += 1;
    }
  }
  await mergeContactIa360State({
    waNumber: contact.wa_number,
    contactNumber: contact.contact_number,
    customFields: { rag_enriched_at: new Date().toISOString() },
  });
  console.log('[ia360-vault] enriquecido contacto=%s notas=%d facts=%d origen=%s',
    contact.contact_number, result.notas.length, result.facts, record?.message_id || '-');
  return result;
}

// Candidatos por NOMBRE: notas vivas no vinculadas a NADIE y sin fila sellada
// para ESTE contacto. Cada token (≥3 chars) del nombre del contacto debe
// aparecer en el nombre de la nota o estar a Levenshtein ≤ 1 de algún token.
async function buildIa360VaultCandidates(contact) {
  await ensureIa360VaultTables();
  const display = contact?.name || contact?.profile_name || '';
  const tokens = ia360NormalizeNameForMatch(display).split(' ').filter(t => t.length >= 3);
  if (!tokens.length) return [];
  const { rows } = await pool.query(
    `SELECT n.note_id, n.note_path, n.nombre, n.nombre_normalizado, n.project_name, n.rol, n.empresa
       FROM coexistence.ia360_vault_notes n
      WHERE n.missing_since IS NULL
        AND NOT EXISTS (SELECT 1 FROM coexistence.ia360_vault_links l
                         WHERE l.note_path = n.note_path AND l.estado = 'vinculado')
        AND NOT EXISTS (SELECT 1 FROM coexistence.ia360_vault_links l2
                         WHERE l2.note_path = n.note_path AND l2.forgechat_contact_id = $1)`,
    [contact.id]
  );
  const scored = [];
  for (const n of rows) {
    const noteName = String(n.nombre_normalizado || '');
    if (!noteName) continue;
    const noteTokens = noteName.split(' ').filter(Boolean);
    let score = 0;
    let all = true;
    for (const t of tokens) {
      if (noteName.includes(t) || noteTokens.some(nt => ia360Levenshtein(t, nt) <= 1)) score += 1;
      else all = false;
    }
    if (all && score > 0) scored.push({ ...n, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3);
}

// Tarjeta de candidatos al owner (mismo patrón list del approve-send). Sin tap
// del owner = cero sync: el nombre solo PROPONE, nunca vincula.
async function sendIa360VaultCandidateCard({ record, contact, candidates = null }) {
  const list = candidates || await buildIa360VaultCandidates(contact);
  const display = contact.name || contact.profile_name || contact.contact_number;
  if (!list.length) {
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'ia360_vault_no_candidates',
      body: `Sin notas candidatas en el vault para ${display}. Si existe la nota, captúrale telefono_wa y vuelve a pedir "sincroniza a ...".`,
      targetContact: contact.contact_number,
      ownerBudget: true,
    });
    return false;
  }
  await mergeContactIa360State({
    waNumber: contact.wa_number,
    contactNumber: contact.contact_number,
    customFields: { ia360_vault_offered: list.map(c => c.note_id).join(',') },
  });
  const rows = list.map(c => ({
    id: `owner_vlink:${contact.contact_number}:${c.note_id}`,
    title: String(c.nombre || c.note_path).slice(0, 24),
    description: `${c.project_name || 'CRM general'} · ${c.rol || c.empresa || 'nota'}`.slice(0, 72),
  }));
  rows.push({
    id: `owner_vnone:${contact.contact_number}`,
    title: 'Ninguno, crear nuevo',
    description: 'No vincular; nota nueva en Areas/CRM/contactos/ cuando haya docs',
  });
  return sendOwnerInteractive({
    record,
    label: 'ia360_vault_candidates',
    messageBody: `Candidatos vault para ${contact.contact_number}: ${list.map(c => `${c.nombre} (${c.project_name || 'CRM general'})`).join(', ')}`,
    targetContact: contact.contact_number,
    ownerBudget: true,
    interactive: {
      type: 'list',
      body: { text: `Sin match por teléfono para ${display} (${contact.contact_number}). ¿Vinculo alguna nota del vault?` },
      action: {
        button: 'Elegir nota',
        sections: [{
          title: 'Notas del vault',
          rows,
        }],
      },
    },
  });
}

// Tap owner_vlink: vínculo sellado por decisión EXPLÍCITA del owner. Un tap SÍ
// puede revertir un rechazo previo (decisión nueva, no re-pregunta).
async function handleIa360OwnerVaultLink({ record, targetContact, noteId }) {
  try {
    await ensureIa360VaultTables();
    const contact = await loadIa360VaultContactByNumber(targetContact);
    const { rows: noteRows } = await pool.query(
      `SELECT note_id, note_path, project_name, nombre
         FROM coexistence.ia360_vault_notes
        WHERE note_id = $1
        LIMIT 1`,
      [noteId]
    );
    const note = noteRows[0];
    if (!contact || !note) {
      await sendIa360DirectText({
        record,
        toNumber: IA360_OWNER_NUMBER,
        label: 'ia360_vault_link_conflict',
        body: `No pude vincular: ${!contact ? `no hay ficha de contacto para ${targetContact}` : `la nota ${noteId} ya no existe en el índice del vault`}. Corre el indexador y vuelve a pedir "sincroniza a ...".`,
        targetContact,
        ownerBudget: true,
      });
      return;
    }
    try {
      await pool.query(
        `INSERT INTO coexistence.ia360_vault_links
           (forgechat_contact_id, contact_number, note_path, project_name, estado, matched_by, confirmado_at)
         VALUES ($1,$2,$3,$4,'vinculado','owner_tap',NOW())
         ON CONFLICT (forgechat_contact_id, note_path) DO UPDATE SET
           estado='vinculado', matched_by='owner_tap', confirmado_at=NOW(), updated_at=NOW()`,
        [contact.id, contact.contact_number, note.note_path, note.project_name || null]
      );
    } catch (linkErr) {
      // Solo la violación del índice parcial único (23505) significa "la nota
      // ya pertenece a OTRO contacto"; lo demás es error interno y lo maneja
      // el catch externo sin diagnósticos falsos.
      if (linkErr.code !== '23505') throw linkErr;
      console.warn('[ia360-vault] vínculo en conflicto note=%s contacto=%s: %s', note.note_path, targetContact, linkErr.message);
      await sendIa360DirectText({
        record,
        toNumber: IA360_OWNER_NUMBER,
        label: 'ia360_vault_link_conflict',
        body: `No vinculé ${note.note_path}: esa nota ya está vinculada a OTRO contacto (una nota apunta a una sola persona). Si el vínculo actual está mal, dime y lo revisamos.`,
        targetContact,
        ownerBudget: true,
      });
      return;
    }
    const enriched = await enrichIa360ContactFromVault({ record, contact });
    const display = contact.name || contact.profile_name || targetContact;
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'ia360_vault_linked',
      body: `Vinculé ${note.note_path} a ${display} (${targetContact}). Facts: ${enriched.facts} (proyecto: ${note.project_name || 'general'}). Si quieres vincular otra nota: "sincroniza a ${display}".`,
      targetContact,
      ownerBudget: true,
    });
  } catch (err) {
    console.error('[ia360-vault] owner_vlink error:', err.message);
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'ia360_vault_link_conflict',
      body: `No pude completar el vínculo para ${targetContact} (error interno). Inténtalo de nuevo en un momento.`,
      targetContact,
      ownerBudget: true,
    }).catch(() => {});
  }
}

// Tap owner_vnone: sella como rechazados TODOS los candidatos ofrecidos en la
// tarjeta (no se vuelve a preguntar). Jamás degrada un vínculo ya sellado.
async function handleIa360OwnerVaultNone({ record, targetContact }) {
  try {
    await ensureIa360VaultTables();
    const contact = await loadIa360VaultContactByNumber(targetContact);
    if (!contact) {
      await sendIa360DirectText({
        record,
        toNumber: IA360_OWNER_NUMBER,
        label: 'ia360_vault_none_ack',
        body: `No hay ficha de contacto para ${targetContact}; no había nada que sellar.`,
        targetContact,
        ownerBudget: true,
      });
      return;
    }
    const offered = String(contact.custom_fields?.ia360_vault_offered || '')
      .split(',')
      .map(s => s.replace(/\D/g, ''))
      .filter(Boolean);
    for (const nid of offered) {
      const { rows } = await pool.query(
        `SELECT note_path, project_name FROM coexistence.ia360_vault_notes WHERE note_id = $1 LIMIT 1`,
        [nid]
      );
      const note = rows[0];
      if (!note) continue;
      await pool.query(
        `INSERT INTO coexistence.ia360_vault_links
           (forgechat_contact_id, contact_number, note_path, project_name, estado, matched_by, confirmado_at)
         VALUES ($1,$2,$3,$4,'rechazado','owner_reject',NOW())
         ON CONFLICT (forgechat_contact_id, note_path) DO UPDATE SET
           estado='rechazado', matched_by='owner_reject', confirmado_at=NOW(), updated_at=NOW()
           WHERE coexistence.ia360_vault_links.estado <> 'vinculado'`,
        [contact.id, contact.contact_number, note.note_path, note.project_name || null]
      );
    }
    await mergeContactIa360State({
      waNumber: contact.wa_number,
      contactNumber: contact.contact_number,
      customFields: { ia360_vault_offered: '', ia360_vault_none: '1' },
    });
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'ia360_vault_none_ack',
      body: `Listo, no vinculé nada para ${targetContact}. Los candidatos quedan sellados como rechazados (no vuelvo a preguntar) y cuando haya documentos crearé nota nueva en Areas/CRM/contactos/.`,
      targetContact,
      ownerBudget: true,
    });
  } catch (err) {
    console.error('[ia360-vault] owner_vnone error:', err.message);
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'ia360_vault_none_ack',
      body: `No pude sellar los rechazos para ${targetContact} (error interno). Vuelve a tocar "Ninguno, crear nuevo" en un momento.`,
      targetContact,
      ownerBudget: true,
    }).catch(() => {});
  }
}

// Comando del owner: "sincroniza a <nombre|número>". Resuelve el contacto con
// la misma tolerancia a typos del expediente, fuerza el auto-match por
// teléfono y, si no hay vínculo, propone candidatos por nombre con tarjeta.
// try/catch total: NUNCA queda mudo.
async function handleIa360OwnerVaultSync({ record, query }) {
  const ownerText = (label, body) => sendIa360DirectText({
    record, toNumber: IA360_OWNER_NUMBER, label, body, ownerBudget: true,
  });
  try {
    await ensureIa360VaultTables();
    const target = await resolveIa360MemoryTarget(query);
    if (target.kind === 'none') {
      await ownerText('ia360_vault_sync_none', `No encontré a "${query}" ni como nombre ni como número.`);
      return;
    }
    if (target.kind === 'ambiguous') {
      const list = target.candidates.slice(0, 8)
        .map(c => `- ${c.contact_name || 'sin nombre'} (${c.contact_number})`).join('\n');
      await ownerText('ia360_vault_sync_ambiguous',
        `Encontré varios contactos que coinciden con "${query}". ¿A cuál sincronizo?\n${list}\n\nMándame "sincroniza a <número>" para elegirlo.`);
      return;
    }
    const num = normalizePhone(target.candidates[0].contact_number);
    const contact = await loadIa360VaultContactByNumber(num);
    if (!contact) {
      await ownerText('ia360_vault_sync_none', `No hay ficha de ${num} en contacts de ForgeChat; sin ficha no puedo vincular notas del vault.`);
      return;
    }
    if (ia360VaultBlocklisted(contact.contact_number)) {
      await ownerText('ia360_vault_sync_blocked', 'Ese número está en la blocklist del puente (bot/owner/QA); no se sincroniza.');
      return;
    }
    await ensureIa360VaultAutoLinks({ contact });
    const enriched = await enrichIa360ContactFromVault({ record, contact });
    if (enriched.notas.length) {
      const display = contact.name || contact.profile_name || num;
      const lines = [
        `Sincronizado ${display} (${num}): ${enriched.notas.length} nota(s) vinculada(s), ${enriched.facts} facts.`,
        ...enriched.notas.map(n => `- ${n.note_path} → proyecto ${n.project_name || 'general'}`),
      ];
      await sendIa360DirectText({
        record,
        toNumber: IA360_OWNER_NUMBER,
        label: 'ia360_vault_synced',
        body: lines.join('\n'),
        targetContact: num,
        ownerBudget: true,
      });
      // "Si quieres vincular otra nota: sincroniza a <nombre>" (ack del tap):
      // si todavía quedan candidatos por nombre sin sellar, se ofrecen aquí
      // mismo — sin esto el repeat-sync sería un callejón sin salida.
      const remaining = await buildIa360VaultCandidates(contact);
      if (remaining.length) await sendIa360VaultCandidateCard({ record, contact, candidates: remaining });
      return;
    }
    await sendIa360VaultCandidateCard({ record, contact });
  } catch (err) {
    console.error('[ia360-vault] sync error:', err.message);
    await ownerText('ia360_vault_sync_error', `No pude sincronizar "${query}" ahora mismo (error interno). Inténtalo de nuevo en un momento.`).catch(() => {});
  }
}

// Hook al alta de contacto: el primer mensaje real de un número nuevo dispara
// UNA sola vez (flag ia360_vault_checked) el auto-match por teléfono y, si no
// hay vínculo pero sí candidatos por nombre, la tarjeta al owner. Sin tap del
// owner = cero sync. Fire-and-forget: jamás bloquea el inbound.
async function maybeIa360VaultIntake(record) {
  await ensureIa360VaultTables();
  const { rows } = await pool.query(
    `SELECT id, wa_number, contact_number, name, profile_name, custom_fields
       FROM coexistence.contacts
      WHERE wa_number = $1 AND contact_number = $2
      LIMIT 1`,
    [record.wa_number, record.contact_number]
  );
  const contact = rows[0];
  if (!contact) return;
  if (String(contact.custom_fields?.ia360_vault_checked || '') === '1') return;
  await mergeContactIa360State({
    waNumber: contact.wa_number,
    contactNumber: contact.contact_number,
    customFields: { ia360_vault_checked: '1' },
  });
  await ensureIa360VaultAutoLinks({ contact });
  const { rows: linked } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM coexistence.ia360_vault_links
      WHERE forgechat_contact_id = $1 AND estado = 'vinculado'`,
    [contact.id]
  );
  if (linked[0].n > 0) {
    await enrichIa360ContactFromVault({ record, contact });
    return;
  }
  const candidates = await buildIa360VaultCandidates(contact);
  if (candidates.length) await sendIa360VaultCandidateCard({ record, contact, candidates });
}

// ─── Bandeja de ideas del owner ─────────────────────────────────────────────
// Una idea (comando del owner "idea: <texto>", detección en conversación vía
// Brain v2, o un agente) se persiste en coexistence.ia360_ideas y genera una
// tarjeta de ruteo al owner con 4 destinos. Reusa el patrón tarjeta-aprobación
// (sendOwnerInteractive + handler owner_*). Las tarjetas van SOLO al owner.
const IA360_IDEAS_STATUS_BY_ACTION = {
  owner_idea_prod: 'routed_production',
  owner_idea_docs: 'routed_docs',
  owner_idea_crm: 'routed_crm',
  owner_idea_reject: 'rejected',
};

async function insertIa360Idea({ fuente, contactNumber, texto, contexto }) {
  const { rows } = await pool.query(
    `INSERT INTO coexistence.ia360_ideas (fuente, contact_number, texto, contexto_json)
     VALUES ($1,$2,$3,$4::jsonb) RETURNING id`,
    [fuente, contactNumber || null, texto, JSON.stringify(contexto || {})]
  );
  return rows[0].id;
}

async function sendIa360IdeaCard({ record, ideaId, texto, fuente, contactNumber = null }) {
  const origen = fuente === 'owner' ? 'tuya' : `de la conversación con ${contactNumber || 'un contacto'}`;
  const preview = texto.length > 480 ? `${texto.slice(0, 477)}...` : texto;
  return sendOwnerInteractive({
    record,
    label: `owner_idea_card_${ideaId}`,
    messageBody: `IA360: idea #${ideaId} capturada`,
    ownerBudget: true,
    interactive: {
      type: 'list',
      header: { type: 'text', text: `Idea #${ideaId} capturada` },
      body: { text: `Alek, capturé esta idea (${origen}):\n\n"${preview}"\n\n¿A dónde la ruteo?` },
      footer: { text: 'Bandeja de ideas · IA360' },
      action: {
        button: 'Rutear',
        sections: [{
          title: 'Destinos',
          rows: [
            { id: `owner_idea_prod:${ideaId}`, title: 'Producción', description: 'Backlog de producción (routed_production)' },
            { id: `owner_idea_docs:${ideaId}`, title: 'Documentar', description: 'Encolar al vault local AlekContenido (ia360_docs_sync)' },
            { id: `owner_idea_crm:${ideaId}`, title: 'CRM', description: 'Crear nota en EspoCRM ligada al contacto' },
            { id: `owner_idea_reject:${ideaId}`, title: 'Rechazar', description: 'Descartar; puedes responder con el motivo' },
          ],
        }],
      },
    },
  });
}

async function handleIa360OwnerIdeaCommand({ record, texto }) {
  const ideaId = await insertIa360Idea({
    fuente: 'owner',
    contactNumber: IA360_OWNER_NUMBER,
    texto,
    contexto: { source: 'owner_command', message_id: record.message_id, captured_at: new Date().toISOString() },
  });
  const sent = await sendIa360IdeaCard({ record, ideaId, texto, fuente: 'owner' });
  if (!sent) {
    await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'idea_card_fail', body: `Idea #${ideaId} guardada, pero no pude mandar la tarjeta; queda pending en la bandeja.`, ownerBudget: true });
  }
}

async function handleIa360OwnerIdeaRoute({ record, ownerAction, ideaId }) {
  const status = IA360_IDEAS_STATUS_BY_ACTION[ownerAction];
  const idNum = String(ideaId || '').replace(/\D/g, '');
  if (!status || !idNum) return;
  const { rows } = await pool.query(
    `UPDATE coexistence.ia360_ideas
        SET status=$1, routed_at=now(), approved_by=$2
      WHERE id=$3 AND status='pending'
      RETURNING id, fuente, contact_number, texto, contexto_json`,
    [status, IA360_OWNER_NUMBER, idNum]
  );
  if (!rows.length) {
    await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'idea_route_dup', body: `La idea #${idNum} ya estaba ruteada (o no existe). No hice cambios.`, ownerBudget: true });
    return;
  }
  const idea = rows[0];
  let ack;
  if (status === 'routed_production') {
    ack = `Idea #${idea.id} marcada para PRODUCCIÓN (routed_production). Queda en la bandeja para la siguiente ventana de implementación.`;
  } else if (status === 'routed_docs') {
    const titulo = idea.texto.length > 80 ? `${idea.texto.slice(0, 77)}...` : idea.texto;
    const contenido = `# Idea #${idea.id}\n\n- Fuente: ${idea.fuente}\n- Contacto: ${idea.contact_number || '-'}\n- Capturada: ${new Date().toISOString()}\n\n${idea.texto}\n\nContexto: ${JSON.stringify(idea.contexto_json || {})}`;
    await pool.query(
      `INSERT INTO coexistence.ia360_docs_sync (idea_id, titulo, contenido, destino) VALUES ($1,$2,$3,'AlekContenido')`,
      [idea.id, titulo, contenido]
    );
    ack = `Idea #${idea.id} encolada para DOCUMENTAR (ia360_docs_sync, destino AlekContenido). La ventana local drena la cola al vault.`;
  } else if (status === 'routed_crm') {
    const identifier = idea.fuente === 'owner' ? IA360_OWNER_NUMBER : (idea.contact_number || IA360_OWNER_NUMBER);
    let espoOk = false;
    try {
      const { rows: cRows } = await pool.query(
        `SELECT custom_fields->>'espo_id' AS espo_id, COALESCE(name, profile_name) AS name
           FROM coexistence.contacts WHERE contact_number=$1 ORDER BY updated_at DESC LIMIT 1`,
        [identifier]
      );
      const res = await fetch(N8N_IA360_UPSERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'whatsapp',
          identifier,
          espo_id: cRows[0]?.espo_id || null,
          name: cRows[0]?.name || null,
          intent: 'idea_captura',
          action: 'idea_routed_crm',
          extracted: { idea_id: idea.id, fuente: idea.fuente },
          last_message: `[IDEA #${idea.id}] ${idea.texto}`,
          transcript_stored: false,
        }),
      });
      espoOk = res.ok;
    } catch (e) {
      console.error('[ia360-ideas] espo route error:', e.message);
    }
    ack = espoOk
      ? `Idea #${idea.id} reflejada en EspoCRM como nota del contacto ${identifier} (routed_crm).`
      : `Idea #${idea.id} quedó routed_crm, pero el upsert a EspoCRM falló; revisa el workflow n8n.`;
  } else {
    ack = `Idea #${idea.id} RECHAZADA. Si quieres, responde con el motivo y lo dejamos registrado.`;
  }
  await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: `idea_route_${status}`, body: ack, ownerBudget: true });
}

// POST al workflow n8n de cancelar (borra Calendar + Zoom). Requiere User-Agent
// tipo Chrome por Cloudflare (los otros helpers n8n no lo necesitan; este SI).
async function cancelIa360Booking({ calendarEventId, zoomMeetingId }) {
  const url = process.env.N8N_IA360_CANCEL_WEBHOOK_URL || 'https://n8n.geekstudio.dev/webhook/ia360-calendar-cancel';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ calendarEventId: calendarEventId || '', zoomMeetingId: zoomMeetingId || '' }),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) { console.error('[ia360-cancel] webhook failed:', res.status, text); return { ok: false, status: res.status }; }
    return { ok: true, body: text };
  } catch (err) {
    console.error('[ia360-cancel] webhook error:', err.message);
    return { ok: false, error: err.message };
  }
}

// ── MULTI-CITA: helpers de lista de reservas ─────────────────────────────────
// Un contacto puede tener VARIAS reuniones. La fuente de verdad es el customField
// `ia360_bookings` = array JSON de {start, event_id, zoom_id}. Los campos sueltos
// (ia360_booking_event_id/zoom_id/start) se conservan por compat pero ya NO mandan.

// Lee el array de reservas de un contacto. Si `ia360_bookings` esta vacio pero hay
// campos sueltos legacy (una cita previa al multi-cita), sintetiza un array de 1
// elemento para que el cancelar siga funcionando sobre data preexistente.
async function loadIa360Bookings(contactNumber) {
  try {
    const { rows } = await pool.query(
      `SELECT custom_fields->'ia360_bookings'             AS arr,
              custom_fields->>'ia360_booking_event_id'    AS evt,
              custom_fields->>'ia360_booking_zoom_id'     AS zoom,
              custom_fields->>'ia360_booking_start'       AS start
         FROM coexistence.contacts WHERE contact_number=$1
        ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
      [contactNumber]
    );
    if (!rows.length) return [];
    let arr = rows[0].arr;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (_) { arr = null; } }
    if (Array.isArray(arr) && arr.length) {
      return arr.filter(b => b && (b.event_id || b.zoom_id));
    }
    // Fallback legacy: una sola cita en campos sueltos.
    if (rows[0].evt || rows[0].zoom) {
      return [{ start: rows[0].start || '', event_id: rows[0].evt || '', zoom_id: rows[0].zoom || '' }];
    }
    return [];
  } catch (err) {
    console.error('[ia360-multicita] loadIa360Bookings error:', err.message);
    return [];
  }
}

// Gap#5: list_bookings debe reflejar la REALIDAD aunque el cache `ia360_bookings` se
// haya desincronizado (append fallido, edición directa en Calendar, limpieza). Unimos
// el cache con las citas FUTURAS registradas en `ia360_meeting_links` (fuente durable
// escrita al agendar), dedup por event_id. El cancel borra de AMBOS (removeIa360Booking),
// así que una cita cancelada NO reaparece aquí. Solo se usa para LISTAR (read-only); el
// cancel/append/find siguen usando loadIa360Bookings (que conserva zoom_id).
async function loadIa360BookingsForList(contactNumber) {
  const cached = await loadIa360Bookings(contactNumber);
  try {
    const { rows } = await pool.query(
      `SELECT event_id, start_utc
         FROM coexistence.ia360_meeting_links
        WHERE contact_number = $1 AND kind = 'cal' AND start_utc > now()
        ORDER BY start_utc ASC`,
      [contactNumber]
    );
    const seen = new Set(cached.map(b => String(b.event_id || '').toLowerCase()).filter(Boolean));
    const merged = cached.slice();
    for (const r of rows) {
      const eid = String(r.event_id || '').toLowerCase();
      if (!eid || seen.has(eid)) continue;
      seen.add(eid);
      merged.push({ start: r.start_utc ? new Date(r.start_utc).toISOString() : '', event_id: r.event_id || '', zoom_id: '' });
    }
    merged.sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
    if (merged.length !== cached.length) {
      console.log('[ia360-list] reconciled contact=%s cache=%d -> merged=%d (meeting_links)', contactNumber, cached.length, merged.length);
    }
    return merged;
  } catch (err) {
    console.error('[ia360-multicita] loadIa360BookingsForList error:', err.message);
    return cached;
  }
}

// Append idempotente: agrega una cita al array `ia360_bookings` (read-modify-write).
// Dedup por event_id (case-insensitive). Conserva los campos sueltos por compat.
async function appendIa360Booking({ waNumber, contactNumber, booking }) {
  const current = await loadIa360Bookings(contactNumber);
  const eid = String(booking.event_id || '').toLowerCase();
  const next = current.filter(b => String(b.event_id || '').toLowerCase() !== eid || !eid);
  next.push({ start: booking.start || '', event_id: booking.event_id || '', zoom_id: booking.zoom_id || '' });
  console.log('[ia360-multicita] append event=%s -> %d cita(s)', booking.event_id || '-', next.length);
  await mergeContactIa360State({
    waNumber,
    contactNumber,
    customFields: { ia360_bookings: next },
  });
  return next;
}

// Formato corto CDMX para filas/copy: "Jue 4 jun 5:00pm".
function fmtIa360Short(startRaw) {
  if (!startRaw) return 'la fecha agendada';
  try {
    const d = new Date(startRaw);
    const wd = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', weekday: 'short' }).format(d).replace('.', '');
    const day = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric' }).format(d);
    const mon = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', month: 'short' }).format(d).replace('.', '');
    let time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toLowerCase().replace(/\s/g, '');
    if (time.endsWith(':00am') || time.endsWith(':00pm')) time = time.replace(':00', '');
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    return `${cap(wd)} ${day} ${mon} ${time}`;
  } catch (_) { return 'la fecha agendada'; }
}

// Formato medio CDMX (para confirmaciones largas).
function fmtIa360Medium(startRaw) {
  if (!startRaw) return 'la fecha agendada';
  try {
    return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(startRaw));
  } catch (_) { return 'la fecha agendada'; }
}

// Fecha LOCAL CDMX (YYYY-MM-DD) de un start UTC, para filtrar por dia. NO comparar
// el ISO UTC directo: 2026-06-05T01:00Z es 4-jun en CDMX.
function ymdIa360CDMX(startRaw) {
  if (!startRaw) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(startRaw));
  } catch (_) { return ''; }
}

// Nombra un dia (recibido como 'YYYY-MM-DD', p.ej. el date pedido por el prospecto)
// en CDMX con dia de semana + dia + mes: "miércoles 10 de junio". OJO: un
// 'YYYY-MM-DD' pelon se parsea como medianoche UTC; en CDMX (UTC-6/-5) eso "retrocede"
// al dia anterior. Anclamos a mediodia UTC (12:00Z) para que el dia de calendario
// quede fijo sin importar el offset. Devuelve '' si la fecha es invalida.
function fmtIa360DiaPedido(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return '';
  try {
    const d = new Date(String(ymd) + 'T12:00:00Z');
    const s = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    // es-MX devuelve "miércoles, 10 de junio" → quitamos la coma tras el dia de semana.
    return s.replace(',', '');
  } catch (_) { return ''; }
}

// Formato largo CDMX para LISTAR reuniones del contacto: "Jueves 9 jun, 10:00 a.m.".
// Dia de semana COMPLETO + dia + mes corto + hora con a.m./p.m. (estilo MX). Usa el
// start UTC real de la cita (no un YYYY-MM-DD), asi que NO necesita el ancla de mediodia.
function fmtIa360Listado(startRaw) {
  if (!startRaw) return 'la fecha agendada';
  try {
    const d = new Date(startRaw);
    const wd = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long' }).format(d);
    const day = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric' }).format(d);
    const mon = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', month: 'short' }).format(d).replace('.', '');
    let time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toLowerCase();
    time = time.replace(/\s*am$/, ' a.m.').replace(/\s*pm$/, ' p.m.');
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    return `${cap(wd)} ${day} ${mon}, ${time}`;
  } catch (_) { return 'la fecha agendada'; }
}

// Notifica al OWNER (Alek) para aprobar la cancelacion de UNA cita concreta. El
// boton "Aprobar" lleva el event_id de ESA cita (owner_cancel_yes:<event_id>) para
// que la rama owner cancele exactamente esa. "Llamarlo"/"Mantener" llevan el numero
// del contacto (no necesitan event_id). El copy incluye la fecha/hora CDMX de la cita.
async function notifyOwnerCancelForBooking({ record, contactNumber, booking }) {
  const startFmt = fmtIa360Medium(booking.start);
  return sendOwnerInteractive({
    record,
    label: 'owner_cancel_request',
    messageBody: `IA360: ${contactNumber} pidió cancelar`,
    interactive: {
      type: 'button',
      header: { type: 'text', text: 'Cancelación solicitada' },
      body: { text: `Alek, un contacto (${contactNumber}) pidió cancelar su reunión del ${startFmt} (CDMX). ¿Qué hago?` },
      footer: { text: 'IA360 · humano en el bucle' },
      action: { buttons: [
        { type: 'reply', reply: { id: `owner_cancel_yes:${booking.event_id}`, title: 'Aprobar' } },
        { type: 'reply', reply: { id: `owner_cancel_call:${contactNumber}`, title: 'Llamarlo' } },
        { type: 'reply', reply: { id: `owner_cancel_keep:${contactNumber}`, title: 'Mantener' } },
      ] },
    },
  });
}

// Resuelve una cita por event_id (case-insensitive) a traves de TODOS los contactos.
// En la rama owner, `record` es Alek; el boton solo trae el event_id, asi que este
// lateral join nos da el contacto duenno + los datos de la cita de un tiro.
async function findBookingByEventId(eventId) {
  if (!eventId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT c.contact_number AS contact_number,
              c.wa_number      AS wa_number,
              elem->>'event_id' AS event_id,
              elem->>'zoom_id'  AS zoom_id,
              elem->>'start'    AS start
         FROM coexistence.contacts c,
              LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(c.custom_fields->'ia360_bookings')='array'
                     THEN c.custom_fields->'ia360_bookings' ELSE '[]'::jsonb END
              ) elem
        WHERE lower(elem->>'event_id') = lower($1)
        ORDER BY c.updated_at DESC NULLS LAST
        LIMIT 1`,
      [eventId]
    );
    if (rows.length) return rows[0];
    // Fallback legacy: cita en campos sueltos (sin array).
    const { rows: legacy } = await pool.query(
      `SELECT contact_number, wa_number,
              custom_fields->>'ia360_booking_event_id' AS event_id,
              custom_fields->>'ia360_booking_zoom_id'  AS zoom_id,
              custom_fields->>'ia360_booking_start'    AS start
         FROM coexistence.contacts
        WHERE lower(custom_fields->>'ia360_booking_event_id') = lower($1)
        ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
      [eventId]
    );
    return legacy[0] || null;
  } catch (err) {
    console.error('[ia360-multicita] findBookingByEventId error:', err.message);
    return null;
  }
}

// Quita una cita (por event_id, case-insensitive) del array `ia360_bookings` de un
// contacto y reescribe el array. Devuelve el array resultante (puede quedar vacio).
async function removeIa360Booking({ waNumber, contactNumber, eventId }) {
  const current = await loadIa360Bookings(contactNumber);
  const eid = String(eventId || '').toLowerCase();
  const next = current.filter(b => String(b.event_id || '').toLowerCase() !== eid);
  console.log('[ia360-multicita] remove event=%s -> %d cita(s)', String(eventId || '-'), next.length);
  const extra = { ia360_bookings: next };
  // Si la cita removida era la "ultima" reflejada en campos sueltos, limpialos.
  extra.ia360_booking_event_id = next.length ? (next[next.length - 1].event_id || '') : '';
  extra.ia360_booking_zoom_id = next.length ? (next[next.length - 1].zoom_id || '') : '';
  extra.ia360_booking_start = next.length ? (next[next.length - 1].start || '') : '';
  // Gap#5: mantener `ia360_meeting_links` en sync para que list_bookings (que también
  // lee de ahí) NO resucite una cita cancelada (la tabla no tiene columna status).
  try {
    await pool.query(`DELETE FROM coexistence.ia360_meeting_links WHERE lower(event_id) = lower($1)`, [String(eventId || '')]);
  } catch (e) { console.error('[ia360-multicita] meeting_links cleanup error:', e.message); }
  await mergeContactIa360State({ waNumber, contactNumber, customFields: extra });
  return next;
}

// Mensaje "pasivo": cortesías/cierres que NO ameritan fallback ni alerta al owner
// (responderlos con "déjame revisarlo con Alek" sería ruido). Si un mensaje pasivo
// no se respondió, se deja pasar en silencio (es lo correcto).
function isIa360PassiveMessage(body) {
  const t = String(body || '').trim();
  if (!t) return true;
  return /^(gracias|ok|okay|va|perfecto|listo|nos vemos|de acuerdo|sale|vale)\b/i.test(t);
}

// ── PRODUCTION-HARDENING: fallback universal + log + alerta al owner ──────────
// Se dispara cuando un mensaje ACCIONABLE (dentro del embudo IA360) no se resolvió,
// o cuando una excepción tumbó el handler. Hace 3 cosas, todo defensivo (un fallo
// aquí NUNCA debe re-lanzar ni dejar al contacto en silencio):
//   1) INSERT una fila en coexistence.ia360_bot_failures (status 'abierto') → id.
//   2) Manda al CONTACTO el fallback "Recibí tu mensaje…" (si no se le respondió ya).
//   3) ALERTA al owner (Alek, free-form) con 3 botones: Lo tomo / Comentar / Ignorar,
//      cada uno cargando el <id> de la fila para cerrar el loop después.
// `reason` = 'no-manejado' (accionable sin resolver) o 'error: <msg>' (excepción).
// `alreadyResponded` evita doble-texto si el flujo ya le dijo algo al contacto.
async function handleIa360BotFailure({ record, reason, alreadyResponded = false }) {
  const fallbackBody = 'Recibí tu pregunta. Para responderte bien y no darte una respuesta incompleta, voy a revisar el contexto con Alek y te confirmo por aquí en breve.';
  let failureId = null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO coexistence.ia360_bot_failures
         (contact_number, contact_message, reason, bot_fallback, status)
       VALUES ($1, $2, $3, $4, 'abierto')
       RETURNING id`,
      [record.contact_number || null, record.message_body || null, reason || 'no-manejado', fallbackBody]
    );
    failureId = rows[0]?.id || null;
  } catch (dbErr) {
    console.error('[ia360-failure] insert error:', dbErr.message);
  }
  // 2) Fallback al contacto (nunca silencio). Solo si no se le respondió ya.
  if (!alreadyResponded) {
    try {
      await enqueueIa360Text({ record, label: 'ia360_fallback_no_silence', body: fallbackBody });
    } catch (sendErr) {
      console.error('[ia360-failure] contact fallback send error:', sendErr.message);
    }
  }
  // 3) Alerta al owner con botones para cerrar el loop (solo si tenemos id).
  // G-BRAIN: los contactos QA (rango exacto 52199900XXXXX) NUNCA alertan al
  // WhatsApp real del owner — el failure queda registrado en ia360_bot_failures +
  // evidencia QA, y se acabó. (Las 4 tarjetas "el bot no resolvió un mensaje de
  // 5219990000950" del 06-11 eran ruido de harness en el teléfono de Alek.)
  // OJO (hallazgo de review): patrón QA exacto, NO ^521999 — 999 es la lada de
  // Mérida y un cliente real de ahí debe seguir alertando al owner.
  if (failureId != null && IA360_QA_NUMBER_RE.test(String(record.contact_number || ''))) {
    await recordIa360QaEvidence({
      record,
      toNumber: IA360_OWNER_NUMBER,
      kind: 'owner_bot_failure_suppressed',
      label: 'owner_bot_failure',
      messageBody: `IA360: el bot no resolvió un mensaje de ${record.contact_number} (${String(reason || 'no-manejado').slice(0, 80)})`,
    }).catch(() => {});
    return failureId;
  }
  if (failureId != null) {
    try {
      const reasonShort = String(reason || 'no-manejado').slice(0, 80);
      await sendOwnerInteractive({
        record,
        label: 'owner_bot_failure',
        messageBody: `IA360: el bot no resolvió un mensaje de ${record.contact_number || 'desconocido'}`,
        interactive: {
          type: 'button',
          body: { text: `Alek, el bot no resolvió un mensaje de ${record.contact_number || 'desconocido'}: "${String(record.message_body || '').slice(0, 300)}" (${reasonShort}). ¿Qué hago?` },
          action: {
            buttons: [
              { type: 'reply', reply: { id: `owner_take_fail:${failureId}`, title: 'Lo tomo' } },
              { type: 'reply', reply: { id: `owner_comment_fail:${failureId}`, title: 'Comentar' } },
              { type: 'reply', reply: { id: `owner_ignore_fail:${failureId}`, title: 'Ignorar' } },
            ],
          },
        },
      });
    } catch (ownerErr) {
      console.error('[ia360-failure] owner alert error:', ownerErr.message);
    }
  }
  return failureId;
}

// ── G-LIVE: invariante estructural no-silencio (watchdog por inbound) ────────────
// La clase del incidente Andrés (38 min mudo): una rama "marca como manejado" sin
// egress real. La verdad no es ningún flag en memoria: es la fila outgoing en
// chat_history (insertPendingRow la escribe al encolar, así que es visible de
// inmediato). 75 s después del inbound de un cliente activo/beta (o con deal
// ganado), si no existe NINGÚN outgoing hacia ese contacto desde el inbound =>
// holding + alerta al owner + failure registrado. Cubre toda rama presente o
// futura (texto, botones, audio, vCard) sin parchar rama por rama. El dedupe de
// resolveIa360Outbound (ia360_handler_for = message_id) lo hace idempotente.
const IA360_NO_SILENCE_WATCHDOG_MS = 75000;

async function ia360HasOutgoingForInbound(record) {
  // Escape de comodines LIKE: los wamid del harness pueden traer '_' o '%'.
  const wamidLike = String(record.message_id || '~none~').replace(/[\\%_]/g, '\\$&');
  const { rows } = await pool.query(
    `SELECT 1
       FROM coexistence.chat_history o
      WHERE o.direction = 'outgoing'
        AND o.contact_number = $1
        AND COALESCE(o.status, '') NOT IN ('failed', 'error')
        AND (o.template_meta->>'ia360_handler_for' LIKE $2 || '%'
             OR o.timestamp >= (SELECT i.timestamp FROM coexistence.chat_history i
                                 WHERE i.message_id = $3 LIMIT 1))
      LIMIT 1`,
    [record.contact_number, wamidLike, record.message_id || '~none~']
  );
  return rows.length > 0;
}

async function ia360IsWatchedActiveContact(record) {
  const contact = await loadIa360ContactContext(record).catch(() => null);
  if (isIa360ClienteActivoBetaContact(contact)) return true;
  // Cliente con deal GANADO sin marca beta en contacts: también es cliente real
  // activo que jamás debe quedar en silencio (hallazgo alta de la auditoría 06-11).
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM coexistence.deals d
         JOIN coexistence.pipeline_stages s ON s.id = d.stage_id
        WHERE d.contact_wa_number = $1 AND d.contact_number = $2
          AND (s.stage_type = 'won' OR s.name = 'Ganado')
        LIMIT 1`,
      [record.wa_number, record.contact_number]
    );
    return rows.length > 0;
  } catch (e) {
    console.error('[ia360-no-silence] won-deal check error:', e.message);
    return false;
  }
}

async function ia360NoSilenceWatchdogCheck(record) {
  if (!(await ia360IsWatchedActiveContact(record))) return;
  if (await ia360HasOutgoingForInbound(record)) return;
  console.error('[ia360-no-silence] INVARIANTE DISPARADO contact=%s message=%s type=%s',
    maskIa360Number(record.contact_number), record.message_id, record.message_type);
  await handleIa360BotFailure({
    record,
    reason: `invariante no-silencio: sin fila outgoing en chat_history ${Math.round(IA360_NO_SILENCE_WATCHDOG_MS / 1000)}s después del inbound de cliente activo/beta`,
    alreadyResponded: false,
  });
}

function scheduleIa360NoSilenceWatchdog(record) {
  try {
    if (!record || record.direction !== 'incoming') return;
    if (record.message_type === 'status' || record.message_type === 'reaction' || record.message_type === 'sticker') return;
    if (!record.message_id) return; // sin wamid no hay forma confiable de verificar el egress
    const n = normalizePhone(record.contact_number);
    if (!n || n === IA360_OWNER_NUMBER) return;
    // Texto pasivo ("gracias", "ok") no exige respuesta (diseño deliberado Gap#1).
    if (record.message_type === 'text' && isIa360PassiveMessage(record.message_body)) return;
    // Subset del record: no retener raw_payload (batches n8n) en memoria 75 s.
    const slim = {
      wa_number: record.wa_number,
      contact_number: record.contact_number,
      contact_name: record.contact_name || null,
      message_id: record.message_id,
      message_type: record.message_type,
      message_body: record.message_body || null,
      direction: record.direction,
    };
    const t = setTimeout(() => {
      ia360NoSilenceWatchdogCheck(slim).catch(e =>
        console.error('[ia360-no-silence] watchdog error:', e.message));
    }, IA360_NO_SILENCE_WATCHDOG_MS);
    if (typeof t.unref === 'function') t.unref();
  } catch (e) {
    console.error('[ia360-no-silence] schedule error:', e.message);
  }
}

// G-LIVE: un deploy/restart dentro de la ventana del watchdog perdería los timers en
// memoria — y el deploy es justo el momento de mayor riesgo de egress roto. Al boot,
// re-escanear los inbounds recientes (15 min) de no-owner y re-correr el check.
const ia360BootRescanTimer = setTimeout(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT message_id, wa_number, contact_number, message_type, message_body
         FROM coexistence.chat_history
        WHERE direction = 'incoming'
          AND message_type NOT IN ('status', 'reaction', 'sticker')
          AND timestamp > NOW() - INTERVAL '15 minutes'`
    );
    let checked = 0;
    for (const r of rows) {
      if (!r.message_id) continue;
      if (normalizePhone(r.contact_number) === IA360_OWNER_NUMBER) continue;
      if (r.message_type === 'text' && isIa360PassiveMessage(r.message_body)) continue;
      checked += 1;
      await ia360NoSilenceWatchdogCheck({ ...r, direction: 'incoming' })
        .catch(e => console.error('[ia360-no-silence] boot rescan check:', e.message));
    }
    if (checked) console.log('[ia360-no-silence] boot rescan: %d inbound(s) recientes revisados', checked);
  } catch (e) {
    console.error('[ia360-no-silence] boot rescan error:', e.message);
  }
}, 90000);
if (typeof ia360BootRescanTimer.unref === 'function') ia360BootRescanTimer.unref();

async function handleIa360FreeText(record) {
  // PRODUCTION-HARDENING (fallback universal — cero silencio): estos dos flags viven a
  // nivel de FUNCION (no del try) para que el catch terminal pueda verlos.
  //  - responded: se pone true cada vez que enviamos ALGO al contacto/owner.
  //  - dealFound: true SOLO cuando el contacto está dentro del embudo IA360 activo
  //    (pasó el guard `!deal`). El fallback/alerta SOLO aplica a deals existentes
  //    no-resueltos (la misión: "deal en estado no-match"), NUNCA a desconocidos sin
  //    deal (esos los maneja evaluateTriggers en paralelo; doblar respuesta = ruido).
  let responded = false;
  let dealFound = false;
  try {
    if (!record || record.direction !== 'incoming' || record.message_type !== 'text') return;
    if (!record.message_body || !String(record.message_body).trim()) return;
    const deal = await getActiveNonTerminalIa360Deal(record);
    if (!deal) return; // only inside an active, non-terminal IA360 funnel
    dealFound = true;
    const contactContext = deal.contact_context || await loadIa360ContactContext(record).catch(() => null);
    if (deal.memory_mode === 'cliente_activo_beta_supervisado' || isIa360ClienteActivoBetaContact(contactContext)) {
      // G-LIVE (P0 producción): cliente activo/beta SIEMPRE recibe respuesta real.
      // 1) Captura de memoria: aprendizaje en segundo plano REAL (fire-and-forget,
      //    no suma latencia al camino caliente) y NUNCA cuenta como respuesta (la
      //    clase del bug de Andrés: dry-run devolvía true y el padre creía que ya
      //    había respondido).
      handleIa360ClienteActivoBetaLearning({ record, deal, contact: contactContext, captureOnly: true })
        .catch(e => console.error('[ia360-memory] capture error:', e.message));

      // 2) Datos vivos del portal del cliente: WhatsApp no tiene acceso => handoff
      //    explícito y honesto. NUNCA inventar listas ni cifras.
      if (isIa360PortalLiveDataQuestion(record.message_body)) {
        const sentHandoff = await enqueueIa360Text({
          record,
          label: 'ia360_cliente_activo_portal_handoff',
          body: 'Ese dato vive en el portal y prefiero confirmarte la cifra exacta antes que darte una aproximación. Lo reviso con Alek y te confirmo por aquí en breve.',
        });
        if (sentHandoff) responded = true;
        await handleIa360BotFailure({
          record,
          reason: 'handoff: pregunta de datos vivos del portal del cliente (sin acceso desde WhatsApp)',
          alreadyResponded: sentHandoff === true,
        }).catch(e => console.error('[ia360-failure] portal handoff alert error:', e.message));
        return;
      }

      // 3) Respuesta REAL del agente IA (memoria incluida vía memory-lookup del
      //    workflow). UNA sola respuesta; prohibidas cadenas de "corrijo".
      //    [qa-force-agent-down] simula agente caído SOLO para números QA (E2E).
      const qaForceDown = IA360_QA_NUMBER_RE.test(String(record.contact_number || ''))
        && /\[qa-force-agent-down\]/i.test(String(record.message_body || ''));
      // G-BRAIN: estado conversacional + memoria precargada también para beta —
      // mismo presupuesto de preguntas, cierre con opciones y no-repetir.
      const betaConvState = loadIa360ConvState(contactContext);
      let betaMemory = null;
      try {
        betaMemory = await lookupIa360MemoryContext({ record, contact: contactContext, limit: 8 });
      } catch (e) {
        console.error('[ia360-agent] beta memory lookup failed:', e.message);
      }
      const agentBeta = qaForceDown
        ? null
        : await callIa360Agent({
            record,
            stageName: deal.stage_name,
            roleHint: [
              buildIa360ClienteActivoBetaRoleHint(contactContext),
              buildIa360ConversationRoleHint({ contact: contactContext, stageName: deal.stage_name, convState: betaConvState, memory: betaMemory, messageBody: record.message_body }),
            ].join(' | '),
            memory: betaMemory,
          });
      let betaReply = agentBeta && typeof agentBeta.reply === 'string' ? agentBeta.reply.trim() : '';
      // Deuda G-LIVE cerrada: post-filtro de pitch en código. Si el contacto es
      // do_not_pitch y el reply huele a venta, NO sale: respuesta segura + aviso.
      if (betaReply && isIa360DoNotPitchContact(contactContext) && ia360ReplySmellsLikePitch(betaReply)) {
        console.error('[ia360-agent] post-filtro pitch: reply bloqueado para do_not_pitch contact=%s', maskIa360Number(record.contact_number));
        sendIa360DirectText({
          record,
          toNumber: IA360_OWNER_NUMBER,
          label: 'owner_beta_pitch_blocked',
          body: `IA360: bloqueé un reply con tono de venta para ${record.contact_name || record.contact_number} (do_not_pitch). Reply original: "${betaReply.slice(0, 200)}"`,
          targetContact: record.contact_number,
          ownerBudget: true,
        }).catch(e => console.error('[ia360-agent] pitch-block alert error:', e.message));
        betaReply = 'Tomo nota de esto y lo dejo registrado para Alek. Si te sirve, en el siguiente paso te confirmo cómo queda y seguimos por aquí.';
      }
      if (betaReply) {
        const sentBeta = await enqueueIa360AgentReply({ record, label: 'ia360_cliente_activo_beta_agent_reply', body: betaReply });
        if (sentBeta === 'superseded') {
          // Otra ruta (botón/secuencia) ya contestó este intercambio: no alertar.
          responded = true;
          return;
        }
        if (sentBeta) {
          updateIa360ConvState({ record, contact: contactContext, agent: agentBeta, replyBody: betaReply, convState: betaConvState })
            .catch(e => console.error('[ia360-conv-state] beta update error:', e.message));
          // Gestión de citas detectada por el agente: la acción de calendario del
          // embudo no aplica al pseudo-deal beta, así que el loop lo cierra Alek.
          const betaAction = String(agentBeta.action || agentBeta.intent || '');
          if (['list_bookings', 'cancel', 'reschedule', 'offer_slots', 'book'].includes(betaAction)) {
            sendIa360DirectText({
              record,
              toNumber: IA360_OWNER_NUMBER,
              label: 'owner_beta_meeting_intent',
              body: `IA360: el cliente activo/beta ${record.contact_name || record.contact_number} pidió gestión de cita (${betaAction}): "${String(record.message_body || '').slice(0, 140)}". Ya le respondí, pero la acción de calendario requiere tu confirmación.`,
              targetContact: record.contact_number,
              ownerBudget: true,
            }).catch(e => console.error('[ia360-agent] beta meeting alert error:', e.message));
          }
          responded = true;
          return;
        }
      }

      // 4) Holding SOLO si el agente falló o no devolvió respuesta utilizable:
      //    holding al contacto + alerta al owner + failure registrado.
      await handleIa360BotFailure({
        record,
        reason: 'cliente activo/beta: agente IA sin respuesta utilizable (caído, timeout o reply vacío)',
        alreadyResponded: false,
      }).catch(e => console.error('[ia360-failure] cliente-activo fallback error:', e.message));
      responded = true;
      return;
    }
    // G-BRAIN: la conversación del embudo también lleva estado (presupuesto de
    // preguntas, no-repetir, cierre con opciones, modo por etapa) + memoria del
    // contacto inyectada vía roleHint — el caso José Ramón: 8 preguntas seguidas
    // sin propuesta con el deal YA en "Dolor calificado".
    const convContact = await loadIa360ContactContext(record).catch(() => null);
    const convState = loadIa360ConvState(convContact);
    let convMemory = null;
    try {
      convMemory = await lookupIa360MemoryContext({ record, contact: convContact, limit: 8 });
    } catch (e) {
      console.error('[ia360-agent] conv memory lookup failed:', e.message);
    }
    const agent = await callIa360Agent({
      record,
      stageName: deal.stage_name,
      roleHint: buildIa360ConversationRoleHint({ contact: convContact, stageName: deal.stage_name, convState, memory: convMemory, messageBody: record.message_body }),
      memory: convMemory,
    });
    if (!agent || !agent.reply) {
      // Agent unavailable (n8n down / webhook unregistered) → holding reply, never silence.
      // G-BRAIN: vía enqueueIa360AgentReply — si otra ruta ya contestó, ni holding.
      await enqueueIa360AgentReply({ record, label: 'ia360_ai_holding', body: 'Déjame revisar esto y te confirmo en un momento.' }).catch(() => {});
      responded = true;
      // D) ALERTA AL OWNER si el cerebro del bot (n8n) está caído/timeout. Además del
      //    holding-reply de arriba (el contacto ya quedó atendido → alreadyResponded:true),
      //    logueamos en ia360_bot_failures + alertamos a Alek, para que se entere de que el
      //    agente IA no respondió (no solo silencio operativo).
      await handleIa360BotFailure({
        record,
        reason: 'agente IA no disponible (n8n caído o timeout)',
        alreadyResponded: true,
      }).catch(e => console.error('[ia360-failure] agent-down alert error:', e.message));
      return;
    }

    // C) LISTAR REUNIONES DEL CONTACTO ("¿cuáles tengo?"). VA ANTES del bloque
    // "Reunión agendada": casi todo el que pregunta esto YA tiene cita → está en esa
    // etapa, y ahí abajo caería al branch de reagendar. Es read-only (solo lee
    // ia360_bookings), por eso es seguro responder y returnear sin tocar el estado.
    console.log('[ia360-agent] contact=%s stage=%s action=%s intent=%s', record.contact_number, deal.stage_name, agent.action || '-', agent.intent || '-');
    // Reflejo CRM por interaccion (best-effort; no bloquea dispatch ni regresa agenda).
    reflectIa360ToEspoCrm({ record, agent, channel: 'whatsapp' }).catch(() => {});
    if (agent.action === 'list_bookings' || agent.intent === 'list_bookings') {
      const bookings = await loadIa360BookingsForList(record.contact_number);
      console.log('[ia360-list] contact=%s bookings=%d', record.contact_number, bookings.length);
      let body;
      if (!bookings.length) {
        body = 'Por ahora no tienes reuniones agendadas. ¿Quieres que agendemos una?';
      } else {
        const lines = bookings.map((b, i) => `${i + 1}) ${fmtIa360Listado(b.start)}`).join(String.fromCharCode(10));
        const n = bookings.length;
        const plural = n === 1 ? 'reunión agendada' : 'reuniones agendadas';
        body = `Tienes ${n} ${plural}:${String.fromCharCode(10)}${lines}`;
      }
      await enqueueIa360Text({ record, label: 'ia360_ai_list_bookings', body });
      responded = true;
      return;
    }

    // RESCHEDULE/CANCEL on an ALREADY-BOOKED meeting (deal at "Reunión agendada"):
    // do NOT auto-offer slots → tapping one would CREATE a 2nd meeting without
    // cancelling the existing one (double-book). True update needs the stored
    // calendarEventId/zoomMeetingId per contact (not persisted yet). Cheap, coherent
    // guard: acknowledge + hand off to Alek (Task), let him move/cancel the real event.
    if (deal.stage_name === 'Reunión agendada') {
      const isCancel = agent.action === 'cancel'
        || /cancel|anul|ya no (podr|voy|asist)/i.test(String(record.message_body || ''));

      // ── CANCELAR INTELIGENTE (multi-cita): resolvemos QUE cita cancelar.
      //   - cancelDate = agent.date (YYYY-MM-DD CDMX, puede venir null si fue vago).
      //   - candidates = citas de ESE dia (si hay date) o TODAS (si no hubo date).
      //   - 1 candidato  -> notificar al OWNER directo para esa cita (no re-preguntar).
      //   - >1 candidato -> mandar al CONTACTO una lista de esas citas (pickcancel:).
      //   - 0 candidatos -> avisar al contacto (segun si habia date o no habia ninguna).
      // Todo va dentro del try/catch terminal de handleIa360FreeText.
      if (isCancel) {
        const bookings = await loadIa360Bookings(record.contact_number);

        // SIN ninguna cita guardada → NO molestar al owner. Responder al contacto.
        if (!bookings.length) {
          await enqueueIa360Text({
            record,
            label: 'ia360_ai_cancel_no_meeting',
            body: 'No tienes reuniones activas a tu nombre para cancelar.',
          });
          responded = true;
          return;
        }

        const cancelDate = agent.date && /^\d{4}-\d{2}-\d{2}$/.test(String(agent.date)) ? String(agent.date) : null;
        const candidates = cancelDate
          ? bookings.filter(b => ymdIa360CDMX(b.start) === cancelDate)
          : bookings;

        // 0 candidatos con fecha pedida → no hay cita ese dia (pero si hay otras).
        if (candidates.length === 0) {
          await enqueueIa360Text({
            record,
            label: 'ia360_ai_cancel_no_match',
            body: 'No encuentro una reunión para esa fecha. ¿Me confirmas qué día era la que quieres cancelar?',
          });
          responded = true;
          return;
        }

        // >1 candidato → el CONTACTO elige cual cancelar (lista interactiva).
        if (candidates.length > 1) {
          await enqueueIa360Interactive({
            record,
            label: 'ia360_ai_cancel_pick',
            messageBody: 'IA360: ¿cuál reunión cancelar?',
            interactive: {
              type: 'list',
              header: { type: 'text', text: 'Cancelar reunión' },
              body: { text: 'Tienes varias reuniones agendadas. ¿Cuál quieres cancelar?' },
              footer: { text: 'IA360 · lo confirmo con Alek' },
              action: {
                button: 'Ver reuniones',
                sections: [{
                  title: 'Tus reuniones',
                  rows: candidates.slice(0, 10).map(b => ({
                    id: `pickcancel:${b.event_id}`,
                    title: String(fmtIa360Short(b.start)).slice(0, 24),
                    description: 'Toca para solicitar cancelarla',
                  })),
                }],
              },
            },
          });
          responded = true;
          return;
        }

        // 1 candidato → notificar al OWNER directo para ESA cita (sin re-preguntar).
        const target = candidates[0];
        await enqueueIa360Text({
          record,
          label: 'ia360_ai_cancel_request',
          body: 'Dame un momento, lo confirmo con Alek.',
        });
        responded = true;
        emitIa360N8nHandoff({
          record,
          eventType: 'meeting_cancel_requested',
          targetStage: 'Reunión agendada',
          priority: 'high',
          summary: `El contacto pidió CANCELAR su reunión del ${fmtIa360Medium(target.start)} (CDMX). Mensaje: "${record.message_body || ''}". Acción humana: aprobar/cancelar el evento Calendar/Zoom existente y confirmar al contacto.`,
        }).catch(e => console.error('[ia360-n8n] cancel handoff:', e.message));
        try {
          await notifyOwnerCancelForBooking({ record, contactNumber: record.contact_number, booking: target });
        } catch (ownerErr) {
          console.error('[ia360-owner] notify on cancel failed:', ownerErr.message);
        }
        return;
      }

      // ── NUEVO AGENDAMIENTO (multi-cita): el prospecto ya agendado pide OTRA reunión.
      // NO es reagendar (no mueve la existente): debe CAER al handler de offer_slots de
      // abajo, que consulta disponibilidad real y ofrece el menú multi-día. Por eso NO
      // hacemos return aquí — solo seguimos el flujo. El cfm_ posterior hará append a
      // ia360_bookings (segunda cita), sin tocar la primera.
      // Gap#1: SOLO una intención REAL de reagendar dispara el handoff a Alek. Un mensaje
      // normal (nurture/provide_info/ask_pain/smalltalk) NO es reagendar: debe CAER al
      // reply DEFAULT de abajo (respuesta conversacional), no al handoff de reschedule.
      const isReschedule = agent.action === 'reschedule' || agent.intent === 'reschedule'
        || /reagend|reprogram|posponer|adelantar|recorr|mover la (reuni|cita|llamad)|cambi(ar|a|o)?.{0,18}(d[ií]a|hora|fecha|horario)|otro d[ií]a|otra hora|otro horario|otra fecha/i.test(String(record.message_body || ''));
      if (agent.action === 'offer_slots' || agent.action === 'book') {
        // fall-through: el control sale del bloque "Reunión agendada" y continúa al
        // handler de offer_slots/book más abajo (no return).
      } else if (isReschedule) {
        // ── REAGENDAR: conserva ack + handoff (Alek mueve el evento a mano via la tarea
        // de EspoCRM). NO se ofrece "Aprobar".
        await enqueueIa360Text({
          record,
          label: 'ia360_ai_reschedule_request',
          body: 'Va, le paso a Alek que quieres mover la reunión. Él te confirma el nuevo horario por aquí en un momento.',
        });
        responded = true;
        emitIa360N8nHandoff({
          record,
          eventType: 'meeting_reschedule_requested',
          targetStage: 'Reunión agendada',
          priority: 'high',
          summary: `El contacto pidió REPROGRAMAR su reunión ya agendada. Mensaje: "${record.message_body || ''}". ${agent.date ? 'Fecha sugerida: ' + agent.date + '. ' : ''}Acción humana: mover el evento Calendar/Zoom existente a la nueva fecha (NO crear uno nuevo) y confirmar al contacto.`,
        }).catch(e => console.error('[ia360-n8n] reschedule handoff:', e.message));
        return;
      }
    }

    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'texto-libre-ia'],
      customFields: {
        ia360_ultima_respuesta: record.message_body,
        ultimo_cta_enviado: 'ia360_ai_agent_' + (agent.action || 'reply'),
        ...(agent.extracted && agent.extracted.area_operacion ? { area_operacion: agent.extracted.area_operacion } : {}),
      },
    });

    // OPT-OUT → reply + move to lost.
    if (agent.action === 'optout' || agent.intent === 'optout') {
      await syncIa360Deal({ record, targetStageName: 'Perdido / no fit', titleSuffix: 'Opt-out (texto libre)', notes: `Opt-out por texto libre: ${record.message_body}` });
      await enqueueIa360Text({ record, label: 'ia360_ai_optout', body: agent.reply });
      responded = true;
      return;
    }

    // OFFER SLOTS / BOOK → consulta disponibilidad REAL y ofrece horarios.
    // E2: desatorado. Antes el guard exigia `&& agent.date` y, sin fecha, caia al
    // reply vago. Ahora la intencion de agendar SIEMPRE dispara disponibilidad:
    //  - con fecha: consulta ese dia; si 0 slots, cae al spread next-available.
    //  - sin fecha (o "¿cuando si hay?"): spread multi-dia desde manana (ignora el
    //    date del LLM, que a veces viene mal). El menu ya trae el dia en cada fila.
    if (agent.action === 'offer_slots' || agent.action === 'book') {
      // COMPUERTA offer_slots: NO empujar el calendario. El agente puede inferir
      // agendar de una senal debil; pedimos confirmacion explicita. Solo el boton
      // gate_slots_yes (manejado abajo con return) muestra los horarios.
      await enqueueIa360Interactive({ record, label: 'ia360_gate_offer_slots', messageBody: 'IA360: confirmar horarios', interactive: { type: 'button', body: { text: (agent.reply ? agent.reply + String.fromCharCode(10) + String.fromCharCode(10) : '') + '¿Quieres que te pase horarios para una llamada con Alek?' }, action: { buttons: [ { type: 'reply', reply: { id: 'gate_slots_yes', title: 'Sí, ver horarios' } }, { type: 'reply', reply: { id: 'gate_slots_no', title: 'Todavía no' } } ] } } });
      responded = true;
      return;
      try {
        const url = process.env.N8N_IA360_AVAILABILITY_WEBHOOK_URL;
        // Sanitiza el date del LLM: solo una fecha ISO real (YYYY-MM-DD) es usable. A
        // veces el modelo devuelve un placeholder sin resolver ("<miércoles ...>") o
        // basura; en ese caso lo descartamos y caemos al barrido multi-día (no se
        // intenta consultar disponibilidad con una fecha inválida).
        const reqDate = agent.date && /^\d{4}-\d{2}-\d{2}$/.test(String(agent.date)) ? String(agent.date) : null;
        await syncIa360Deal({
          record,
          targetStageName: getIa360StageForEvent('agenda_preference_selected', 'Agenda en proceso'),
          titleSuffix: 'Agenda (texto libre)',
          notes: `Solicitó agenda por texto libre (${record.message_body}); fecha interpretada ${reqDate || 'sin fecha → próximos días'}; se consulta Calendar real`,
        });
        // helper: una llamada al webhook de disponibilidad con payload arbitrario.
        const callAvail = async (payload) => {
          if (!url) return null;
          try {
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ source: 'forgechat-ia360-webhook', workStartHour: 10, workEndHour: 18, slotMinutes: 60, ...payload }),
            });
            return r.ok ? await r.json() : null;
          } catch (e) { console.error('[ia360-agent] availability error:', e.message); return null; }
        };
        // helper: emite la lista interactiva de WhatsApp (max 10 filas, title <=24).
        const sendSlotList = async (rows, intro) => {
          await enqueueIa360Interactive({
            record,
            label: 'ia360_ai_available_slots',
            messageBody: 'IA360: horarios disponibles',
            interactive: {
              type: 'list',
              header: { type: 'text', text: 'Horarios libres' },
              body: { text: (agent.reply ? agent.reply + String.fromCharCode(10) + String.fromCharCode(10) : '') + intro },
              footer: { text: 'Se revalida antes de reservar' },
              action: {
                button: 'Elegir hora',
                sections: [{ title: 'Disponibles', rows: rows.slice(0, 10).map((slot) => ({ id: slot.id, title: String(slot.title).slice(0, 24), description: slot.description })) }],
              },
            },
          });
        };

        // 1) Si el usuario nombro un dia concreto (ISO válido), intenta ESE dia primero.
        // A) reqDate con slots -> ofrece ESE dia (no el barrido). reqDate sin slots o
        //    consulta fallida -> cae al spread. dayQueryOk distingue "el dia salio VACIO"
        //    (lleno de verdad) de "la consulta FALLO" (null/timeout): no afirmamos "ya
        //    está lleno" cuando en realidad no pudimos consultar ese dia.
        let dayQueryOk = false;
        if (reqDate) {
          const dayAvail = await callAvail({ date: reqDate });
          dayQueryOk = !!(dayAvail && Array.isArray(dayAvail.slots));
          const daySlots = (dayAvail && dayAvail.slots) || [];
          if (daySlots.length > 0) {
            await sendSlotList(daySlots, `Estos espacios de 1 hora estan libres (${dayAvail.date}, hora CDMX). Elige uno y lo confirmo con Calendar + Zoom.`);
            responded = true;
            return;
          }
          // dia lleno (o consulta fallida) → cae al spread multi-dia (next-available) abajo.
        }

        // 2) Spread multi-dia: proximos dias habiles con slots, ~2 por dia, dia en el titulo.
        const spread = await callAvail({ nextAvailable: true });
        const spreadSlots = (spread && spread.slots) || [];
        if (spreadSlots.length === 0) {
          await enqueueIa360Text({ record, label: 'ia360_ai_no_slots', body: 'Revisé la agenda real de Alek y no encontré espacios de 1 hora libres en los próximos días hábiles. ¿Te late que le pase a Alek que te contacte para cuadrar un horario?' });
          responded = true;
          return;
        }
        // B) Si pidió un dia ESPECIFICO y de verdad salió lleno (consulta OK pero sin
        //    slots, y distinto al primer dia del barrido), NOMBRA ese dia con su dia de
        //    semana en CDMX: "El miércoles 10 de junio ya está lleno." Solo cuando la
        //    consulta del dia fue exitosa-pero-vacia (dayQueryOk); si falló, NO afirmamos
        //    que está lleno (sería falso) y ofrecemos el barrido sin esa frase.
        let fullDay = '';
        if (reqDate && dayQueryOk && reqDate !== spread.date) {
          const diaNombre = fmtIa360DiaPedido(reqDate);
          fullDay = diaNombre
            ? `El ${diaNombre} ya está lleno. `
            : `Ese día ya está lleno. `;
        }
        await sendSlotList(spreadSlots, `${fullDay}Te paso opciones de los próximos días (hora CDMX). Elige una y la confirmo con Calendar + Zoom.`);
        responded = true;
        return;
      } catch (e) {
        console.error('[ia360-agent] offer_slots/book handler error:', e.message);
        await enqueueIa360Text({ record, label: 'ia360_ai_holding', body: 'Déjame revisar la agenda y te confirmo opciones en un momento.' }).catch(() => {});
        responded = true;
        return;
      }
    }

    // DEFAULT → just send the agent's coherent reply (ask_pain / provide_info / smalltalk / other).
    if (agent.action === 'advance_pain' || agent.intent === 'ask_pain') {
      await syncIa360Deal({ record, targetStageName: 'Dolor calificado', titleSuffix: 'Dolor (texto libre)', notes: `Dolor por texto libre: ${record.message_body}${agent.extracted && agent.extracted.area_operacion ? ' (área: ' + agent.extracted.area_operacion + ')' : ''}` });
    }
    // G-BRAIN: candado anti-doble-ruta (incidente 1651/1653) + estado conversacional.
    const sentReply = await enqueueIa360AgentReply({ record, label: 'ia360_ai_reply', body: agent.reply });
    if (sentReply === 'superseded') {
      responded = true; // otra ruta (botón seq_*) ya contestó este intercambio
      return;
    }
    if (sentReply) {
      responded = true;
      updateIa360ConvState({ record, contact: convContact, agent, replyBody: agent.reply, convState })
        .catch(e => console.error('[ia360-conv-state] update error:', e.message));
    }
  } catch (err) {
    console.error('[ia360-agent] handleIa360FreeText error:', err.message);
    // FALLBACK UNIVERSAL (catch): un error NUNCA debe dejar al contacto en silencio.
    // Solo si el contacto estaba dentro del embudo IA360 (dealFound) — un fallo antes
    // de saberlo NO debe responder ni alertar (lo cubre evaluateTriggers en paralelo).
    if (dealFound) {
      await handleIa360BotFailure({
        record,
        reason: 'error: ' + (err && err.message ? String(err.message).slice(0, 120) : 'desconocido'),
        alreadyResponded: responded,
      }).catch(e => console.error('[ia360-failure] catch fallback error:', e.message));
    }
    return;
  }

  // FALLBACK UNIVERSAL (fin del handler): si llegamos al final SIN haber respondido y
  // el contacto está en el embudo IA360 (dealFound) y el mensaje NO era pasivo, no lo
  // dejamos en silencio: fallback al contacto + alerta al owner para que lo tome.
  // (En el flujo lineal el reply default casi siempre marca responded=true; esta red
  // cubre early-returns sin envío y el caso de enqueue duplicado/erróneo.)
  if (!responded && dealFound && !isIa360PassiveMessage(record.message_body)) {
    await handleIa360BotFailure({
      record,
      reason: 'no-manejado',
      alreadyResponded: false,
    }).catch(e => console.error('[ia360-failure] end-net fallback error:', e.message));
  }
}

// FlowWire Part B: universal nfm_reply router. When a prospect SUBMITS a WhatsApp Flow,
// Meta sends an inbound interactive whose interactive.nfm_reply.response_json (a JSON STRING)
// carries the answered fields + flow_token. The button state machine never matches it, so we
// detect + route here BEFORE the button handler. Flow is identified by FIELDS PRESENT (robust,
// not token-bound). Everything is wrapped in try/catch so a malformed nfm never tumbles the
// webhook. Returns true if it routed (caller short-circuits), false otherwise.
function extractIa360NfmResponse(record) {
  try {
    const payload = typeof record.raw_payload === 'string' ? JSON.parse(record.raw_payload) : record.raw_payload;
    const messages = payload?.entry?.[0]?.changes?.[0]?.value?.messages || [];
    const msg = messages.find(m => m && m.id === record.message_id) || messages[0];
    const nfm = msg?.interactive?.nfm_reply;
    if (!nfm || !nfm.response_json) return null;
    const data = typeof nfm.response_json === 'string' ? JSON.parse(nfm.response_json) : nfm.response_json;
    return (data && typeof data === 'object') ? data : null;
  } catch (_) {
    return null;
  }
}

const URGENCIA_LEGIBLE = {
  esta_semana: 'algo de esta semana',
  este_mes: 'algo de este mes',
  este_trimestre: 'algo de este trimestre',
  explorando: 'exploración',
};

// W4 — etiquetas legibles para no mostrar ids crudos (15m_50m, 6_20, taller_capacitacion) al
// contacto. Se usan en la respuesta del offer_router. Fallback al id si no hay etiqueta.
const TAMANO_LEGIBLE = {
  menos_5m: 'menos de 5M', '5m_15m': '5M a 15M', '15m_50m': '15M a 50M', '50m_200m': '50M a 200M', mas_200m: 'más de 200M',
};
const PERSONAS_LEGIBLE = {
  '1_5': '1 a 5 personas', '6_20': '6 a 20 personas', '21_50': '21 a 50 personas', '51_100': '51 a 100 personas', mas_100: 'más de 100 personas',
};
const SOLUCION_LEGIBLE = {
  taller_capacitacion: 'un taller de capacitación', servicio_productizado: 'un servicio productizado',
  saas_aiaas: 'una plataforma SaaS/AIaaS', consultoria_premium: 'consultoría premium', aun_no_se: 'la opción que mejor te encaje',
};

async function handleIa360FlowReply(record) {
  try {
    if (!record || record.direction !== 'incoming' || record.message_type !== 'interactive') return false;
    const data = extractIa360NfmResponse(record);
    if (!data) return false;

    // Identify WHICH flow by the fields present (not by token).
    if (data.area !== undefined && data.urgencia !== undefined) {
      // ── DIAGNOSTICO ───────────────────────────────────────────────────────
      const { area, urgencia, fuga, sistema, resultado } = data;
      console.log('[ia360-flowwire] event=diagnostic_answered contact=%s area=%s urgencia=%s', record.contact_number, area, urgencia);
      await mergeContactIa360State({
        waNumber: record.wa_number,
        contactNumber: record.contact_number,
        tags: ['diagnostico-ia360', 'dolor:' + area, 'urgencia:' + urgencia],
        customFields: {
          ia360_dolor: area,
          ia360_fuga: fuga,
          ia360_sistema: sistema,
          ia360_urgencia: urgencia,
          ia360_resultado: resultado,
        },
      });
      const hot = ['esta_semana', 'este_mes', 'este_trimestre'].includes(urgencia);
      if (hot) {
        await syncIa360Deal({
          record,
          targetStageName: 'Requiere Alek',
          titleSuffix: 'Diagnóstico (Flow)',
          notes: `diagnostic_answered: ${area} / ${urgencia}`,
        });
        await enqueueIa360Interactive({
          record,
          label: 'ia360_flow_diagnostic_hot',
          messageBody: 'IA360 Flow: diagnóstico (urgente)',
          interactive: {
            type: 'button',
            header: { type: 'image', image: { link: 'https://wa.geekstudio.dev/ia360-bca/transformacion.jpg' } },
            body: { text: `Listo. Con lo que me diste —${area} / ${fuga}— ya tengo tu caso. Como es ${URGENCIA_LEGIBLE[urgencia] || 'algo prioritario'}, lo sensato es agendar 30 min con Alek y bajarlo a quick wins.` },
            footer: { text: 'IA360' },
            action: { buttons: [
              { type: 'reply', reply: { id: '100m_urgent', title: 'Sí, agendar' } },
              { type: 'reply', reply: { id: '100m_want_map', title: 'Primero el mapa' } },
            ] },
          },
        });
      } else {
        await syncIa360Deal({
          record,
          targetStageName: 'Nutrición',
          titleSuffix: 'Diagnóstico (Flow)',
          notes: `diagnostic_answered: ${area} / ${urgencia}`,
        });
        await enqueueIa360Interactive({
          record,
          label: 'ia360_flow_diagnostic_explore',
          messageBody: 'IA360 Flow: diagnóstico (explorando)',
          interactive: {
            type: 'button',
            header: { type: 'image', image: { link: 'https://wa.geekstudio.dev/ia360-bca/transformacion.jpg' } },
            body: { text: 'Te dejo en modo exploración: ejemplos concretos, sin presión. Cuando veas un caso aplicable lo volvemos mapa.' },
            footer: { text: 'IA360' },
            action: { buttons: [
              { type: 'reply', reply: { id: '100m_see_example', title: 'Ver ejemplo' } },
              { type: 'reply', reply: { id: '100m_want_map', title: 'Quiero mapa' } },
            ] },
          },
        });
      }
      // BONUS C: avisar al OWNER que el contacto respondio el diagnostico.
      try {
        const who = record.contact_name || record.contact_number;
        await sendOwnerInteractive({
          record,
          label: 'owner_flow_diagnostic',
          messageBody: `IA360: ${who} respondió el diagnóstico`,
          interactive: {
            type: 'button',
            header: { type: 'text', text: 'Diagnóstico respondido' },
            body: { text: `Alek, ${who} respondió el diagnóstico. Dolor: ${area || 'n/d'}, urgencia: ${URGENCIA_LEGIBLE[urgencia] || urgencia || 'n/d'}.${resultado ? ' Resultado buscado: ' + resultado + '.' : ''}` },
            footer: { text: 'IA360 · humano en el bucle' },
            action: { buttons: [
              { type: 'reply', reply: { id: `owner_take:${record.contact_number}`, title: 'Lo tomo yo' } },
              { type: 'reply', reply: { id: `owner_book:${record.contact_number}`, title: 'Agendar' } },
              { type: 'reply', reply: { id: `owner_nurture:${record.contact_number}`, title: 'Nutrir' } },
            ] },
          },
        });
      } catch (ownerErr) {
        console.error('[ia360-owner] notify on flow diagnostic failed:', ownerErr.message);
      }
      return true;
    }

    if (data.tamano_empresa !== undefined) {
      // ── OFFER_ROUTER ──────────────────────────────────────────────────────
      const { tamano_empresa, personas_afectadas, tipo_solucion, presupuesto, nivel_decision } = data;
      console.log('[ia360-flowwire] event=offer_router_answered contact=%s tamano=%s presupuesto=%s', record.contact_number, tamano_empresa, presupuesto);
      const tier = (presupuesto === '200k_1m' || presupuesto === 'mas_1m') ? 'Premium'
        : (presupuesto === '50k_200k') ? 'Pro' : 'Starter';
      await mergeContactIa360State({
        waNumber: record.wa_number,
        contactNumber: record.contact_number,
        tags: ['oferta:' + tier, 'decisor:' + nivel_decision],
        customFields: { ia360_oferta_sugerida: tier },
      });
      await syncIa360Deal({
        record,
        targetStageName: 'Propuesta / siguiente paso',
        titleSuffix: 'Oferta ' + tier + ' (Flow)',
        notes: `offer_router_answered: ${tamano_empresa} / ${presupuesto} → ${tier}`,
      });
      const tamanoTxt = TAMANO_LEGIBLE[tamano_empresa] || tamano_empresa;
      const personasTxt = PERSONAS_LEGIBLE[personas_afectadas] || personas_afectadas;
      const solucionTxt = SOLUCION_LEGIBLE[tipo_solucion] || tipo_solucion;
      await enqueueIa360Interactive({
        record,
        label: 'ia360_flow_offer_router',
        messageBody: 'IA360 Flow: oferta sugerida ' + tier,
        interactive: {
          type: 'button',
          header: { type: 'image', image: { link: 'https://wa.geekstudio.dev/ia360-bca/transformacion.jpg' } },
          body: { text: `Gracias. Por tu perfil (facturación ${tamanoTxt}, ${personasTxt}) lo sensato es arrancar con ${solucionTxt}, en nivel ${tier}. El siguiente paso es una llamada de 20 minutos con Alek para aterrizarlo a tu caso.` },
          footer: { text: 'IA360' },
          action: { buttons: [
            { type: 'reply', reply: { id: '100m_schedule', title: 'Agendar llamada' } },
          ] },
        },
      });
      return true;
    }

    if (data.empresa !== undefined && data.rol !== undefined) {
      // ── PRE_CALL ──────────────────────────────────────────────────────────
      const { empresa, rol, objetivo, sistemas } = data;
      console.log('[ia360-flowwire] event=pre_call_intake_submitted contact=%s empresa=%s rol=%s', record.contact_number, empresa, rol);
      await mergeContactIa360State({
        waNumber: record.wa_number,
        contactNumber: record.contact_number,
        tags: ['pre-call-ia360'],
        customFields: {
          ia360_empresa: empresa,
          ia360_rol: rol,
          ia360_objetivo: objetivo,
          ia360_sistemas: sistemas,
        },
      });
      // W4 fix anti-lazo (per FLOWS doc: pre_call es stage-aware). Si el contacto YA tiene una
      // reunión agendada, NO lo empujamos a re-agendar (eso causaba el lazo booking→contexto→
      // re-agenda→booking); cerramos con acuse terminal. Solo si NO hay slot ofrecemos agendar.
      const preCallBookings = await loadIa360Bookings(record.contact_number);
      const preCallHasSlot = Array.isArray(preCallBookings) && preCallBookings.length > 0;
      if (preCallHasSlot) {
        await syncIa360Deal({
          record,
          targetStageName: 'Reunión agendada',
          titleSuffix: 'Pre-call (Flow)',
          notes: `pre_call_intake_submitted: ${empresa} / ${rol} (con reunión ya agendada)`,
        });
        const ultimaCita = preCallBookings[preCallBookings.length - 1]?.start;
        await enqueueIa360Text({
          record,
          label: 'ia360_flow_pre_call_booked',
          body: `Gracias, con esto Alek llega preparado a tu reunión${ultimaCita ? ' del ' + fmtIa360Short(ultimaCita) : ''}. No necesitas hacer nada más; nos vemos ahí.`,
        });
      } else {
        await syncIa360Deal({
          record,
          targetStageName: 'Agenda en proceso',
          titleSuffix: 'Pre-call (Flow)',
          notes: `pre_call_intake_submitted: ${empresa} / ${rol}`,
        });
        await enqueueIa360Interactive({
          record,
          label: 'ia360_flow_pre_call',
          messageBody: 'IA360 Flow: pre-call intake',
          interactive: {
            type: 'button',
            header: { type: 'image', image: { link: 'https://wa.geekstudio.dev/ia360-bca/transformacion.jpg' } },
            body: { text: 'Gracias, con esto Alek llega preparado (nada de demo genérica). ¿Agendamos la llamada?' },
            footer: { text: 'IA360' },
            action: { buttons: [
              { type: 'reply', reply: { id: '100m_schedule', title: 'Agendar llamada' } },
            ] },
          },
        });
      }
      return true;
    }

    if (data.preferencia !== undefined) {
      // ── PREFERENCES ───────────────────────────────────────────────────────
      const { preferencia } = data;
      if (preferencia === 'no_contactar') {
        await mergeContactIa360State({
          waNumber: record.wa_number,
          contactNumber: record.contact_number,
          tags: ['no-contactar'],
          customFields: { ia360_preferencia: preferencia },
        });
        console.log('[ia360-flowwire] event=opt_out contact=%s preferencia=no_contactar', record.contact_number);
        await syncIa360Deal({
          record,
          targetStageName: 'Perdido / no fit',
          titleSuffix: 'Opt-out (Flow)',
          notes: 'opt_out: no_contactar',
        });
        await enqueueIa360Text({
          record,
          label: 'ia360_flow_preferences_optout',
          body: 'Entendido, te saco de esta secuencia. Aquí estoy si algún día quieres retomarlo.',
        });
      } else {
        await mergeContactIa360State({
          waNumber: record.wa_number,
          contactNumber: record.contact_number,
          tags: ['preferencia:' + preferencia],
          customFields: { ia360_preferencia: preferencia },
        });
        console.log('[ia360-flowwire] event=nurture_selected contact=%s preferencia=%s', record.contact_number, preferencia);
        await syncIa360Deal({
          record,
          targetStageName: 'Nutrición',
          titleSuffix: 'Preferencias (Flow)',
          notes: `nurture_selected: ${preferencia}`,
        });
        // W4 fix: nurture = nutrir, NO empujar a ventas (per FLOWS doc). Acuse terminal sin
        // botón de "Ver ejemplo" (ese re-metía al embudo y contribuía a la sensación de lazo).
        await enqueueIa360Text({
          record,
          label: 'ia360_flow_preferences',
          body: 'Listo, ajustado. Te mando solo lo útil y sin saturarte. Cuando quieras retomar, aquí estoy.',
        });
      }
      return true;
    }

    // nfm_reply with unrecognized shape → don't route, let normal handling proceed (it won't match either).
    return false;
  } catch (err) {
    console.error('[ia360-flowwire] nfm router error (degraded, no route):', err.message);
    return false;
  }
}

async function handleIa360LiteInteractive(record) {
  if (!record || record.direction !== 'incoming' || !['interactive', 'button'].includes(record.message_type)) return;
  // ── HITL: rama OWNER (Alek). Va ANTES de flow-reply y del funnel: un tap del
  // owner (ids con prefijo 'owner_') jamas debe caer en el embudo del prospecto.
  // getInteractiveReplyId ya devuelve el id en minusculas; por eso los ids owner
  // se emiten en minusculas con guion_bajo y el contactNumber sobrevive (digitos).
  const ownerReplyId = getInteractiveReplyId(record);
  if (ownerReplyId && ownerReplyId.startsWith('owner_')) {
    if (normalizePhone(record.contact_number) !== IA360_OWNER_NUMBER) {
      console.warn('[ia360-owner] ignored owner-prefixed reply from non-owner contact=%s id=%s', record.contact_number || '-', ownerReplyId);
      return;
    }
    try {
      const [ownerAction, ownerArg, ownerPipe] = ownerReplyId.split(':');
      // call/keep cargan el numero del contacto (digit-strip OK). owner_cancel_yes
      // carga el EVENT_ID (alfanumerico) → NO digit-stripear ese arg.
      const targetContact = (ownerArg || '').replace(/\D/g, '');
      // BANDEJA DE IDEAS: ruteo de la tarjeta (Producción/Documentar/CRM/Rechazar).
      if (ownerAction && ownerAction.startsWith('owner_idea_')) {
        await handleIa360OwnerIdeaRoute({ record, ownerAction, ideaId: ownerArg });
        return;
      }
      // G-RAG: tarjeta de candidatos del vault — vincular nota o sellar rechazo.
      if (ownerAction === 'owner_vlink') {
        await handleIa360OwnerVaultLink({ record, targetContact, noteId: String(ownerPipe || '').replace(/\D/g, '') });
        return;
      }
      if (ownerAction === 'owner_vnone') {
        await handleIa360OwnerVaultNone({ record, targetContact });
        return;
      }
      if (ownerAction === 'owner_pipe') {
        await handleIa360OwnerPipelineChoice({ record, targetContact, pipeline: ownerPipe });
        return;
      }
      if (ownerAction === 'owner_seq') {
        await handleIa360OwnerSequenceChoice({ record, targetContact, sequenceId: ownerPipe });
        return;
      }
      // APPROVE-SEND: decisiones de la tarjeta de aprobación post-readout.
      if (ownerAction === 'owner_approve_send') {
        await handleIa360OwnerApproveSend({ record, targetContact, sequenceId: ownerPipe });
        return;
      }
      if (ownerAction === 'owner_approve_edit') {
        await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_approve_edit_ack', body: `Ok, el borrador para ${targetContact} queda SIN enviar. Edita el copy y vuelve a elegir secuencia cuando esté listo.`, targetContact, ownerBudget: true });
        return;
      }
      if (ownerAction === 'owner_approve_keep') {
        await handleIa360TerminalVcardChoice({ record, targetContact, terminalChoice: 'guardar' });
        return;
      }
      if (ownerAction === 'owner_approve_dnc') {
        await handleIa360TerminalVcardChoice({ record, targetContact, terminalChoice: 'excluir' });
        return;
      }
      if (ownerAction === 'owner_approve_manual') {
        await handleIa360OwnerApproveManual({ record, targetContact });
        return;
      }
      if (ownerAction === 'owner_vcard_pipe' || ownerAction === 'owner_vcard_take' || ownerAction === 'owner_vcard_keep') {
        await handleIa360OwnerVcardAction({ record, ownerAction, targetContact });
        return;
      }
      if (ownerAction === 'owner_cancel_yes') {
        // MULTI-CITA: el boton trae el EVENT_ID de la cita concreta a cancelar.
        // `record` aqui es Alek, asi que resolvemos contacto+cita por event_id
        // (case-insensitive). Cancelamos con el event_id ORIGINAL guardado (NO el
        // del boton, que pasa por toLowerCase y podria no coincidir en Google).
        const eventArg = ownerArg || '';
        const found = await findBookingByEventId(eventArg);
        if (!found) {
          await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_cancel_notfound', body: `No encontré la cita (${eventArg}). Puede que ya estuviera cancelada. No cancelé nada.` });
          return;
        }
        const cancelContact = String(found.contact_number || '').replace(/\D/g, '');
        const evt = found.event_id || '';   // ORIGINAL (case preservado) desde la DB
        const zoom = found.zoom_id || '';
        const startRaw = found.start || '';
        const cancelRes = await cancelIa360Booking({ calendarEventId: evt, zoomMeetingId: zoom });
        const startFmt = fmtIa360Medium(startRaw);
        if (cancelRes.ok) {
          // Quita ESA cita del array del contacto (y limpia campos sueltos si era la ultima).
          const remaining = await removeIa360Booking({ waNumber: found.wa_number || record.wa_number, contactNumber: cancelContact, eventId: evt });
          await mergeContactIa360State({ waNumber: found.wa_number || record.wa_number, contactNumber: cancelContact, tags: ['cancelada-aprobada'], customFields: { ultimo_cta_enviado: 'ia360_cancel_aprobada' } });
          await sendIa360DirectText({ record, toNumber: cancelContact, label: 'ia360_cancel_done_contact', body: `Listo, Alek aprobó. Cancelé tu reunión del ${startFmt.replace(/\.$/, '')}. Si quieres retomar, escríbeme por aquí.` });
          // Si ya no le quedan reuniones, saca el deal de "Reunión agendada".
          if (remaining.length === 0) {
            await syncIa360Deal({
              record: { ...record, contact_number: cancelContact },
              targetStageName: 'Requiere Alek',
              titleSuffix: 'Reunión cancelada',
              notes: `Reunión cancelada (aprobada por Alek). Event ${evt}. Sin reuniones activas → vuelve a Requiere Alek.`,
            }).catch(e => console.error('[ia360-multicita] syncIa360Deal on empty:', e.message));
            await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_cancel_done', body: `Hecho, cancelada la reunión de ${cancelContact}. Ya no le quedan reuniones; moví el deal a "Requiere Alek".` });
          } else {
            await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_cancel_done', body: `Hecho, cancelada la reunión del ${startFmt} de ${cancelContact}. ${remaining.length === 1 ? 'Le queda 1 reunión' : `Le quedan ${remaining.length} reuniones`}.` });
          }
        } else {
          await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_cancel_failed', body: `No pude cancelar la cita de ${cancelContact} (el webhook falló). Revísalo manual.` });
        }
        return;
      }
      if (ownerAction === 'owner_cancel_call') {
        await sendIa360DirectText({ record, toNumber: targetContact, label: 'ia360_cancel_call_contact', body: 'Alek te va a llamar para verlo.' });
        await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_cancel_call_ack', body: `Ok, le avisé a ${targetContact} que lo llamas.` });
        return;
      }
      if (ownerAction === 'owner_cancel_keep') {
        await sendIa360DirectText({ record, toNumber: targetContact, label: 'ia360_cancel_keep_contact', body: 'Tu reunión sigue en pie.' });
        await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_cancel_keep_ack', body: `Ok, la reunión de ${targetContact} se mantiene.` });
        return;
      }
      // BONUS C acks: owner_take / owner_book / owner_nurture (FYI flow-reply).
      if (ownerAction === 'owner_take') { await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_take_ack', body: `Ok, tú tomas a ${targetContact}.` }); return; }
      if (ownerAction === 'owner_book') { await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_book_ack', body: `Ok, a agendar con ${targetContact}.` }); return; }
      if (ownerAction === 'owner_nurture') { await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_nurture_ack', body: `Ok, ${targetContact} a nutrición.` }); return; }

      // ── PRODUCTION-HARDENING: cierre del loop de fallos del bot ───────────────
      // Estos botones llegan de la alerta de handleIa360BotFailure. El `ownerArg`
      // (aquí: `ownerArg` crudo, NO `targetContact`) es el ID numérico de la fila en
      // coexistence.ia360_bot_failures. Cada acción actualiza el status de esa fila.
      if (ownerAction === 'owner_take_fail') {
        const fid = String(ownerArg || '').replace(/\D/g, '');
        if (fid) await pool.query(`UPDATE coexistence.ia360_bot_failures SET owner_action='lo_tomo', status='lo_tomo' WHERE id=$1`, [fid]).catch(e => console.error('[ia360-failure] take update:', e.message));
        await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_take_fail_ack', body: 'Tomado: queda para gestión manual tuya.' });
        return;
      }
      if (ownerAction === 'owner_ignore_fail') {
        const fid = String(ownerArg || '').replace(/\D/g, '');
        if (fid) await pool.query(`UPDATE coexistence.ia360_bot_failures SET owner_action='ignorado', status='ignorado' WHERE id=$1`, [fid]).catch(e => console.error('[ia360-failure] ignore update:', e.message));
        await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_ignore_fail_ack', body: 'Ok, lo ignoro.' });
        return;
      }
      if (ownerAction === 'owner_comment_fail') {
        const fid = String(ownerArg || '').replace(/\D/g, '');
        // Marca al CONTACTO owner como "esperando comentario para la fila <fid>": el
        // SIGUIENTE texto del owner se captura como owner_comment (ver dispatch). Se
        // guarda en custom_fields del contacto owner; el record aquí ES el owner.
        if (fid) {
          await mergeContactIa360State({
            waNumber: record.wa_number,
            contactNumber: record.contact_number,
            customFields: { ia360_awaiting_comment_failure: fid },
          }).catch(e => console.error('[ia360-failure] set awaiting:', e.message));
        }
        await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_comment_fail_prompt', body: 'Escribe tu comentario para mejorar el bot:' });
        return;
      }
      // owner_* desconocido: ack neutro + return (NUNCA cae al funnel).
      await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_unknown_ack', body: 'Recibido.' });
      return;
    } catch (ownerErr) {
      console.error('[ia360-owner] owner branch error:', ownerErr.message);
      return; // no tumbar el webhook
    }
  }

  // ── MULTI-CITA: el CONTACTO eligio cual cita cancelar desde la lista (pickcancel:
  // <event_id>). Esto NO empieza con 'owner_', lo dispara el prospecto. Resolvemos la
  // cita por event_id (case-insensitive) y notificamos al OWNER para ESA cita. try/catch
  // propio: nunca tumba el webhook. Va ANTES de flow-reply y del funnel.
  if (ownerReplyId && ownerReplyId.startsWith('pickcancel:')) {
    try {
      const pickedEventId = ownerReplyId.slice('pickcancel:'.length);
      const found = await findBookingByEventId(pickedEventId);
      if (!found) {
        await enqueueIa360Text({ record, label: 'ia360_pickcancel_notfound', body: 'No encontré esa reunión, puede que ya esté cancelada. ¿Me confirmas qué día era?' });
        return;
      }
      await enqueueIa360Text({ record, label: 'ia360_ai_cancel_request', body: 'Dame un momento, lo confirmo con Alek.' });
      emitIa360N8nHandoff({
        record,
        eventType: 'meeting_cancel_requested',
        targetStage: 'Reunión agendada',
        priority: 'high',
        summary: `El contacto eligió CANCELAR su reunión del ${fmtIa360Medium(found.start)} (CDMX). Acción humana: aprobar/cancelar el evento Calendar/Zoom y confirmar al contacto.`,
      }).catch(e => console.error('[ia360-n8n] pickcancel handoff:', e.message));
      await notifyOwnerCancelForBooking({
        record,
        contactNumber: String(found.contact_number || record.contact_number).replace(/\D/g, ''),
        booking: { start: found.start || '', event_id: found.event_id || '', zoom_id: found.zoom_id || '' },
      });
    } catch (pickErr) {
      console.error('[ia360-multicita] pickcancel branch error:', pickErr.message);
    }
    return;
  }

  // FlowWire Part B: a submitted WhatsApp Flow (nfm_reply) is NOT a button — route it first.
  if (await handleIa360FlowReply(record)) return;
  const answer = String(record.message_body || '').trim().toLowerCase();
  const replyId = getInteractiveReplyId(record);

  // Pipeline 5 "WhatsApp Revenue OS": respuesta a la apertura (PASO 1) y bifurcación
  // (PASO 3). Gateado por custom_fields.ia360_revenue_state; si no aplica, devuelve
  // false y el flujo sigue normal. Va ANTES del embudo 100m / agenda.
  if (await handleRevenueOsButton({ record, replyId })) return;

  // ── G-C: ruteo de respuestas a openers v2 (ids seq_* y alias de template) ──
  // Va DESPUÉS de Revenue OS (que resuelve su propio "Sí, cuéntame" gateado por
  // estado) y ANTES del embudo 100M. Un id seq_* del catálogo NUNCA cae al
  // fallback global.
  if (replyId && replyId.startsWith('seq_')) {
    if (await handleIa360SequenceReply({ record, replyId })) return;
  } else if (replyId || answer) {
    const aliasKey = String(replyId || answer || '').trim().toLowerCase();
    if (IA360_SEQ_ALIAS_NEGATIVE.has(aliasKey) || IA360_SEQ_ALIAS_HANDOFF.has(aliasKey) || IA360_SEQ_ALIAS_AFFIRMATIVE.has(aliasKey)) {
      try {
        const aliasContact = await loadIa360ContactContext(record).catch(() => null);
        const aliased = resolveIa360TemplateButtonAlias({ replyId: aliasKey, contact: aliasContact });
        if (aliased && await handleIa360SequenceReply({ record, replyId: aliased, contact: aliasContact })) return;
      } catch (aliasErr) {
        console.error('[ia360-seq] alias error:', aliasErr.message);
      }
    }
  }

  // W4 — boton "Enviar contexto" (stage-aware): sin slot abre diagnostico, con slot abre
  // pre_call. Va ANTES del embudo para no confundirse con un micro-paso. Si el Flow no se
  // pudo encolar (dedup/cuenta), cae al flujo normal (este id no matchea = no-op silencioso).
  if (replyId === '100m_send_context') {
    try {
      const sent = await dispatchContextFlow(record);
      if (sent) return;
    } catch (ctxErr) {
      console.error('[ia360-flowwire] dispatchContextFlow failed:', ctxErr.message);
    }
  }

  // IA360 100M WhatsApp prospecting flow: coherent stage machine for approved templates.
  const reply100m = {
    'diagnóstico rápido': {
      stage: 'Intención detectada', tag: 'problema-reconocido', title: 'Diagnóstico rápido',
      mediaKey: 'https://wa.geekstudio.dev/ia360-bca/dolor_ceo.jpg',
      body: 'Perfecto. Para que esto no sea genérico: ¿cuál de estos síntomas te cuesta más dinero o tiempo hoy?',
      buttons: [
        { id: '100m_capture_manual', title: 'Captura manual' },
        { id: '100m_reports_late', title: 'Reportes tarde' },
        { id: '100m_sales_followup', title: 'Seguimiento ventas' },
      ],
    },
    'ver mapa 30-60-90': {
      stage: 'Diagnóstico enviado', tag: 'mapa-solicitado', title: 'Mapa 30-60-90',
      mediaKey: 'https://wa.geekstudio.dev/ia360-bca/dolor_ceo.jpg',
      body: 'Va. El mapa 30-60-90 necesita ubicar primero la fuga principal: operación manual, datos tardíos o seguimiento comercial. ¿Cuál quieres atacar primero?',
      buttons: [
        { id: '100m_capture_manual', title: 'Captura manual' },
        { id: '100m_reports_late', title: 'Reportes tarde' },
        { id: '100m_sales_followup', title: 'Seguimiento ventas' },
      ],
    },
    'no ahora': {
      stage: 'Nutrición', tag: 'nutricion-suave', title: 'No ahora',
      body: 'Perfecto, no te saturo. Te dejo una regla simple: si una tarea se repite, depende de Excel/WhatsApp o retrasa decisiones, probablemente hay oportunidad IA360.',
      buttons: [
        { id: '100m_apply_later', title: 'Aplicarlo' },
        { id: '100m_more_later', title: 'Más adelante' },
        { id: '100m_optout', title: 'Baja' },
      ],
    },
    'captura manual': {
      stage: 'Dolor calificado', tag: 'dolor-captura-manual', title: 'Captura manual',
      mediaKey: 'https://wa.geekstudio.dev/ia360-bca/dolor_ceo.jpg',
      body: 'Ese suele ser quick win: reducir doble captura y pasar datos entre WhatsApp, CRM, ERP o Excel sin depender de copiar/pegar. ¿Qué mecanismo quieres ver?',
      buttons: [
        { id: '100m_wa_crm', title: 'WhatsApp → CRM' },
        { id: '100m_erp_bi', title: 'ERP → BI' },
        { id: '100m_agent_followup', title: 'Agente follow-up' },
      ],
    },
    'reportes tarde': {
      stage: 'Dolor calificado', tag: 'dolor-reportes-tarde', title: 'Reportes tarde',
      mediaKey: 'https://wa.geekstudio.dev/ia360-bca/dolor_ceo.jpg',
      body: 'Aquí el valor está en convertir datos operativos en alertas y tablero semanal, no en esperar reportes manuales. ¿Qué ejemplo quieres ver?',
      buttons: [
        { id: '100m_erp_bi', title: 'ERP → BI' },
        { id: '100m_wa_crm', title: 'WhatsApp → CRM' },
        { id: '100m_agent_followup', title: 'Agente follow-up' },
      ],
    },
    'seguimiento ventas': {
      stage: 'Dolor calificado', tag: 'dolor-seguimiento-ventas', title: 'Seguimiento ventas',
      mediaKey: 'https://wa.geekstudio.dev/ia360-bca/dolor_ceo.jpg',
      body: 'Ahí IA360 puede clasificar intención, mover pipeline y crear tareas humanas antes de que se enfríe el lead. ¿Qué mecanismo quieres ver?',
      buttons: [
        { id: '100m_wa_crm', title: 'WhatsApp → CRM' },
        { id: '100m_agent_followup', title: 'Agente follow-up' },
        { id: '100m_erp_bi', title: 'ERP → BI' },
      ],
    },
    'whatsapp → crm': {
      stage: 'Propuesta / siguiente paso', tag: 'mecanismo-whatsapp-crm', title: 'WhatsApp → CRM',
      mediaKey: 'https://wa.geekstudio.dev/ia360-bca/bi_solucion.jpg',
      body: 'Flujo: mensaje entra → se clasifica intención → aplica tags/campos → mueve deal → si hay alta intención crea tarea humana. ¿Qué hacemos con este caso?',
      buttons: [
        { id: '100m_want_map', title: 'Quiero mapa' },
        { id: '100m_schedule', title: 'Agendar' },
        { id: '100m_see_example', title: 'Ver ejemplo' },
      ],
    },
    'erp → bi': {
      stage: 'Propuesta / siguiente paso', tag: 'mecanismo-erp-bi', title: 'ERP → BI',
      mediaKey: 'https://wa.geekstudio.dev/ia360-bca/bi_solucion.jpg',
      body: 'Flujo: ERP/CRM/Excel → datos normalizados → dashboard ejecutivo → alertas → decisiones semanales. ¿Qué hacemos con este caso?',
      buttons: [
        { id: '100m_want_map', title: 'Quiero mapa' },
        { id: '100m_schedule', title: 'Agendar' },
        { id: '100m_see_example', title: 'Ver ejemplo' },
      ],
    },
    'agente follow-up': {
      stage: 'Propuesta / siguiente paso', tag: 'mecanismo-agentic-followup', title: 'Agente follow-up',
      mediaKey: 'https://wa.geekstudio.dev/ia360-bca/bi_solucion.jpg',
      body: 'Flujo: agente detecta intención, prepara respuesta, actualiza CRM y escala al humano antes de comprometer algo sensible. ¿Qué hacemos con este caso?',
      buttons: [
        { id: '100m_want_map', title: 'Quiero mapa' },
        { id: '100m_schedule', title: 'Agendar' },
        { id: '100m_see_example', title: 'Ver ejemplo' },
      ],
    },
    'quiero mapa': {
      stage: 'Diagnóstico enviado', tag: 'mapa-30-60-90-solicitado', title: 'Mapa 30-60-90',
      mediaKey: 'https://wa.geekstudio.dev/ia360-bca/transformacion.jpg',
      body: 'Mapa base 30-60-90:\n\n30 días: detectar cuello de botella, quick win y reglas de control humano.\n60 días: conectar WhatsApp/CRM/ERP/BI y medir tiempos, fugas y seguimiento.\n90 días: primer agente o tablero operativo con gobierno, métricas y handoff humano.\n\nAhora sí: ¿qué tan prioritario es aterrizarlo a tu caso?',
      buttons: [
        { id: '100m_urgent', title: 'Sí, urgente' },
        { id: '100m_exploring', title: 'Estoy explorando' },
        { id: '100m_not_priority', title: 'No prioritario' },
      ],
    },
    'ver ejemplo': {
      stage: 'Propuesta / siguiente paso', tag: 'ejemplo-solicitado', title: 'Ver ejemplo',
      mediaKey: 'https://wa.geekstudio.dev/ia360-bca/transformacion.jpg',
      body: 'Ejemplo corto: WhatsApp detecta interés, ForgeChat etiqueta y mueve pipeline, n8n crea tarea en CRM, y Alek recibe resumen antes de hablar con el prospecto.',
      buttons: [
        { id: '100m_want_map', title: 'Quiero mapa' },
        { id: '100m_schedule', title: 'Agendar' },
        { id: '100m_urgent', title: 'Sí, urgente' },
      ],
    },
    'sí, urgente': {
      stage: 'Requiere Alek', tag: 'hot-lead', title: 'Sí, urgente',
      mediaKey: 'https://wa.geekstudio.dev/ia360-bca/transformacion.jpg',
      body: 'Marcado como prioridad alta. Siguiente paso sensato: Alek revisa contexto y propone llamada con objetivo claro, no demo genérica.',
      buttons: [
        { id: 'sched_today', title: 'Hoy' },
        { id: 'sched_tomorrow', title: 'Mañana' },
        { id: 'sched_week', title: 'Esta semana' },
      ],
    },
    'estoy explorando': {
      stage: 'Nutrición', tag: 'explorando', title: 'Estoy explorando',
      body: 'Bien. Te mantengo en modo exploración: ejemplos concretos, sin presión. Cuando veas un caso aplicable, lo convertimos en mapa.',
      buttons: [
        { id: '100m_wa_crm', title: 'WhatsApp → CRM' },
        { id: '100m_erp_bi', title: 'ERP → BI' },
        { id: '100m_schedule', title: 'Agendar' },
      ],
    },
    // G-C anti-loop: "No prioritario" ya NO ofrece "Aplicarlo" (reabría la rama
    // comercial); las salidas son nutrición ("Más adelante") o baja.
    'no prioritario': {
      stage: 'Nutrición', tag: 'no-prioritario', title: 'No prioritario',
      body: 'Perfecto. Lo dejo en nutrición suave. Si después detectas doble captura, reportes tarde o leads sin seguimiento, ahí sí vale la pena retomarlo.',
      buttons: [
        { id: '100m_more_later', title: 'Más adelante' },
        { id: '100m_optout', title: 'Baja' },
      ],
    },
    'más adelante': {
      stage: 'Nutrición', tag: 'nutricion-suave', title: 'Más adelante',
      body: 'Listo. Queda para más adelante; no avanzo a venta. Te mandaré solo recursos de criterio/diagnóstico cuando tenga sentido.',
      buttons: [
        { id: '100m_apply_later', title: 'Aplicarlo' },
        { id: '100m_optout', title: 'Baja' },
      ],
    },
    'baja': {
      stage: 'Perdido / no fit', tag: 'no-contactar', title: 'Baja',
      body: 'Entendido. Marco este contacto como no contactar para esta secuencia.',
      buttons: [],
    },
  };

  const key100mById = {
    '100m_diagnostico_rapido': 'diagnóstico rápido',
    '100m_capture_manual': 'captura manual',
    '100m_reports_late': 'reportes tarde',
    '100m_sales_followup': 'seguimiento ventas',
    '100m_wa_crm': 'whatsapp → crm',
    '100m_erp_bi': 'erp → bi',
    '100m_agent_followup': 'agente follow-up',
    '100m_want_map': 'quiero mapa',
    '100m_schedule': 'agendar',
    '100m_see_example': 'ver ejemplo',
    '100m_urgent': 'sí, urgente',
    '100m_exploring': 'estoy explorando',
    '100m_not_priority': 'no prioritario',
    '100m_more_later': 'más adelante',
    '100m_apply_later': 'aplicarlo',
    '100m_optout': 'baja',
  };
  const flow100m = reply100m[key100mById[replyId]] || reply100m[replyId] || reply100m[answer];
  if (flow100m) {
    // ── G-C: anti-loop del router 100M ──────────────────────────────────────
    // 'baja' (optout) SIEMPRE pasa: la salida del contacto no se bloquea nunca.
    if (flow100m.tag !== 'no-contactar') {
      try {
        const guard = await ia360HundredMAdvancedGuard(record);
        // Guard de estado/versión: la conversación ya avanzó a agenda/reunión/
        // handoff humano → un botón de un mensaje viejo NO reabre la rama.
        if (guard.advanced) {
          await enqueueIa360Text({ record, label: 'ia360_100m_continuity', body: guard.body });
          return;
        }
        // Nodo loop-prone repetido → versión condensada con salidas terminales,
        // no el bloque completo otra vez. Si la lectura del contacto falló, NO se
        // escribe el mapa de visitas (se pisaría con un objeto vacío).
        const visited = guard.visited || {};
        if (guard.visitedOk && IA360_100M_LOOP_PRONE.has(flow100m.tag)) {
          if (visited[flow100m.tag]) {
            await mergeContactIa360State({
              waNumber: record.wa_number,
              contactNumber: record.contact_number,
              customFields: { ia360_100m_visited: { ...visited, [flow100m.tag]: (Number(visited[flow100m.tag]) || 0) + 1 } },
            }).catch(e => console.error('[ia360-100m] visited merge:', e.message));
            await enqueueIa360Interactive({
              record,
              label: 'ia360_100m_condensed',
              messageBody: `IA360 100M: ${flow100m.title} (resumen)`,
              interactive: {
                type: 'button',
                body: { text: `Eso ya lo vimos: ${flow100m.title}. Para no darte vueltas con lo mismo, mejor dime cómo cerramos: ¿agendamos una llamada corta con Alek o lo dejamos para más adelante?` },
                footer: { text: 'IA360 · sin vueltas' },
                action: {
                  buttons: [
                    { type: 'reply', reply: { id: '100m_schedule', title: 'Agendar' } },
                    { type: 'reply', reply: { id: 'apply_call', title: 'Llamada con Alek' } },
                    { type: 'reply', reply: { id: '100m_more_later', title: 'Más adelante' } },
                  ],
                },
              },
            });
            return;
          }
          await mergeContactIa360State({
            waNumber: record.wa_number,
            contactNumber: record.contact_number,
            customFields: { ia360_100m_visited: { ...visited, [flow100m.tag]: 1 } },
          }).catch(e => console.error('[ia360-100m] visited merge:', e.message));
        }
      } catch (guardErr) {
        console.error('[ia360-100m] guard error:', guardErr.message);
      }
    }
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'prospecting-100m', flow100m.tag],
      customFields: {
        campana_ia360: 'IA360 100M WhatsApp prospecting',
        fuente_origen: 'whatsapp-template-100m',
        ia360_ultima_respuesta: record.message_body,
        ultimo_cta_enviado: `ia360_100m_${flow100m.tag}`,
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: flow100m.stage,
      titleSuffix: flow100m.title,
      notes: `100M flow: ${record.message_body} → ${flow100m.stage}`,
    });
    // FlowWire Part A: "Diagnóstico rápido" opens the diagnostico WhatsApp Flow instead of
    // the button chain. tag 'problema-reconocido' is unique to that node. If the Flow can't be
    // enqueued (dedup / account / throw), fall through to the existing button branch below.
    if (flow100m.tag === 'problema-reconocido') {
      try {
        const flowSent = await enqueueIa360FlowMessage({
          record,
          flowId: '995344356550872',
          screen: 'DIAGNOSTICO',
          cta: 'Abrir diagnóstico',
          bodyText: 'Para no darte algo genérico, cuéntame en 30 segundos dónde se te va el tiempo o el dinero. Lo aterrizo a tu caso.',
          mediaUrl: 'https://wa.geekstudio.dev/ia360-bca/dolor_ceo.jpg',
          flowToken: 'ia360_diagnostico',
          label: `ia360_100m_${flow100m.tag}`,
        });
        if (flowSent) return;
      } catch (flowErr) {
        console.error('[ia360-flowwire] diagnostico flow send failed, falling back to buttons:', flowErr.message);
      }
    }
    // UX guardrail: si el usuario pide mapa, primero se entrega un mapa real en el
    // mensaje interactivo de abajo. No abrir offer_router aquí; eso cambiaba la promesa
    // de "Quiero mapa" a "Ver mi oferta" y generaba fricción/loop comercial.
    // W4 — preferences: nodos "Baja" (no-contactar) y "No ahora"/"Más adelante" (nutricion-suave).
    // Lanza el Flow de preferencias granular; fallback al texto/botones del nodo si el envio falla.
    if (flow100m.tag === 'no-contactar' || flow100m.tag === 'nutricion-suave') {
      try {
        const flowSent = await enqueueIa360FlowMessage({
          record,
          flowId: '4037415283227252',
          screen: 'PREFERENCIAS',
          cta: 'Elegir preferencia',
          bodyText: 'Para no saturarte: dime cómo prefieres que sigamos en contacto. Lo eliges en 10 segundos y respeto tu decisión.',
          mediaUrl: 'https://wa.geekstudio.dev/ia360-bca/transformacion.jpg',
          flowToken: 'ia360_preferences',
          label: `ia360_100m_${flow100m.tag}`,
        });
        if (flowSent) return;
      } catch (flowErr) {
        console.error('[ia360-flowwire] preferences flow send failed, falling back to buttons:', flowErr.message);
      }
    }
    if (flow100m.buttons.length > 0) {
      await enqueueIa360Interactive({
        record,
        label: `ia360_100m_${flow100m.tag}`,
        messageBody: `IA360 100M: ${flow100m.title}`,
        interactive: {
          type: 'button',
          header: flow100m.mediaKey ? { type: 'image', image: { link: flow100m.mediaKey } } : { type: 'text', text: flow100m.title },
          body: { text: flow100m.body },
          footer: { text: 'IA360 · micro-paso' },
          action: { buttons: flow100m.buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
        },
      });
    } else {
      await enqueueIa360Interactive({
        record,
        label: `ia360_100m_${flow100m.tag}`,
        messageBody: `IA360 100M: ${flow100m.title}`,
        interactive: {
          type: 'button',
          header: flow100m.mediaKey ? { type: 'image', image: { link: flow100m.mediaKey } } : { type: 'text', text: flow100m.title },
          body: { text: flow100m.body },
          footer: { text: 'IA360' },
          action: { buttons: [{ type: 'reply', reply: { id: '100m_more_later', title: 'Más adelante' } }] },
        },
      });
    }
    return;
  }

  if (answer === 'diagnóstico' || answer === 'diagnostico') {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'interes-og4-diagnostico'],
      customFields: {
        campana_ia360: 'IA360 WhatsApp lite flow',
        fuente_origen: 'whatsapp-interactive',
        ultimo_cta_enviado: 'ia360_lite_inicio',
        servicio_recomendado: 'Diagnóstico IA360',
        ia360_ultima_respuesta: 'Diagnóstico',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: 'Intención detectada',
      titleSuffix: 'Diagnóstico',
      notes: `Input: ${record.message_body}; intención inicial detectada`,
    });
    await enqueueIa360Interactive({
      record,
      label: 'ia360_lite_area_after_diagnostico',
      messageBody: 'IA360: elegir área de dolor',
      interactive: {
        type: 'list',
        header: { type: 'text', text: 'Área de dolor' },
        body: { text: 'Va. Para aterrizarlo rápido: ¿dónde duele más hoy?' },
        footer: { text: 'Elige una opción' },
        action: {
          button: 'Elegir área',
          sections: [{
            title: 'Áreas frecuentes',
            rows: [
              { id: 'pain_sales', title: 'Ventas', description: 'Seguimiento, leads, cierre' },
              { id: 'pain_ops', title: 'Operación', description: 'Procesos, doble captura' },
              { id: 'pain_bi', title: 'Datos / BI', description: 'Reportes y decisiones tardías' },
              { id: 'pain_erp', title: 'ERP / CRM', description: 'Integraciones y visibilidad' },
              { id: 'pain_ai_gov', title: 'Gobierno IA', description: 'Reglas, seguridad, control' },
            ],
          }],
        },
      },
    });
    return;
  }

  const areaMap = {
    'pain_sales': { tag: 'interes-og4-diagnostico', area: 'Ventas' },
    'pain_ops': { tag: 'interes-synapse', area: 'Operación' },
    'pain_bi': { tag: 'interes-datapower', area: 'Datos / BI' },
    'pain_erp': { tag: 'interes-erp-integraciones', area: 'ERP / CRM' },
    'pain_ai_gov': { tag: 'interes-gobierno-ia', area: 'Gobierno IA' },
    'ventas': { tag: 'interes-og4-diagnostico', area: 'Ventas' },
    'operación': { tag: 'interes-synapse', area: 'Operación' },
    'operacion': { tag: 'interes-synapse', area: 'Operación' },
    'datos / bi': { tag: 'interes-datapower', area: 'Datos / BI' },
    'erp / crm': { tag: 'interes-erp-integraciones', area: 'ERP / CRM' },
    'erp / bi': { tag: 'interes-erp-integraciones', area: 'ERP / CRM' },
    'gobierno ia': { tag: 'interes-gobierno-ia', area: 'Gobierno IA' },
    'agentes ia': { tag: 'interes-gobierno-ia', area: 'Gobierno IA' },
  };
  const mapped = areaMap[replyId] || areaMap[answer];
  if (mapped) {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', mapped.tag, 'intencion-detectada'],
      customFields: {
        area_dolor: mapped.area,
        ia360_ultima_respuesta: mapped.area,
        ultimo_cta_enviado: 'ia360_lite_area_dolor',
        servicio_recomendado: mapped.area === 'ERP / CRM' ? 'ERP / Integraciones / BI' : 'Diagnóstico IA360',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: 'Dolor calificado',
      titleSuffix: mapped.area,
      notes: `Área de dolor seleccionada: ${mapped.area}`,
    });
    await enqueueIa360Interactive({
      record,
      label: 'ia360_lite_next_step_after_area',
      messageBody: `IA360: siguiente paso para ${mapped.area}`,
      interactive: {
        type: 'button',
        header: { type: 'text', text: mapped.area },
        body: { text: 'Perfecto. Con eso ya puedo perfilar el caso. ¿Qué prefieres como siguiente paso?' },
        footer: { text: 'Sin compromiso' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'next_5q', title: '5 preguntas' } },
            { type: 'reply', reply: { id: 'next_schedule', title: 'Agendar' } },
            { type: 'reply', reply: { id: 'next_example', title: 'Enviar ejemplo' } },
          ],
        },
      },
    });
    return;
  }

  if (answer === '5 preguntas') {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'diagnostico-enviado'],
      customFields: {
        ultimo_cta_enviado: 'ia360_lite_5_preguntas',
        ia360_ultima_respuesta: '5 preguntas',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: 'Diagnóstico enviado',
      titleSuffix: 'Diagnóstico solicitado',
      notes: 'Solicitó diagnóstico ligero de 5 preguntas',
    });
    await enqueueIa360Interactive({
      record,
      label: 'ia360_lite_q2_manual_work',
      messageBody: 'IA360 pregunta ligera: dónde hay trabajo manual',
      interactive: {
        type: 'list',
        header: { type: 'text', text: 'Pregunta 1/5' },
        body: { text: 'Empecemos suave: ¿dónde ves más trabajo manual o doble captura?' },
        footer: { text: 'Una opción basta' },
        action: {
          button: 'Elegir punto',
          sections: [{
            title: 'Puntos frecuentes',
            rows: [
              { id: 'manual_whatsapp', title: 'WhatsApp', description: 'Seguimiento y mensajes manuales' },
              { id: 'manual_excel', title: 'Excel', description: 'Captura y reportes manuales' },
              { id: 'manual_erp', title: 'ERP', description: 'Datos/reprocesos entre sistemas' },
              { id: 'manual_crm', title: 'CRM', description: 'Seguimiento comercial' },
              { id: 'manual_reports', title: 'Reportes', description: 'Dashboards o KPIs tardíos' },
            ],
          }],
        },
      },
    });
    return;
  }

  const manualPainMap = {
    manual_whatsapp: { label: 'WhatsApp', tag: 'interes-whatsapp-business' },
    manual_excel: { label: 'Excel', tag: 'interes-datapower' },
    manual_erp: { label: 'ERP', tag: 'interes-erp-integraciones' },
    manual_crm: { label: 'CRM', tag: 'interes-erp-integraciones' },
    manual_reports: { label: 'Reportes', tag: 'interes-datapower' },
  };
  const manualPain = manualPainMap[replyId];
  if (manualPain) {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'respondio-diagnostico', manualPain.tag],
      customFields: {
        dolor_principal: `Trabajo manual / doble captura en ${manualPain.label}`,
        ia360_ultima_respuesta: record.message_body,
        ultimo_cta_enviado: 'ia360_lite_q1_manual_work',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: 'Respondió preguntas',
      titleSuffix: `Dolor ${manualPain.label}`,
      notes: `Pregunta 1/5: trabajo manual o doble captura en ${manualPain.label}`,
    });
    await enqueueIa360Interactive({
      record,
      label: 'ia360_lite_q1_ack_next',
      messageBody: `IA360: dolor manual ${manualPain.label}`,
      interactive: {
        type: 'button',
        header: { type: 'text', text: manualPain.label },
        body: { text: `Entendido: hay fricción en ${manualPain.label}. Para seguir ligero, puedo mostrar arquitectura, ejemplo aplicado o pedir agenda.` },
        footer: { text: 'Una opción basta' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'flow_architecture', title: 'Arquitectura' } },
            { type: 'reply', reply: { id: 'wa_apply', title: 'Aplicarlo' } },
            { type: 'reply', reply: { id: 'wa_schedule', title: 'Agendar' } },
          ],
        },
      },
    });
    return;
  }

  if (answer === 'agendar' || replyId === '100m_schedule' || replyId === 'next_schedule' || replyId === 'wa_schedule') {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'requiere-alek', 'hot-lead'],
      customFields: {
        ultimo_cta_enviado: 'ia360_lite_agendar',
        ia360_ultima_respuesta: 'Agendar',
        proximo_followup: 'Alek debe proponer horario',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: getIa360StageForReply({ replyId: 'wa_schedule', answer: record.message_body }, 'Agenda en proceso'),
      titleSuffix: 'Agendar',
      notes: 'Solicitó agendar; se mueve a agenda en proceso hasta confirmar Calendar/Zoom',
    });
    await enqueueIa360Interactive({
      record,
      label: 'ia360_lite_schedule_window',
      messageBody: 'IA360: preferencia para agendar',
      interactive: {
        type: 'button',
        header: { type: 'text', text: 'Agenda' },
        body: { text: 'Va. Para que Alek te proponga horario: ¿qué ventana te acomoda mejor?' },
        footer: { text: 'Luego se conecta calendario/CRM' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'sched_today', title: 'Hoy' } },
            { type: 'reply', reply: { id: 'sched_tomorrow', title: 'Mañana' } },
            { type: 'reply', reply: { id: 'sched_week', title: 'Esta semana' } },
          ],
        },
      },
    });
    return;
  }

  if (answer === 'enviar ejemplo') {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'ejemplo-solicitado'],
      customFields: {
        ultimo_cta_enviado: 'ia360_lite_enviar_ejemplo',
        ia360_ultima_respuesta: 'Enviar ejemplo',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: 'Dolor calificado',
      titleSuffix: 'Ejemplo solicitado',
      notes: 'Solicitó ejemplo IA360',
    });
    await enqueueIa360Interactive({
      record,
      label: 'ia360_lite_example_selector',
      messageBody: 'IA360: selector de ejemplo',
      interactive: {
        type: 'list',
        header: { type: 'text', text: 'Ejemplos IA360' },
        body: { text: 'Claro. ¿Qué ejemplo quieres ver primero?' },
        footer: { text: 'Elige uno' },
        action: {
          button: 'Ver ejemplos',
          sections: [{
            title: 'Casos rápidos',
            rows: [
              { id: 'ex_erp_bi', title: 'ERP → BI', description: 'Dashboard ejecutivo y alertas' },
              { id: 'ex_wa_crm', title: 'WhatsApp', description: 'Lead, tags, pipeline y tarea CRM' },
              { id: 'ex_agent_followup', title: 'Agente follow-up', description: 'Seguimiento con humano en control' },
              { id: 'ex_gov_ai', title: 'Gobierno IA', description: 'Reglas, roles y seguridad' },
            ],
          }],
        },
      },
    });
    return;
  }

  if (replyId === 'ex_wa_crm' || answer === 'whatsapp → crm' || answer === 'whatsapp -> crm') {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'interes-whatsapp-business', 'ejemplo-solicitado'],
      customFields: {
        ultimo_cta_enviado: 'ia360_lite_example_whatsapp_crm',
        ia360_ultima_respuesta: 'WhatsApp → CRM',
        servicio_recomendado: 'WhatsApp Revenue OS / CRM conversacional',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: getIa360StageForReply({ replyId, answer: record.message_body }, 'Dolor calificado'),
      titleSuffix: 'WhatsApp Revenue OS',
      notes: 'Solicitó ejemplo WhatsApp → CRM; se mantiene como mecanismo elegido hasta que pida aplicarlo/costo/agenda',
    });
    await enqueueIa360Interactive({
      record,
      label: 'ia360_lite_whatsapp_crm_example',
      messageBody: 'IA360 ejemplo: WhatsApp a CRM',
      interactive: {
        type: 'button',
        header: { type: 'text', text: 'WhatsApp → CRM' },
        body: { text: 'Ejemplo: un mensaje entra por WhatsApp, se etiqueta por intención, cae en pipeline, crea/actualiza contacto en CRM y genera tarea humana si hay alta intención.' },
        footer: { text: 'Este mismo flujo ya empezó aquí' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'wa_flow_map', title: 'Ver flujo' } },
            { type: 'reply', reply: { id: 'wa_apply', title: 'Aplicarlo' } },
            { type: 'reply', reply: { id: 'wa_schedule', title: 'Agendar' } },
          ],
        },
      },
    });
    return;
  }

  if (answer === 'hoy' || answer === 'mañana' || answer === 'manana' || answer === 'esta semana' || replyId === 'sched_today' || replyId === 'sched_tomorrow' || replyId === 'sched_week') {
    const day = replyId === 'sched_today' || answer === 'hoy'
      ? 'today'
      : (replyId === 'sched_week' || answer === 'esta semana' ? 'this_week' : 'tomorrow');
    const availability = await requestIa360Availability({ record, day });
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'requiere-alek', 'hot-lead', 'reunion-solicitada'],
      customFields: {
        ia360_ultima_respuesta: record.message_body,
        proximo_followup: `Elegir hora disponible para: ${record.message_body}`,
        ultimo_cta_enviado: 'ia360_lite_agenda_slots',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: getIa360StageForEvent('agenda_preference_selected', 'Agenda en proceso'),
      titleSuffix: `Agenda ${record.message_body}`,
      notes: `Preferencia de día seleccionada: ${record.message_body}; se consultó disponibilidad real de Calendar para ofrecer horas libres`,
    });
    const slots = availability?.slots || [];
    if (slots.length === 0) {
      await enqueueIa360Text({
        record,
        label: 'ia360_100m_schedule_no_slots',
        body: `Revisé la agenda real de Alek y no veo espacios libres de 1 hora en esa ventana.\n\nElige otra opción de día o escribe una ventana específica y lo revisamos antes de confirmar.`,
      });
      return;
    }
    await enqueueIa360Interactive({
      record,
      label: 'ia360_lite_available_slots',
      messageBody: `IA360: horarios disponibles ${availability.date}`,
      interactive: {
        type: 'list',
        header: { type: 'text', text: 'Horarios libres' },
        body: { text: `Revisé Calendar de Alek. Estos espacios de 1 hora están libres (${availability.date}, hora CDMX). Elige uno y lo confirmo con Calendar + Zoom.` },
        footer: { text: 'Se revalida antes de reservar' },
        action: {
          button: 'Elegir hora',
          sections: [{
            title: 'Disponibles',
            rows: slots.slice(0, 10).map((slot) => ({
              id: slot.id,
              title: slot.title,
              description: slot.description,
            })),
          }],
        },
      },
    });
    return;
  }

  // CFM-STEP (paso de confirmación, aditivo): al TOCAR un horario (slot_<ISO>) NO
  // agendamos al instante. Interceptamos y mandamos un mensaje interactivo de
  // confirmación con dos botones: "Sí, agendar" (cfm_<ISO>) y "Ver otras" (reslots).
  // El booking real solo ocurre con cfm_<ISO> (abajo). Todo va en try/catch terminal:
  // si algo falla, log + return (NUNCA cae al booking — ese es justo el riesgo que
  // este paso existe para prevenir).
  const tappedSlot = parseIa360SlotId(replyId);
  if (tappedSlot) {
    try {
      // El id ya viene en minúsculas (getInteractiveReplyId). Reconstruimos el id de
      // confirmación conservando el mismo ISO codificado: slot_<...> -> cfm_<...>.
      const isoSuffix = replyId.slice('slot_'.length); // ej '20260605t160000z'
      const confirmId = `cfm_${isoSuffix}`;             // ej 'cfm_20260605t160000z'
      const promptTime = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(tappedSlot.start));
      await enqueueIa360Interactive({
        record,
        label: 'ia360_lite_slot_confirm_prompt',
        messageBody: `IA360: confirmar horario ${promptTime}`,
        interactive: {
          type: 'button',
          header: { type: 'text', text: 'Confirmar reunión' },
          body: { text: `¿Confirmas tu reunión con Alek el ${promptTime} (hora del centro de México)?` },
          footer: { text: 'Se revalida antes de reservar' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: confirmId, title: 'Sí, agendar' } },
              { type: 'reply', reply: { id: 'reslots', title: 'Ver otras' } },
            ],
          },
        },
      });
    } catch (e) {
      console.error('[ia360-calendar] slot confirm prompt error:', e.message);
      // G-LIVE (auditoría 06-11): el prospecto ELIGIÓ hora; si el prompt de
      // confirmación falla, no puede quedar mudo en el paso más caliente del
      // booking — y Alek debe enterarse para cerrar la cita manualmente.
      await enqueueIa360Text({
        record,
        label: 'ia360_lite_slot_confirm_fallback',
        body: 'Vi que elegiste un horario. Déjame confirmarlo con Calendar y te escribo en un momento para cerrarlo.',
      }).catch(() => {});
      await handleIa360BotFailure({
        record,
        reason: 'booking: falló el prompt de confirmación de horario (' + String(e.message || '').slice(0, 80) + ')',
        alreadyResponded: true,
      }).catch(err2 => console.error('[ia360-failure] slot confirm alert error:', err2.message));
    }
    return;
  }

  // CFM-STEP: re-mostrar el menú de horarios ("Ver otras"). Re-dispara el spread
  // multi-día (nextAvailable) y reconstruye la lista interactiva inline (mismo shape
  // que el path de día). try/catch terminal: si falla, log + texto de respaldo.
  if (replyId === 'gate_slots_no') {
    await enqueueIa360Text({ record, label: 'ia360_gate_slots_no', body: 'Va, sin prisa. Cuando quieras ver horarios para hablar con Alek, dime y te paso opciones.' });
    return;
  }
  if (replyId === 'reslots' || replyId === 'gate_slots_yes') {
    try {
      const availUrl = process.env.N8N_IA360_AVAILABILITY_WEBHOOK_URL;
      let spread = null;
      if (availUrl) {
        const r = await fetch(availUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: 'forgechat-ia360-webhook', workStartHour: 10, workEndHour: 18, slotMinutes: 60, nextAvailable: true }),
        });
        spread = r.ok ? await r.json() : null;
      }
      const reSlots = (spread && spread.slots) || [];
      if (reSlots.length === 0) {
        await enqueueIa360Text({
          record,
          label: 'ia360_lite_reslots_none',
          body: 'Revisé la agenda real de Alek y no veo espacios de 1 hora libres en los próximos días hábiles. ¿Te late que le pase a Alek que te contacte para cuadrar un horario?',
        });
        return;
      }
      await enqueueIa360Interactive({
        record,
        label: 'ia360_lite_available_slots_reslots',
        messageBody: `IA360: horarios disponibles${spread.date ? ' ' + spread.date : ''}`,
        interactive: {
          type: 'list',
          header: { type: 'text', text: 'Horarios libres' },
          body: { text: 'Te paso opciones de los próximos días (hora CDMX). Elige una y la confirmo con Calendar + Zoom.' },
          footer: { text: 'Se revalida antes de reservar' },
          action: {
            button: 'Elegir hora',
            sections: [{
              title: 'Disponibles',
              rows: reSlots.slice(0, 10).map((slot) => ({
                id: slot.id,
                title: String(slot.title).slice(0, 24),
                description: slot.description,
              })),
            }],
          },
        },
      });
    } catch (e) {
      console.error('[ia360-calendar] reslots handler error:', e.message);
      await enqueueIa360Text({
        record,
        label: 'ia360_lite_reslots_holding',
        body: 'Déjame revisar la agenda y te confirmo opciones en un momento.',
      });
    }
    return;
  }

  // CFM-STEP: booking REAL. Solo ocurre cuando el prospecto pulsa "Sí, agendar"
  // (cfm_<ISO>). Aquí vive TODO el flujo de reserva que antes corría al tocar el slot:
  // parse -> bookIa360Slot (Zoom + Calendar) -> mutar estado/etapa -> confirmación
  // final -> handoff n8n. El id de confirmación carga el mismo ISO; lo reescribimos a
  // slot_<ISO> para reutilizar parseIa360SlotId verbatim (replyId ya en minúsculas).
  const confirmedSlot = replyId.startsWith('cfm_')
    ? parseIa360SlotId(`slot_${replyId.slice('cfm_'.length)}`)
    : null;
  if (confirmedSlot) {
    const booking = await bookIa360Slot({ record, ...confirmedSlot });
    if (!booking?.ok) {
      await enqueueIa360Text({
        record,
        label: 'ia360_100m_schedule_slot_busy',
        body: 'Ese horario ya no está disponible o no pude confirmarlo. Por seguridad no lo agendé. Vuelve a elegir día para mostrar horarios libres actualizados.',
      });
      return;
    }
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'reunion-confirmada', 'zoom-creado'],
      customFields: {
        ia360_ultima_respuesta: record.message_body,
        proximo_followup: `Reunión confirmada: ${booking.start}`,
        ultimo_cta_enviado: 'ia360_lite_reunion_confirmada',
        // HITL/compat: campos sueltos de la ULTIMA cita (legacy). La fuente de verdad
        // para multi-cita es `ia360_bookings` (append abajo), NO estos campos.
        ia360_booking_event_id: booking.calendarEventId || '',
        ia360_booking_zoom_id: booking.zoomMeetingId || '',
        ia360_booking_start: booking.start || '',
      },
    });
    // MULTI-CITA: en vez de SOBREESCRIBIR, AGREGAMOS esta cita al array de reservas.
    // try/catch propio: si el append falla, la cita ya quedo en los campos sueltos
    // (la confirmacion y el deal no se bloquean).
    try {
      await appendIa360Booking({
        waNumber: record.wa_number,
        contactNumber: record.contact_number,
        booking: { start: booking.start || '', event_id: booking.calendarEventId || '', zoom_id: booking.zoomMeetingId || '' },
      });
    } catch (apErr) {
      console.error('[ia360-multicita] append on booking failed:', apErr.message);
    }
    await syncIa360Deal({
      record,
      targetStageName: getIa360StageForEvent('meeting_confirmed_calendar_zoom', 'Reunión agendada'),
      titleSuffix: 'Reunión confirmada',
      notes: `Reunión confirmada. Calendar event: ${booking.calendarEventId}; Zoom meeting: ${booking.zoomMeetingId}; inicio: ${booking.start}`,
    });
    const confirmedTime = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(booking.start));
    let calLink = "";
    try {
      const _calToken = require("crypto").randomBytes(18).toString("base64url");
      const _endUtc = (confirmedSlot && confirmedSlot.end) || new Date(new Date(booking.start).getTime() + 3600000).toISOString();
      const _exp = new Date(new Date(booking.start).getTime() + 36*3600000).toISOString();
      await pool.query("INSERT INTO coexistence.ia360_meeting_links (token,event_id,contact_number,kind,start_utc,end_utc,summary,zoom_join_url,expires_at) VALUES ($1,$2,$3,\x27cal\x27,$4,$5,$6,$7,$8) ON CONFLICT (token) DO NOTHING", [_calToken, booking.calendarEventId || "", record.contact_number, booking.start, _endUtc, "Reunion con Alek (TransformIA)", booking.zoomJoinUrl || "", _exp]);
      calLink = "\n\nAgrega la cita a tu calendario:\nhttps://wa.geekstudio.dev/api/r/" + _calToken;
    } catch (clErr) { console.error("[ia360-cal] booking token failed:", clErr.message); }
    await enqueueIa360Text({
      record,
      label: 'ia360_100m_schedule_confirmed',
      body: `Listo, tu reunión con Alek quedó agendada para ${confirmedTime} (hora CDMX).\n\n${booking.zoomJoinUrl ? 'Aquí tu enlace de Zoom para conectarte:\n' + booking.zoomJoinUrl : 'En un momento te confirmo el enlace de Zoom.'}${calLink}\n\n¡Nos vemos!`,
    });
    // W4 D2 — ofrecer "Enviar contexto" ahora que YA hay slot (el helper stage-aware lo manda a
    // pre_call). Aditivo: NO altera el mensaje de confirmacion (critico) y no rompe el booking.
    try {
      await enqueueIa360Interactive({
        record,
        label: 'ia360_postbooking_send_context',
        messageBody: 'IA360: ofrecer enviar contexto pre-llamada',
        dedupSuffix: ':sendctx',
        interactive: {
          type: 'button',
          header: { type: 'text', text: 'Antes de la reunión (opcional)' },
          body: { text: 'Si quieres que Alek llegue con tu contexto a la mano, mándamelo en 30 segundos. Si no, así ya quedó listo y nos vemos en la reunión.' },
          footer: { text: 'IA360 · opcional' },
          action: { buttons: [
            { type: 'reply', reply: { id: '100m_send_context', title: 'Enviar contexto' } },
          ] },
        },
      });
    } catch (ctxErr) {
      console.error('[ia360-flowwire] post-booking send-context offer failed:', ctxErr.message);
    }
    await emitIa360N8nHandoff({
      record,
      eventType: 'meeting_confirmed_calendar_zoom',
      targetStage: getIa360StageForEvent('meeting_confirmed_calendar_zoom', 'Reunión agendada'),
      priority: 'high',
      summary: `Reunión confirmada con Calendar/Zoom. Calendar event ${booking.calendarEventId}; Zoom meeting ${booking.zoomMeetingId}; inicio ${booking.start}.`,
    });
    return;
  }

  if (replyId === 'ex_erp_bi' || answer === 'erp → bi' || answer === 'erp -> bi') {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'interes-datapower', 'ejemplo-solicitado'],
      customFields: {
        ia360_ultima_respuesta: 'ERP → BI',
        servicio_recomendado: 'DataPower BI / ERP analytics',
        ultimo_cta_enviado: 'ia360_lite_example_erp_bi',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: getIa360StageForReply({ replyId, answer: record.message_body }, 'Dolor calificado'),
      titleSuffix: 'ERP → BI',
      notes: 'Solicitó ejemplo ERP → BI; se mantiene como mecanismo elegido hasta que pida aplicarlo/costo/agenda',
    });
    await enqueueIa360Interactive({
      record,
      label: 'ia360_lite_example_erp_bi_detail',
      messageBody: 'IA360 ejemplo: ERP → BI',
      interactive: {
        type: 'button',
        header: { type: 'text', text: 'ERP → BI' },
        body: { text: 'Ejemplo: conectamos ERP/CRM, normalizamos datos, generamos dashboard ejecutivo y alertas para decidir sin esperar reportes manuales.' },
        footer: { text: 'Caso DataPower BI' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'flow_architecture', title: 'Arquitectura' } },
            { type: 'reply', reply: { id: 'wa_apply', title: 'Aplicarlo' } },
            { type: 'reply', reply: { id: 'wa_schedule', title: 'Agendar' } },
          ],
        },
      },
    });
    return;
  }

  if (replyId === 'ex_agent_followup' || replyId === 'ex_gov_ai') {
    const isGov = replyId === 'ex_gov_ai';
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', isGov ? 'interes-gobierno-ia' : 'interes-agentic-automation', 'ejemplo-solicitado'],
      customFields: {
        ia360_ultima_respuesta: record.message_body,
        servicio_recomendado: isGov ? 'Gobierno IA' : 'Agentic Follow-up',
        ultimo_cta_enviado: isGov ? 'ia360_lite_example_gov_ai' : 'ia360_lite_example_agent_followup',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: getIa360StageForReply({ replyId, answer: record.message_body }, 'Dolor calificado'),
      titleSuffix: record.message_body,
      notes: `Solicitó ejemplo ${record.message_body}; se mantiene como mecanismo elegido hasta que pida aplicarlo/costo/agenda`,
    });
    await enqueueIa360Interactive({
      record,
      label: isGov ? 'ia360_lite_example_gov_ai_detail' : 'ia360_lite_example_agent_followup_detail',
      messageBody: `IA360 ejemplo: ${record.message_body}`,
      interactive: {
        type: 'button',
        header: { type: 'text', text: record.message_body },
        body: { text: isGov ? 'Ejemplo: definimos reglas, roles, permisos, bitácora y criterios de escalamiento para usar IA sin perder control.' : 'Ejemplo: un agente detecta intención, prepara respuesta, actualiza CRM y escala al humano antes de compromisos sensibles.' },
        footer: { text: 'Humano en control' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'flow_architecture', title: 'Arquitectura' } },
            { type: 'reply', reply: { id: 'wa_apply', title: 'Aplicarlo' } },
            { type: 'reply', reply: { id: 'wa_schedule', title: 'Agendar' } },
          ],
        },
      },
    });
    return;
  }

  if (replyId === 'wa_flow_map' || replyId === 'wa_apply' || answer === 'ver flujo' || answer === 'aplicarlo') {
    const isApply = replyId === 'wa_apply' || answer === 'aplicarlo';
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'hot-lead', isApply ? 'requiere-alek' : 'flujo-solicitado'],
      customFields: {
        ia360_ultima_respuesta: record.message_body,
        ultimo_cta_enviado: isApply ? 'ia360_lite_aplicar' : 'ia360_lite_ver_flujo',
        proximo_followup: isApply ? 'Alek debe convertir a propuesta/implementación' : 'Enviar mapa visual del flujo WhatsApp → CRM',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: getIa360StageForReply({ replyId, answer: record.message_body }, isApply ? 'Requiere Alek' : 'Dolor calificado'),
      titleSuffix: record.message_body,
      notes: `Solicitó ${record.message_body} del ejemplo WhatsApp → CRM`,
    });
    await enqueueIa360Interactive({
      record,
      label: isApply ? 'ia360_lite_apply_next' : 'ia360_lite_flow_map',
      messageBody: isApply ? 'IA360: aplicar flujo WhatsApp Revenue OS' : 'IA360: mapa del flujo WhatsApp → CRM',
      interactive: isApply ? {
        type: 'button',
        header: { type: 'text', text: 'Aplicarlo' },
        body: { text: 'Perfecto. Lo convertiría así: 1) objetivos y reglas, 2) inbox + tags, 3) pipeline, 4) handoff humano, 5) medición. ¿Qué quieres que prepare?' },
        footer: { text: 'Siguiente paso comercial' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'apply_scope', title: 'Alcance' } },
            { type: 'reply', reply: { id: 'apply_cost', title: 'Costo' } },
            { type: 'reply', reply: { id: 'apply_call', title: 'Llamada' } },
          ],
        },
      } : {
        type: 'button',
        header: { type: 'text', text: 'Flujo WhatsApp → CRM' },
        body: { text: 'Mapa: 1) entra mensaje, 2) se clasifica intención, 3) aplica tags/campos, 4) crea o mueve deal, 5) si hay alta intención crea tarea humana, 6) responde con el siguiente micro-paso.' },
        footer: { text: 'UX ligera + humano en control' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'flow_architecture', title: 'Arquitectura' } },
            { type: 'reply', reply: { id: 'wa_apply', title: 'Aplicarlo' } },
            { type: 'reply', reply: { id: 'wa_schedule', title: 'Agendar' } },
          ],
        },
      },
    });
    return;
  }

  if (replyId === 'apply_call') {
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'hot-lead', 'requiere-alek', 'llamada-solicitada'],
      customFields: {
        ia360_ultima_respuesta: record.message_body,
        ultimo_cta_enviado: 'apply_call_terminal',
        proximo_followup: 'Alek debe proponer llamada y objetivo',
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: getIa360StageForEvent('call_requested', 'Agenda en proceso'),
      titleSuffix: 'Llamada',
      notes: 'Solicitó llamada; falta crear evento real en calendario/Zoom',
    });
    // W4 — pre_call: al pedir llamada, abre el Flow de contexto pre-llamada (captura empresa/rol/
    // objetivo/sistemas/buen resultado). Cae al texto de handoff si el envio falla. El handoff a
    // n8n/Alek (call_requested) se dispara SIEMPRE despues, independiente del Flow.
    let preCallSent = false;
    try {
      preCallSent = await enqueueIa360FlowMessage({
        record,
        flowId: '862907796864124',
        screen: 'PRE_CALL_INTAKE',
        cta: 'Enviar contexto',
        bodyText: 'Para que Alek llegue preparado a tu llamada (no demo de cajón): cuéntame empresa, tu rol, el objetivo, los sistemas que usan hoy y qué sería un buen resultado.',
        mediaUrl: 'https://wa.geekstudio.dev/ia360-bca/transformacion.jpg',
        flowToken: 'ia360_pre_call',
        label: 'ia360_apply_call_precall',
      });
    } catch (flowErr) {
      console.error('[ia360-flowwire] pre_call flow send (apply_call) failed, falling back to text:', flowErr.message);
    }
    if (!preCallSent) {
      await enqueueIa360Text({
        record,
        label: 'ia360_100m_call_terminal_handoff',
        body: 'Listo: lo marco como solicitud de llamada. No envío más opciones automáticas aquí para no dar vueltas.\n\nSiguiente paso humano: Alek confirma objetivo, horario y enlace. En la siguiente fase n8n debe crear tarea en EspoCRM y evento Zoom/Calendar automáticamente.',
      });
    }
    await emitIa360N8nHandoff({
      record,
      eventType: 'call_requested',
      targetStage: 'Agenda en proceso',
      priority: 'high',
      summary: 'El contacto pidió llamada. Crear tarea humana, preparar resumen y proponer horario/enlace.',
    });
    return;
  }

  if (replyId === 'flow_architecture' || replyId === 'apply_scope' || replyId === 'apply_cost' || replyId === 'apply_call') {
    const isCall = replyId === 'apply_call';
    const isCost = replyId === 'apply_cost';
    const isScope = replyId === 'apply_scope';
    await mergeContactIa360State({
      waNumber: record.wa_number,
      contactNumber: record.contact_number,
      tags: ['campana-ia360', 'hot-lead', isCall ? 'requiere-alek' : 'detalle-solicitado'],
      customFields: {
        ia360_ultima_respuesta: record.message_body,
        ultimo_cta_enviado: replyId,
        proximo_followup: isCall ? 'Alek debe proponer llamada' : `Enviar detalle: ${record.message_body}`,
      },
    });
    await syncIa360Deal({
      record,
      targetStageName: getIa360StageForReply({ replyId, answer: record.message_body }, isCall ? 'Agenda en proceso' : (isCost ? 'Propuesta / siguiente paso' : 'Requiere Alek')),
      titleSuffix: record.message_body,
      notes: `Solicitó detalle: ${record.message_body}`,
    });
    await enqueueIa360Interactive({
      record,
      label: `ia360_lite_${replyId}`,
      messageBody: `IA360: detalle ${record.message_body}`,
      interactive: {
        type: 'button',
        header: { type: 'text', text: record.message_body },
        body: { text: isCost ? 'Para costo real necesito alcance: canales, volumen, integraciones y nivel de IA/humano. Puedo preparar rango inicial o agendar revisión.' : isScope ? 'Alcance base: WhatsApp inbox, tags/campos, pipeline, 3-5 microflujos, handoff humano y medición. Luego se conecta CRM/n8n.' : isCall ? 'Va. Esto ya requiere humano: Alek debe proponerte horario y revisar objetivo, stack e integración.' : 'Arquitectura: WhatsApp Cloud API → ForgeChat inbox/flows → pipeline/tags → n8n/EspoCRM → tareas/resumen humano.' },
        footer: { text: 'Siguiente micro-paso' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'wa_schedule', title: 'Agendar' } },
            { type: 'reply', reply: { id: 'apply_call', title: 'Llamada' } },
          ],
        },
      },
    });
    return;
  }

  // ── G6: ÚLTIMO RECURSO PARA BOTONES DE OPENER (quick-reply sin payload) ─────
  // Los quick-reply de los templates fríos del opener llegan con id = el TÍTULO
  // visible ("Sí, cuéntame" / "Ahora no") y SIN payload estable. handleRevenueOsButton
  // y el resolver de alias seq_* los rutean SOLO cuando el contacto está en el
  // estado correcto (apertura_sent / persona-first enviado). Si su proceso no
  // calza ese estado, declinaban y el botón moría en [ia360-fallback]
  // (log: "unhandled interactive reply id=si, cuentame"). Aquí, ya que todos los
  // handlers gateados declinaron, clasificamos el id normalizado (minúsculas, sin
  // acentos, sin puntuación, trim) y damos un siguiente paso COHERENTE en vez del
  // fallback genérico. Reusamos el copy de Revenue OS (demo/onboarding).
  // TODO(G6+): buildIa360OpenerInteractive (~L3474) debe emitir payload ESTABLE
  // (p.ej. `opener:<seq>:si` / `opener:<seq>:no`) en vez de depender del título;
  // cuando lo haga, este clasificador por texto queda solo como red de seguridad
  // para los templates fríos viejos ya enviados.
  const openerKind = classifyOpenerReply(replyId || answer);
  if (openerKind) {
    try {
      const safeName = record.contact_name || record.contact_number;
      if (openerKind === 'affirmative') {
        // "Sí, cuéntame" → abre la conversación de demo/onboarding con la pregunta
        // de calificación (PASO 2 de Revenue OS) y deja estado para que su texto
        // libre siguiente llegue al agente. NO es el fallback genérico.
        await mergeContactIa360State({
          waNumber: record.wa_number,
          contactNumber: record.contact_number,
          tags: ['revenue-os-interesado'],
          customFields: { ia360_revenue_state: 'calificacion', ultimo_cta_enviado: 'ia360_opener_si_recovery' },
        }).catch(e => console.error('[ia360-opener] state affirmative:', e.message));
        await enqueueIa360Text({ record, label: 'ia360_opener_si_recovery', body: REVENUE_OS_COPY.paso2 });
        await sendIa360DirectText({
          record,
          toNumber: IA360_OWNER_NUMBER,
          label: 'owner_opener_si_recovery',
          body: `Alek, ${safeName} (${record.contact_number}) tocó "Sí, cuéntame" de un opener (id: ${replyId || answer || '-'}) sin estado activo. Le respondí con la pregunta de calificación para abrir la demo; quedó en "calificación".`,
          targetContact: record.contact_number,
          ownerBudget: true,
        }).catch(e => console.error('[ia360-opener] owner notice si:', e.message));
      } else {
        // "Ahora no" → cierre cortés (mismo copy que Revenue OS) + nutrición suave.
        await mergeContactIa360State({
          waNumber: record.wa_number,
          contactNumber: record.contact_number,
          tags: ['nutricion-suave'],
          customFields: { ia360_revenue_state: 'nutricion', ultimo_cta_enviado: 'ia360_opener_ahora_no_recovery' },
        }).catch(e => console.error('[ia360-opener] state negative:', e.message));
        await enqueueIa360Text({ record, label: 'ia360_opener_ahora_no_recovery', body: REVENUE_OS_COPY.ahoraNo });
        await sendIa360DirectText({
          record,
          toNumber: IA360_OWNER_NUMBER,
          label: 'owner_opener_ahora_no_recovery',
          body: `Alek, ${safeName} (${record.contact_number}) tocó "Ahora no" de un opener (id: ${replyId || answer || '-'}). Cerré cortés y lo dejé en nutrición suave.`,
          targetContact: record.contact_number,
          ownerBudget: true,
        }).catch(e => console.error('[ia360-opener] owner notice no:', e.message));
      }
    } catch (openerErr) {
      console.error('[ia360-opener] recovery handler error:', openerErr.message);
    }
    return;
  }

  // ── FALLBACK GLOBAL DE INTERACTIVE (openers v2) ────────────────────────────
  // Si llegamos aquí, NINGÚN handler reconoció el button/list reply (id viejo o
  // malformado). Los ids seq_* del catálogo y los quick replies de template con
  // estado persona-first ya se rutean arriba (handleIa360SequenceReply + alias);
  // aquí solo cae lo verdaderamente desconocido. El contacto siempre recibe
  // acuse y el owner se entera. try/catch terminal: nunca tumba el webhook.
  try {
    const fallbackId = replyId || answer || '(sin id)';
    console.warn('[ia360-fallback] unhandled interactive reply contact=%s id=%s body=%s', record.contact_number || '-', fallbackId, String(record.message_body || '').slice(0, 80));
    if (normalizePhone(record.contact_number) === IA360_OWNER_NUMBER) {
      await sendIa360DirectText({
        record,
        toNumber: IA360_OWNER_NUMBER,
        label: 'owner_interactive_fallback_ack',
        body: `Recibí tu respuesta "${String(record.message_body || fallbackId).slice(0, 60)}", pero aún no tengo una acción conectada para ese botón (${fallbackId}). No hice ningún cambio.`,
      });
      return;
    }
    await enqueueIa360Text({
      record,
      label: 'ia360_interactive_fallback',
      body: 'Recibí tu respuesta y la estoy ubicando para darte una respuesta útil. Si es urgente, Alek también puede escribirte directo.',
    });
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'owner_interactive_fallback_notice',
      body: `Alek, ${record.contact_name || record.contact_number} (${record.contact_number}) respondió "${String(record.message_body || fallbackId).slice(0, 60)}" (id: ${fallbackId}) y no tengo un manejador para esa opción. Le acusé recibo; revisa si quieres tomarlo tú.`,
      targetContact: record.contact_number,
      ownerBudget: true,
    });
  } catch (fbErr) {
    console.error('[ia360-fallback] interactive fallback error:', fbErr.message);
  }
}


/**
 * POST /api/webhook/whatsapp
 * Receives raw Meta WhatsApp webhook payloads forwarded by n8n.
 * No auth required — called by internal n8n instance.
 */
// ============================================================================
// CANARY Brain v2 — enrutamiento reversible por allowlist. Fuera de la allowlist
// (o con el flag off) este codigo es NO-OP: el monolito se comporta igual para
// todos los demas numeros. Cuando IA360_BRAIN_V2_CANARY='on' y el remitente esta
// en IA360_BRAIN_V2_ALLOWLIST, el TEXTO entrante se enruta al Brain v2 (workflow
// b74vYWxP5YT8dQ2H, path /webhook/ia360-brain-v2-test) en vez del monolito.
// Egress UNICO via messageSender (sendIa360DirectText / handleIa360FreeText).
//   - Prefijo "/sim " => v2 trata al owner como CONTACTO simulado (force_actor)
//     y genera respuesta conversacional (rama responder_llm).
//   - owner directo (sin /sim) => v2 route owner_operator => SIN reply.
//   - intent agendamiento (con /sim) => handback al booking existente del monolito.
// SOLO intercepta message_type='text'; interactivos/botones del owner (cancelar,
// calendario) siguen yendo al monolito intactos. Reversible: apagar el flag o
// vaciar la allowlist restituye el monolito sin redeploy de codigo.
// ============================================================================
const IA360_BRAIN_V2_CANARY_ON = process.env.IA360_BRAIN_V2_CANARY === 'on';
const IA360_BRAIN_V2_ALLOWLIST = new Set(
  String(process.env.IA360_BRAIN_V2_ALLOWLIST || '')
    .split(/[,\s]+/).map(x => x.replace(/\D/g, '')).filter(Boolean)
);
const IA360_BRAIN_V2_URL = process.env.N8N_IA360_BRAIN_V2_URL || 'https://n8n.geekstudio.dev/webhook/ia360-brain-v2-test';
const IA360_BRAIN_V2_SIM_PREFIX = '/sim';
console.log('[brain-v2-canary] boot canary=%s allowlist=%d url=%s',
  IA360_BRAIN_V2_CANARY_ON ? 'on' : 'off', IA360_BRAIN_V2_ALLOWLIST.size, IA360_BRAIN_V2_URL);

function ia360BrainV2CanaryEligible(record) {
  if (!IA360_BRAIN_V2_CANARY_ON) return false;
  if (!record || record.direction !== 'incoming' || record.message_type !== 'text') return false;
  if (!String(record.message_body || '').trim()) return false;
  if (!IA360_BRAIN_V2_ALLOWLIST.has(normalizePhone(record.contact_number))) return false;
  // G-LIVE (auditoría 06-11): el canary es un arnés del OWNER — todo su egress va
  // hard-coded al owner. Un contacto real allowlisted por error quedaría 100% mudo
  // (el route hace continue y el monolito nunca ve el mensaje). El invariante
  // owner-only vive en código, no solo en el .env: un no-owner cae al monolito.
  if (normalizePhone(record.contact_number) !== IA360_OWNER_NUMBER) {
    console.error('[brain-v2-canary] allowlist contiene un no-owner %s — cayendo al monolito',
      maskIa360Number(record.contact_number));
    return false;
  }
  return true;
}

async function callBrainV2({ contactWaNumber, message, forceActor }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(IA360_BRAIN_V2_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contact_wa_number: contactWaNumber, message, force_actor: forceActor || '' }),
      signal: controller.signal,
    });
    if (!res.ok) { console.error('[brain-v2-canary] n8n failed:', res.status); return null; }
    const text = await res.text();
    if (!text || !text.trim()) { console.error('[brain-v2-canary] empty body status=%s', res.status); return null; }
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { console.error('[brain-v2-canary] bad JSON:', e.message); return null; }
    return Array.isArray(parsed) ? (parsed[0] || null) : parsed;
  } catch (err) {
    console.error('[brain-v2-canary] error:', err.name === 'AbortError' ? 'timeout 30000ms' : err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function handleBrainV2Canary(record) {
  const raw = String(record.message_body || '').trim();
  let message = raw;
  let forceActor = '';
  const lower = raw.toLowerCase();
  if (lower === IA360_BRAIN_V2_SIM_PREFIX || lower.startsWith(IA360_BRAIN_V2_SIM_PREFIX + ' ')) {
    forceActor = 'contact';
    message = raw.slice(IA360_BRAIN_V2_SIM_PREFIX.length).trim();
    if (!message) {
      await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'brainv2_sim_empty', body: 'Modo simulacion Brain v2: escribe "/sim <tu mensaje>" para que te responda como contacto.' });
      return;
    }
  }
  const isOwnerDirect = normalizePhone(record.contact_number) === IA360_OWNER_NUMBER && !forceActor;
  if (isOwnerDirect) {
    await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'brainv2_owner_operator_local',
      body: [
        'Te leo como owner. Brain v2 sigue en canary, pero ya no te voy a mandar el error genérico.',
        '',
        'Comandos útiles:',
        '- `/sim <mensaje>` para probar cómo respondería a un contacto.',
        '- `idea: <texto>` para mandar algo a la bandeja de ideas.',
        '- `qué sabes de <nombre|número>` para consultar memoria.',
        '- `sincroniza a <nombre|número>` para vincular notas del vault.'
      ].join('\n')
    });
    return;
  }
  console.log('[brain-v2-canary] routing contact=%s force_actor=%s msg=%j', record.contact_number, forceActor || '-', message.slice(0, 80));
  const out = await callBrainV2({ contactWaNumber: record.contact_number, message, forceActor });
  if (!out) {
    await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'brainv2_holding', body: 'Brain v2 no devolvió respuesta para la simulación. La ruta owner directa sigue disponible; reviso el workflow antes de otro intento.' });
    return;
  }
  const branch = out.branch || out.route || 'fallback';
  console.log('[brain-v2-canary] branch=%s intent=%s actor=%s', branch, out.intent || '-', out.actor_type || '-');
  if (branch === 'responder_llm') {
    const reply = String(out.reply_text || '').trim();
    if (!reply) { console.warn('[brain-v2-canary] responder_llm sin reply_text'); return; }
    await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'brainv2_responder', body: reply });
    return;
  }
  if (branch === 'agendamiento_handback') {
    // El booking vive en el monolito: reinyectamos el texto (sin /sim) al agente
    // de agenda existente, tratando al owner como contacto simulado.
    const handbackRecord = Object.assign({}, record, { message_body: message });
    console.log('[brain-v2-canary] handback -> booking existente del monolito');
    await handleIa360FreeText(handbackRecord).catch(e => console.error('[brain-v2-canary] handback error:', e.message));
    return;
  }
  await sendIa360DirectText({
    record,
    toNumber: IA360_OWNER_NUMBER,
    label: 'brainv2_no_route',
    body: `Brain v2 devolvió la rama "${branch}" sin respuesta final. No te dejo mudo; usa /sim <mensaje> para probar como contacto o dime qué flujo quieres revisar.`
  });
}

// G-LIVE QA-GUARD (incidente José Ramón): detecta payloads SINTÉTICOS del harness
// QA/E2E por su wamid (wamid.e2e.*, wamid.qa-harness.*, e2e.*, *harness*). Los wamid
// reales de Meta son 'wamid.' + base64 (sin más puntos), así que nunca matchean.
function isIa360SyntheticWamid(messageId) {
  // Solo el patrón con puntos: el cuerpo base64 de un wamid real no contiene puntos,
  // así que el falso positivo (descartar un mensaje real) es estructuralmente imposible.
  return /(^|\.)(e2e|qa[-_a-z0-9]*|harness)\./i.test(String(messageId || ''));
}

// Un payload sintético SOLO puede procesarse para números QA (52199900*) o el owner.
// Cualquier otro destino (contactos reales) se descarta completo: sin insert en
// chat_history, sin handlers, sin egress derivado.
function isIa360BlockedSyntheticInbound(record) {
  if (!record || !isIa360SyntheticWamid(record.message_id)) return false;
  const n = String(record.contact_number || '');
  return !(IA360_QA_NUMBER_RE.test(n) || n === IA360_OWNER_NUMBER);
}

router.post('/webhook/whatsapp', async (req, res) => {
  try {
    // Authenticity: this endpoint is necessarily unauthenticated (public), so
    // the control is Meta's HMAC signature. When META_APP_SECRET is configured
    // we REJECT anything unsigned/invalid; if it's not set we log a warning so
    // operators know inbound webhooks are unverified (forgeable).
    const sig = verifyMetaSignature(req);
    if (sig === false) {
      return res.status(403).json({ error: 'Invalid webhook signature' });
    }
    if (sig === null) {
      console.warn('[webhook] META_APP_SECRET not set — inbound webhook signature NOT verified (set it to reject forged payloads).');
    }

    const payload = req.body;
    if (!payload) {
      return res.status(400).json({ error: 'Empty payload' });
    }

    // Support both array of payloads (n8n batch) and single payload
    const payloads = Array.isArray(payload) ? payload : [payload];
    const allRecords = [];
    for (const p of payloads) {
      const records = parseMetaPayload(p);
      allRecords.push(...records);
    }

    // G-LIVE QA-GUARD: descartar payloads sintéticos dirigidos a números reales
    // ANTES de insertar o despachar nada (cierra el incidente José Ramón).
    let blockedSynthetic = 0;
    for (let i = allRecords.length - 1; i >= 0; i--) {
      if (isIa360BlockedSyntheticInbound(allRecords[i])) {
        const r = allRecords[i];
        console.warn('[qa-guard] payload sintético bloqueado: wamid=%s contact=%s type=%s',
          r.message_id, maskIa360Number(r.contact_number), r.message_type);
        allRecords.splice(i, 1);
        blockedSynthetic += 1;
      }
    }
    if (blockedSynthetic > 0 && allRecords.length === 0) {
      return res.status(200).json({ ok: true, stored: 0, blocked_synthetic: blockedSynthetic });
    }

    if (allRecords.length === 0) {
      // Acknowledge non-message webhooks (e.g. verification, errors)
      return res.status(200).json({ ok: true, stored: 0 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const r of allRecords) {
        // Status receipts (sent/delivered/read/failed) update the ORIGINAL
        // message's status — they must never create a chat row. Inserting them
        // produced phantom "Status: delivered" bubbles. If no matching message
        // exists (e.g. an app-sent message we don't track), this is a no-op.
        if (r.message_type === 'status') {
          const statusErrors = Array.isArray(r.errors) && r.errors.length > 0
            ? r.errors.map((e) => e?.message || e?.title || e?.code || JSON.stringify(e)).filter(Boolean).join('; ')
            : null;
          await client.query(
            `UPDATE coexistence.chat_history
                SET status = $1,
                    raw_payload = COALESCE($3::jsonb, raw_payload),
                    error_message = CASE
                      WHEN $1 IN ('failed', 'error') THEN COALESCE($4, error_message)
                      WHEN $1 IN ('sent', 'delivered', 'read') THEN NULL
                      ELSE error_message
                    END
              WHERE message_id = $2`,
            [r.status, r.message_id, r.raw_payload || null, statusErrors]
          );
          continue;
        }

        // Reactions are NOT chat bubbles — attach the emoji to the message it
        // reacts to (message_reactions). An empty emoji removes the reaction.
        if (r.message_type === 'reaction') {
          const tgt = r.reaction?.targetMessageId;
          if (tgt) {
            if (r.reaction.emoji) {
              await client.query(
                `INSERT INTO coexistence.message_reactions
                   (wa_number, contact_number, target_message_id, direction, emoji, reactor, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,NOW())
                 ON CONFLICT (target_message_id, direction)
                 DO UPDATE SET emoji = EXCLUDED.emoji, reactor = EXCLUDED.reactor, updated_at = NOW()`,
                [r.wa_number, r.contact_number, tgt, r.direction, r.reaction.emoji, r.reaction.from || null]
              );
            } else {
              await client.query(
                `DELETE FROM coexistence.message_reactions WHERE target_message_id = $1 AND direction = $2`,
                [tgt, r.direction]
              );
            }
          }
          continue;
        }

        // Upsert chat_history (ignore duplicates on message_id)
        await client.query(
          `INSERT INTO coexistence.chat_history
            (message_id, phone_number_id, wa_number, contact_number, to_number,
             direction, message_type, message_body, raw_payload, media_url,
             media_mime_type, media_filename, status, timestamp, context_message_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (message_id) DO UPDATE SET
             status = EXCLUDED.status,
             raw_payload = EXCLUDED.raw_payload`,
          [
            r.message_id, r.phone_number_id, r.wa_number, r.contact_number, r.to_number,
            r.direction, r.message_type, r.message_body, r.raw_payload, r.media_url,
            r.media_mime_type, r.media_filename || null, r.status, r.timestamp,
            r.context_message_id || null,
          ]
        );

        // Upsert the WhatsApp profile/push name into profile_name (NOT name).
        // `name` is reserved for a name we explicitly captured (AI ask-name flow
        // or manual save) so inbound messages don't clobber it — that clobbering
        // is what made the automation "is the contact known?" condition always
        // true. Display falls back to COALESCE(name, profile_name).
        if (r.contact_number && r.wa_number && r.contact_name) {
          await client.query(
            `INSERT INTO coexistence.contacts (wa_number, contact_number, profile_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (wa_number, contact_number) DO UPDATE SET
               profile_name = EXCLUDED.profile_name,
               updated_at = NOW()`,
            [r.wa_number, r.contact_number, r.contact_name]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Evaluate automation triggers
    // 1. For incoming messages (keyword, anyMessage, newContact triggers)
    //    First: if this conversation has paused executions awaiting a reply,
    //    resume them and SKIP fresh trigger evaluation for that record
    //    (the customer is mid-conversation — see plan: "Resume only — skip
    //    new trigger").
    const incomingRecords = allRecords.filter(r => r.direction === 'incoming' && r.message_type !== 'status' && r.message_type !== 'reaction');
    if (incomingRecords.length > 0) {
      for (const record of incomingRecords) {
        try {
          // G-LIVE: invariante no-silencio. Se programa ANTES de cualquier handler
          // para que cubra continues, throws y ramas fire-and-forget por igual.
          scheduleIa360NoSilenceWatchdog(record);
          // ── BANDEJA DE IDEAS: comando del owner "idea: <texto>" ─────
          // Va ANTES del canary Brain v2 (el owner está en la allowlist y el
          // canary haría continue). Captura, persiste y manda tarjeta de ruteo.
          if (record.message_type === 'text'
              && normalizePhone(record.contact_number) === IA360_OWNER_NUMBER) {
            const ideaMatch = String(record.message_body || '').trim().match(/^idea\s*:\s*([\s\S]+)$/i);
            if (ideaMatch && ideaMatch[1].trim()) {
              await handleIa360OwnerIdeaCommand({ record, texto: ideaMatch[1].trim() })
                .catch(e => console.error('[ia360-ideas] owner command error:', e.message));
              continue; // no procesar como mensaje normal
            }
          }
          // ── EXPEDIENTE: comando del owner "qué sabes de <nombre|número>" ──
          // Mismo patrón que "idea:": va ANTES del canary Brain v2 (el owner
          // está en la allowlist y el canary haría continue). Read-only sobre
          // ia360_memory_facts/events; responde SIEMPRE (nunca queda mudo).
          if (record.message_type === 'text'
              && normalizePhone(record.contact_number) === IA360_OWNER_NUMBER) {
            const memQuery = parseIa360OwnerMemoryQuery(record.message_body);
            if (memQuery) {
              await handleIa360OwnerMemoryQuery({ record, query: memQuery })
                .catch(e => console.error('[ia360-expediente] owner command error:', e.message));
              continue; // no procesar como mensaje normal
            }
          }
          // ── G-RAG: comando del owner "sincroniza a <nombre|número>" ──
          // Mismo patrón que el expediente: va ANTES del canary Brain v2 (el
          // owner está en la allowlist y el canary haría continue). Vincula
          // notas del vault al contacto y vuelca facts; nunca queda mudo.
          if (record.message_type === 'text'
              && normalizePhone(record.contact_number) === IA360_OWNER_NUMBER) {
            const syncMatch = String(record.message_body || '').trim().match(/^sincroniza(?:me)?\s+(?:a|al|con)\s+(.+)$/i);
            if (syncMatch && syncMatch[1].trim()) {
              await handleIa360OwnerVaultSync({ record, query: syncMatch[1].trim() })
                .catch(e => console.error('[ia360-vault] owner command error:', e.message));
              continue; // no procesar como mensaje normal
            }
          }
          // ── CANARY Brain v2 (reversible, allowlist) ──────────────────
          // Antes de TODO el pipeline del monolito: si el remitente esta en la
          // allowlist y el flag esta on, el texto se enruta al Brain v2 y NO toca
          // el monolito. Fire-and-forget (no bloquea el ACK 200 a Meta; el inbound
          // ya quedo persistido arriba). Fuera de la allowlist => no-op total.
          if (ia360BrainV2CanaryEligible(record)) {
            handleBrainV2Canary(record).catch(e => console.error('[brain-v2-canary] fire-and-forget:', e.message));
            continue;
          }
          // ── PRODUCTION-HARDENING: CAPTURA DEL COMENTARIO del owner ──────────
          // Va ANTES de TODO (paused-resume, flow, funnel): si el owner (Alek) tocó
          // "Comentar" en una alerta de fallo, su SIGUIENTE texto ES el comentario.
          // Gate barato y colisión-segura: solo owner + texto + flag presente (el flag
          // solo existe en la ventana corta tras tocar "Comentar", así que aunque su
          // número coincida con el del prospecto de prueba, no se confunde).
          if (record.message_type === 'text'
              && normalizePhone(record.contact_number) === IA360_OWNER_NUMBER
              && String(record.message_body || '').trim()) {
            try {
              const { rows: awRows } = await pool.query(
                `SELECT custom_fields->>'ia360_awaiting_comment_failure' AS fid
                   FROM coexistence.contacts
                  WHERE wa_number=$1 AND contact_number=$2
                  LIMIT 1`,
                [record.wa_number, record.contact_number]
              );
              const awaitingFid = awRows[0]?.fid;
              if (awaitingFid && String(awaitingFid).trim() !== '') {
                const comment = String(record.message_body || '').trim();
                await pool.query(
                  `UPDATE coexistence.ia360_bot_failures
                      SET owner_comment=$1, status='comentado'
                    WHERE id=$2`,
                  [comment, String(awaitingFid).replace(/\D/g, '')]
                ).catch(e => console.error('[ia360-failure] save comment:', e.message));
                // Limpia el flag. mergeContactIa360State NO borra llaves jsonb (solo
                // concatena), así que lo vaciamos a '' y el check de arriba es `<> ''`.
                await mergeContactIa360State({
                  waNumber: record.wa_number,
                  contactNumber: record.contact_number,
                  customFields: { ia360_awaiting_comment_failure: '' },
                }).catch(e => console.error('[ia360-failure] clear awaiting:', e.message));
                await sendIa360DirectText({ record, toNumber: IA360_OWNER_NUMBER, label: 'owner_comment_fail_saved', body: 'Gracias, guardado para seguir mejorando.' });
                continue; // NO procesar como mensaje normal (ni paused, ni funnel, ni triggers)
              }
            } catch (capErr) {
              console.error('[ia360-failure] comment-capture error:', capErr.message);
              // si la captura falla, dejamos que el mensaje siga el flujo normal
            }
          }

          // ── G-RAG: intake del vault al alta del contacto ─────────────────
          // Fire-and-forget (sin continue): el auto-match con el vault corre
          // UNA vez por contacto y no bloquea el flujo normal del mensaje.
          if (record.direction === 'incoming'
              && ['text', 'interactive', 'button'].includes(record.message_type)
              && !ia360VaultBlocklisted(normalizePhone(record.contact_number))) {
            maybeIa360VaultIntake(record).catch(e => console.error('[ia360-vault] intake error:', e.message));
          }

          if (await handleIa360SharedContacts(record)) {
            continue; // B-29: vCard capturada y owner-gated; no cae al embudo normal
          }

          // G-WIN cartera: el bot no lee imágenes. Si el contacto está a media
          // captura de tabla (esperando_tabla) y manda foto/archivo, pedimos la
          // versión en texto y no seguimos el embudo para este record.
          if (await handleCarteraMediaInbound(record)) {
            continue;
          }

          const { rows: pausedRows } = await pool.query(
            `SELECT id FROM coexistence.automation_executions
              WHERE wa_number=$1 AND contact_number=$2
                AND status='paused' AND expires_at>NOW()
              ORDER BY paused_at`,
            [record.wa_number, record.contact_number]
          );
          if (pausedRows.length > 0) {
            for (const p of pausedRows) {
              try {
                await resumeAutomation(pool, p.id, record);
              } catch (resumeErr) {
                console.error(`[webhook] Resume error for execution ${p.id}:`, resumeErr.message);
              }
            }
            continue; // do not also fire fresh triggers
          }
          await handleIa360LiteInteractive(record);
          // PASO 2 Revenue OS (calificación) — DEBE ir antes del agente genérico y
          // gatearlo: si el contacto está en estado 'calificacion', este handler captura
          // la señal, manda la propuesta (PASO 3) y CORTA el embudo (return true) para que
          // el agente no responda el mismo texto ni empuje agenda (guardrail). El owner
          // tiene deal vivo en P2, así que sin este gate el agente respondería en paralelo.
          const revHandled = await handleRevenueOsFreeText(record).catch(e => { console.error('[revenue-os] dispatch:', e.message); return false; });
          // G-WIN "Mapa de cartera" (P7 Champions) — mismo contrato que Revenue OS:
          // gateado por persona+tema+estado; si actúa, CORTA el embudo para que el
          // agente genérico no responda encima (guardrail: sin pitch, sin agenda).
          const carteraHandled = revHandled
            ? false
            : await handleCarteraFreeText(record).catch(e => { console.error('[cartera] dispatch:', e.message); return false; });
          // Free text (no button) inside an active funnel → AI agent (fire-and-forget; never blocks the Meta ack).
          if (!revHandled && !carteraHandled) handleIa360FreeText(record).catch(e => console.error('[ia360-agent] fire-and-forget:', e.message));
          await evaluateTriggers(record);
        } catch (triggerErr) {
          console.error('[webhook] Trigger evaluation error:', triggerErr.message);
          // G-LIVE (auditoría 06-11): un throw en el dispatch no debe dejar mudo al
          // contacto. Verificamos la VERDAD en chat_history (no flags) antes del
          // fallback; ante error del check, no doble-texteamos.
          if (record.direction === 'incoming'
              && ['text', 'interactive', 'button'].includes(record.message_type)
              && normalizePhone(record.contact_number) !== IA360_OWNER_NUMBER
              && !(record.message_type === 'text' && isIa360PassiveMessage(record.message_body))) {
            const hasOut = await ia360HasOutgoingForInbound(record).catch(() => true);
            if (!hasOut) {
              await handleIa360BotFailure({
                record,
                reason: 'error en dispatch: ' + String(triggerErr.message || 'desconocido').slice(0, 120),
                alreadyResponded: false,
              }).catch(e => console.error('[ia360-failure] dispatch fallback error:', e.message));
            }
          }
        }
      }
    }

    // 2. For status updates (messageRead, messageDelivered, messageSent triggers)
    const statusRecords = allRecords.filter(r => r.message_type === 'status');
    if (statusRecords.length > 0) {
      for (const record of statusRecords) {
        try {
          await evaluateTriggers(record);
        } catch (triggerErr) {
          console.error('[webhook] Status trigger evaluation error:', triggerErr.message);
        }
        // G5: circuit breaker de pago/elegibilidad (131042 y familia). Va fuera
        // de la transacción de inserción para no enviar dentro del BEGIN/COMMIT.
        try {
          await handleIa360PaymentCircuitBreaker(record);
        } catch (cbErr) {
          console.error('[ia360-payment-cb] error:', cbErr.message);
        }
      }
    }

    // Enqueue durable media downloads via BullMQ (concurrency-capped + retried)
    for (const r of allRecords) {
      if (MEDIA_TYPES.has(r.message_type) && r.media_url && r.message_id) {
        await markPending(r.message_id);
        enqueueMediaDownload(r.message_id).catch(() => {});
      }
    }

    console.log(`[webhook] Stored ${allRecords.length} record(s)`);
    res.status(200).json({
      ok: true,
      stored: allRecords.length,
      ...(blockedSynthetic > 0 ? { blocked_synthetic: blockedSynthetic } : {}),
    });
  } catch (err) {
    console.error('[webhook] Error:', err.message);
    // Always return 200 to n8n so it doesn't retry infinitely. Use a static
    // message — err.message can carry internal Postgres/schema details.
    res.status(200).json({ ok: false, error: 'Processing error' });
  }
});

/**
 * GET /api/webhook/whatsapp
 * Meta webhook verification endpoint (for direct Meta → ForgeChat webhooks).
 * Not needed for n8n forwarding, but included for completeness.
 */
router.get('/webhook/whatsapp', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  let accepted = false;
  if (mode === 'subscribe' && token) {
    // 1) The per-account Webhook Verify Token set in the connection form.
    try {
      const { rows } = await pool.query(
        `SELECT verify_token_encrypted FROM coexistence.whatsapp_accounts
          WHERE verify_token_encrypted IS NOT NULL`
      );
      for (const r of rows) {
        if (safeEqual(decrypt(r.verify_token_encrypted), token)) { accepted = true; break; }
      }
    } catch (err) {
      console.error('[webhook] verify-token lookup error:', err.message);
    }
    // 2) Backward-compatible env fallback.
    if (!accepted && process.env.META_WEBHOOK_VERIFY_TOKEN && safeEqual(process.env.META_WEBHOOK_VERIFY_TOKEN, token)) {
      accepted = true;
    }
  }

  if (accepted) {
    console.log('[webhook] Meta verification accepted');
    // Echo the challenge as plain text (Meta sends a numeric token). Sending it
    // as text/plain — not the res.send default of text/html — prevents the
    // reflected value from being interpreted as HTML (reflected-XSS).
    return res.status(200).type('text/plain').send(String(challenge ?? ''));
  }
  res.status(403).json({ error: 'Verification failed' });
});

// ============================================================================
// W6-EQUIPO-0 — Endpoint de callback n8n -> webhook.js (EGRESS UNICO)
// ----------------------------------------------------------------------------
// La capa de agentes n8n NO habla con Meta/ForgeChat. Emite una DIRECTIVA
// (Direccion B del contrato W6 §4.3 / W6b §6.3) por este endpoint y webhook.js
// la ejecuta por sendQueue (unico chokepoint de egress). Auth = header secreto
// compartido X-IA360-Directive-Secret. Montado en la zona PUBLICA (sin
// authMiddleware), igual que /webhook/whatsapp y /ia360-intake.
//
// GATE EQUIPO-0 (CERO OUTBOUND): mientras IA360_DIRECTIVE_EGRESS !== 'on' corre
// en DRY-RUN: valida y ACK, pero NUNCA encola ni envia. El cableado de envio
// real (free_reply/send_template/owner_notify/handback_booking) se completa en
// EQUIPO-1 (PARCIAL). NO toca el ciclo de agenda VIVO (12/12 PASS).
// ============================================================================
const IA360_DIRECTIVE_SECRET = process.env.IA360_DIRECTIVE_SECRET || '';
const IA360_DIRECTIVE_EGRESS_ON = process.env.IA360_DIRECTIVE_EGRESS === 'on';
const IA360_DIRECTIVE_ACTIONS = ['free_reply', 'send_template', 'handback_booking', 'owner_notify', 'noop'];

function isIa360InternalAuthorized(req) {
  const provided = req.get('X-IA360-Directive-Secret') || '';
  return Boolean(IA360_DIRECTIVE_SECRET && safeEqual(provided, IA360_DIRECTIVE_SECRET));
}

router.post('/internal/ia360-memory/lookup', async (req, res) => {
  if (!isIa360InternalAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const b = req.body || {};
    const record = {
      wa_number: normalizePhone(b.wa_number || b.contact?.wa_number || ''),
      contact_number: normalizePhone(b.contact_number || b.contact?.contact_number || b.contact?.wa_id || ''),
    };
    if (!record.wa_number || !record.contact_number) {
      return res.status(422).json({ ok: false, error: 'wa_number_and_contact_number_required' });
    }
    const contact = await loadIa360ContactContext(record);
    const memory = await lookupIa360MemoryContext({ record, contact, limit: Math.min(parseInt(b.limit || '8', 10) || 8, 20) });
    return res.json({
      ok: true,
      schema: 'ia360_memory_lookup.v1',
      contact: {
        masked_contact_number: maskIa360Number(record.contact_number),
        name: contact?.name || '',
      },
      facts: memory.facts,
      events: memory.events,
      guardrails: {
        transcript_returned: false,
        external_send_allowed: false,
      },
    });
  } catch (err) {
    console.error('[ia360-memory] lookup endpoint error:', err.message);
    return res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// PASO 1 Revenue OS (Pipeline 5) — dispara la apertura para un contacto. Auth =
// X-IA360-Directive-Secret (mismo patrón que los demás endpoints internos). Egress
// por el chokepoint único (enqueueIa360Template). Pensado para campaña/broadcast o
// siembra E2E staged. wa_number default = cuenta IA360 única.
router.post('/internal/ia360-revenue/opener', async (req, res) => {
  if (!isIa360InternalAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const b = req.body || {};
    const waNumber = normalizePhone(b.wa_number || process.env.IA360_WA_NUMBER || '5213321594582');
    const contactNumber = normalizePhone(b.contact_number || b.contact?.contact_number || '');
    const name = String(b.name || b.contact?.name || '').trim();
    if (!waNumber || !contactNumber) {
      return res.status(422).json({ ok: false, error: 'wa_number_and_contact_number_required' });
    }
    const result = await startRevenueOsOpener({ waNumber, contactNumber, name });
    return res.status(result.ok ? 200 : 502).json({ schema: 'ia360_revenue_opener.v1', ...result });
  } catch (err) {
    console.error('[revenue-os] opener endpoint error:', err.message);
    return res.status(500).json({ ok: false, error: 'opener_failed' });
  }
});

// G-WIN cartera — vista previa del flujo completo al WhatsApp del OWNER (nunca
// a un contacto): los mensajes de los 3 pasos con datos de ejemplo, en UN solo
// texto, para aprobación de copy. Egress único: sendIa360DirectText →
// messageSender. Auth = X-IA360-Directive-Secret (patrón de los endpoints
// internos). Idempotencia: el caller decide cuándo (una sola vez por sesión).
router.post('/internal/ia360-cartera/preview', async (req, res) => {
  if (!isIa360InternalAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const ejemploRows = [
      { cuenta: 'Transportes del Bajío', saldo_portal: '$1,250,000.00', saldo_correcto: '$980,000.00', fecha_corte: '31/05/2026', responsable: 'Laura' },
      { cuenta: 'Logística Occidente', saldo_portal: '$430,500.00', saldo_correcto: '$512,300.00', fecha_corte: '31/05/2026', responsable: 'Marco' },
    ];
    const mapaEjemplo = buildCarteraMapa(ejemploRows);
    const preview = [
      'IA360 · PREVIEW flujo "Mapa de cartera" (P7 Champions) — para tu aprobación. Nada de esto se envió a Andrés.',
      '',
      '── PASO 1 · El contacto reporta saldos que no cuadran. El bot responde: ──',
      '',
      IA360_CARTERA_COPY.paso1,
      '',
      '── Si manda foto o archivo en lugar de texto: ──',
      '',
      IA360_CARTERA_COPY.pideTexto,
      '',
      '── PASO 2 · El contacto pega la tabla. El bot responde (datos de ejemplo): ──',
      '',
      mapaEjemplo.texto,
      '',
      '── PASO 3 · Tú recibes este readout y el deal avanza a "Quick win entregado": ──',
      '',
      'IA360 · Quick win cartera — (contacto) (521***XX)',
      '',
      'El contacto entregó su tabla de cartera (2 cuentas) y le devolví el mapa estructurado.',
      `- Cuentas con descuadre: ${mapaEjemplo.cuentasConDescuadre} · Diferencia acumulada: ${carteraFormatoMonto(mapaEjemplo.diferenciaTotal)}`,
      '- Deal: «IA360 · (contacto) · Quick win cartera» → Quick win entregado (P7 Champions).',
      '- Mapa encolado a ia360_docs_sync (destino AlekContenido).',
    ].join('\n');
    const record = {
      wa_number: normalizePhone(req.body?.wa_number || process.env.IA360_WA_NUMBER || '5213321594582'),
      contact_number: IA360_OWNER_NUMBER,
      message_id: `cartera_preview:${Date.now()}`,
      message_type: 'cartera_preview',
      message_body: '',
    };
    const sent = await sendIa360DirectText({
      record,
      toNumber: IA360_OWNER_NUMBER,
      label: 'ia360_cartera_preview_owner',
      body: preview,
    });
    return res.status(sent ? 200 : 502).json({ ok: !!sent, schema: 'ia360_cartera_preview.v1', chars: preview.length });
  } catch (err) {
    console.error('[cartera] preview endpoint error:', err.message);
    return res.status(500).json({ ok: false, error: 'preview_failed' });
  }
});

// OPENERS V2 — vista previa de un opener al WhatsApp del OWNER (nunca a un
// contacto). Renderiza el draft v2 (primer nombre + quien_intro opcional) y el
// interactive (botones/lista) tal como lo vería el contacto. Único egress:
// sendOwnerInteractive / sendIa360DirectText -> messageSender. Auth =
// X-IA360-Directive-Secret (mismo patrón que los demás endpoints internos).
router.post('/internal/ia360-openers/preview', async (req, res) => {
  if (!isIa360InternalAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const b = req.body || {};
    const sequenceId = String(b.sequence_id || '').trim().toLowerCase();
    const found = findIa360SequenceFlow(sequenceId);
    if (!found) return res.status(422).json({ ok: false, error: 'unknown_sequence', sequence_id: sequenceId });
    const { sequence } = found;
    const sampleName = ia360FirstNameFrom(String(b.name || 'Alek').trim() || 'Alek');
    const quienIntro = String(b.quien_intro || '').trim() || null;
    const bodyText = typeof sequence.draft === 'function' ? sequence.draft({ name: sampleName, quienIntro }) : String(sequence.draft || '');
    const waNumber = normalizePhone(b.wa_number || process.env.IA360_WA_NUMBER || '5213321594582');
    const synthetic = {
      wa_number: waNumber,
      contact_number: IA360_OWNER_NUMBER,
      message_id: `opener-preview-${sequenceId}-${Date.now()}`,
      message_type: 'text',
      direction: 'incoming',
    };
    const interactive = buildIa360OpenerInteractive({ sequence, bodyText });
    let sent;
    if (interactive) {
      // ownerBudget=false: la preview es una petición explícita del owner; no debe
      // caer en el presupuesto anti-spam de notificaciones.
      sent = await sendOwnerInteractive({
        record: synthetic,
        label: `ia360_opener_preview_${sequenceId}`,
        messageBody: `IA360 preview opener ${sequenceId}`,
        interactive,
      });
    } else {
      sent = await sendIa360DirectText({
        record: synthetic,
        toNumber: IA360_OWNER_NUMBER,
        label: `ia360_opener_preview_${sequenceId}`,
        body: bodyText,
      });
    }
    return res.status(sent ? 200 : 502).json({
      ok: Boolean(sent),
      schema: 'ia360_opener_preview.v1',
      sequence_id: sequenceId,
      kind: interactive ? (interactive.type === 'list' ? 'list' : 'buttons') : 'text',
      body_preview: bodyText,
    });
  } catch (err) {
    console.error('[ia360-openers] preview endpoint error:', err.message);
    return res.status(500).json({ ok: false, error: 'preview_failed' });
  }
});

// BANDEJA DE IDEAS — captura desde el Brain v2 (intent idea_captura) u otros
// agentes. Inserta la idea y manda la tarjeta de ruteo al owner (único egress:
// sendOwnerInteractive -> messageSender). Auth = X-IA360-Directive-Secret.
router.post('/internal/ia360-ideas/capture', async (req, res) => {
  if (!isIa360InternalAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const b = req.body || {};
    const texto = String(b.texto || b.text || '').trim();
    if (!texto) return res.status(422).json({ ok: false, error: 'texto_required' });
    const fuente = ['conversacion', 'agente'].includes(b.fuente) ? b.fuente : 'conversacion';
    const contactNumber = normalizePhone(b.contact_number || '');
    const waNumber = normalizePhone(b.wa_number || process.env.IA360_WA_NUMBER || '5213321594582');
    const contexto = (b.contexto && typeof b.contexto === 'object') ? b.contexto : {};
    const ideaId = await insertIa360Idea({ fuente, contactNumber, texto, contexto });
    const synthetic = {
      wa_number: waNumber,
      contact_number: contactNumber || IA360_OWNER_NUMBER,
      message_id: `idea-capture-${ideaId}`,
      message_type: 'text',
      direction: 'incoming',
    };
    const cardSent = await sendIa360IdeaCard({ record: synthetic, ideaId, texto, fuente, contactNumber });
    return res.status(200).json({ ok: true, schema: 'ia360_idea_capture.v1', idea_id: ideaId, card_sent: Boolean(cardSent) });
  } catch (err) {
    console.error('[ia360-ideas] capture endpoint error:', err.message);
    return res.status(500).json({ ok: false, error: 'idea_capture_failed' });
  }
});

router.post('/internal/ia360-memory/capture', async (req, res) => {
  if (!isIa360InternalAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const b = req.body || {};
    const incoming = b.payload && typeof b.payload === 'object' ? b.payload : b;
    if (incoming.schema && incoming.schema !== 'ia360_memory_event.v1') {
      return res.status(422).json({ ok: false, error: 'unsupported_schema', expected: 'ia360_memory_event.v1' });
    }
    const record = {
      wa_number: normalizePhone(incoming.contact?.wa_number || b.wa_number || ''),
      contact_number: normalizePhone(incoming.contact?.wa_id || incoming.contact?.contact_number || b.contact_number || ''),
      contact_name: incoming.contact?.name || '',
      message_id: incoming.source_message_id || incoming.request_id || `ia360-memory-${Date.now()}`,
      message_body: '',
      message_type: 'memory_event',
    };
    if (!record.wa_number || !record.contact_number) {
      return res.status(422).json({ ok: false, error: 'wa_number_and_contact_number_required' });
    }
    const contact = await loadIa360ContactContext(record);
    const signal = {
      area: incoming.classification?.area || 'operacion_cliente',
      label: incoming.classification?.area || 'operación cliente',
      signalType: incoming.classification?.signal_type || 'senal_operativa',
      summary: incoming.learning?.summary || 'Señal operativa capturada por IA360.',
      businessImpact: incoming.learning?.business_impact || '',
      missingData: incoming.learning?.missing_data || '',
      nextAction: incoming.learning?.next_action || '',
      affectedProcess: incoming.learning?.affected_process || incoming.classification?.area || 'operación cliente',
      missingMetric: incoming.learning?.missing_metric || incoming.learning?.missing_data || '',
      confidence: Number(incoming.classification?.confidence || 0.65),
      shouldBeFact: Boolean(incoming.learning?.should_be_fact),
    };
    const persisted = await persistIa360MemorySignals({ record, contact, signals: [signal] });
    return res.json({
      ok: true,
      schema: 'ia360_memory_capture_result.v1',
      dry_run: false,
      ids: persisted.map(item => ({ event_id: item.eventId, fact_id: item.factId })),
      guardrails: {
        transcript_stored: false,
        external_send_allowed: false,
        crm_sync_status: 'dry_run_compact',
      },
    });
  } catch (err) {
    console.error('[ia360-memory] capture endpoint error:', err.message);
    return res.status(500).json({ ok: false, error: 'capture_failed' });
  }
});

router.post('/internal/n8n-directive', async (req, res) => {
  // 1) Auth por secreto compartido (timing-safe, reusa safeEqual del modulo)
  if (!isIa360InternalAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const d = req.body || {};
    const action = String(d.action || '');
    const espoId = d.espo_id || null;
    const payload = (d.payload && typeof d.payload === 'object') ? d.payload : {};
    const announce = (d.announce_handoff && typeof d.announce_handoff === 'object') ? d.announce_handoff : null;

    // 2) Validacion del contrato (Direccion B)
    if (!IA360_DIRECTIVE_ACTIONS.includes(action)) {
      return res.status(422).json({ ok: false, error: 'invalid_action', allowed: IA360_DIRECTIVE_ACTIONS });
    }
    if (action === 'free_reply' && !(payload.texto && String(payload.texto).trim())) {
      return res.status(422).json({ ok: false, error: 'free_reply_requires_payload_texto' });
    }
    if (action === 'send_template' && !payload.template_name) {
      return res.status(422).json({ ok: false, error: 'send_template_requires_template_name' });
    }
    if (action !== 'noop' && !espoId) {
      return res.status(422).json({ ok: false, error: 'espo_id_required' });
    }

    // 3) GATE EQUIPO-0: cero outbound. Dry-run = valida + ACK, no encola.
    if (!IA360_DIRECTIVE_EGRESS_ON) {
      return res.status(200).json({
        ok: true,
        dry_run: true,
        accepted: {
          action,
          espo_id: espoId,
          announce_handoff: announce ? (announce.label_publico || true) : null,
          requiere_confirmacion: payload.requiere_confirmacion !== false
        },
        egress: 'suppressed (EQUIPO-0; activar con IA360_DIRECTIVE_EGRESS=on en EQUIPO-1)'
      });
    }

    // 4) EQUIPO-1 (PARCIAL): cableado de egress real por sendQueue pendiente.
    return res.status(501).json({
      ok: false,
      error: 'egress_wiring_pending_equipo_1',
      detail: 'IA360_DIRECTIVE_EGRESS=on pero el envio real se cablea en EQUIPO-1'
    });
  } catch (err) {
    console.error('[n8n-directive] error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'directive_failed', detail: err && err.message });
  }
});


module.exports = { router };
