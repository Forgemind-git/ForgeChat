// IA360 meeting-reminder scheduler. Self-contained: does NOT touch webhook.js.
// Sends up to 4 Meta-template reminders per future meeting in
// coexistence.ia360_meeting_links, via the same messageSender + sendQueue path
// every other outbound uses.
//
//   #1 reminder_1d        -> ia360_os_meeting_reminder_1d  (morning of the day BEFORE, >=09:00 local)
//   #2 reminder_sameday_am-> ia360_os_meeting_reminder     (morning of the SAME day, >=08:00 local)
//   #3 reminder_1h        -> ia360_os_meeting_reminder     (~1h before start)
//   #4 reminder_starting  -> ia360_os_meeting_starting     (T-0, short window around start)
//
// Idempotency: one timestamptz column per offset on ia360_meeting_links. Each
// reminder is claimed with an atomic `UPDATE ... WHERE col IS NULL RETURNING`
// BEFORE enqueue, so at-most-once per (meeting, offset) even with overlapping
// sweeps or multiple processes.

const pool = require('../db');
const { resolveAccount, insertPendingRow } = require('./messageSender');
const { enqueueSend } = require('../queue/sendQueue');

const IA360_WA_NUMBER = process.env.IA360_WA_NUMBER || '5213321594582';
const TZ = 'America/Mexico_City';
const TEMA_FALLBACK = 'los puntos que platicamos y tu siguiente paso con IA360';

// offset.key drives the window logic; col is the idempotency column.
const OFFSETS = [
  { key: '1d',         col: 'reminder_1d_sent_at',         template: 'ia360_os_meeting_reminder_1d', urlButton: true  },
  { key: 'sameday_am', col: 'reminder_sameday_am_sent_at', template: 'ia360_os_meeting_reminder',    urlButton: false },
  { key: '1h',         col: 'reminder_1h_sent_at',         template: 'ia360_os_meeting_reminder',    urlButton: false },
  { key: 'starting',   col: 'reminder_starting_sent_at',   template: 'ia360_os_meeting_starting',    urlButton: true  },
];

let lastTemplateSync = 0;

// ---------------------------------------------------------------------------
// America/Mexico_City helpers (Mexico no longer observes DST, but we resolve
// the zone offset dynamically rather than hardcoding -6h).
// ---------------------------------------------------------------------------
function mxParts(date) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(
    dtf.formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value])
  );
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: (+p.hour) % 24, minute: +p.minute, second: +p.second,
  };
}

function pad(n) { return String(n).padStart(2, '0'); }
function mxDateStr(date) { const p = mxParts(date); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; }

// The day-before calendar date of a meeting, in local terms.
function mxDayBeforeStr(date) {
  const p = mxParts(date);
  const t = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() - 1);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// "10:00 a.m."  (normalize es-MX "a. m." -> "a.m.")
function fmtTimeMx(date) {
  const s = new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date);
  return s.replace(/ | /g, ' ').replace(/[   ]/g, ' ').replace('a. m.', 'a.m.').replace('p. m.', 'p.m.').trim();
}

// "mié 10 jun 2026, 10:00 a.m."
function fmtLongMx(date) {
  const p = mxParts(date);
  const wd = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'short' }).format(date).replace('.', '');
  const mon = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, month: 'short' }).format(date).replace('.', '');
  return `${wd} ${p.day} ${mon} ${p.year}, ${fmtTimeMx(date)}`;
}

// ---------------------------------------------------------------------------
// Window logic: is `offset.key` due NOW for a meeting starting at `start`?
// ---------------------------------------------------------------------------
function isDue(key, start, now) {
  const np = mxParts(now);
  const nowDate = mxDateStr(now);
  switch (key) {
    case '1d':
      // morning of the day BEFORE the meeting, from 09:00 local
      return nowDate === mxDayBeforeStr(start) && np.hour >= 9 && now < start;
    case 'sameday_am':
      // morning of the SAME day, from 08:00 local, still before the meeting
      return nowDate === mxDateStr(start) && np.hour >= 8 && now < start;
    case '1h':
      return now >= new Date(start.getTime() - 60 * 60 * 1000) && now < start;
    case 'starting':
      // short window straddling T-0; >= sweep interval so we never skip it
      return now >= new Date(start.getTime() - 3 * 60 * 1000) &&
             now <= new Date(start.getTime() + 10 * 60 * 1000);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// tema for {{2}} of ia360_os_meeting_reminder. Prefer a clean contact custom
// field; never inject the raw pipeline name. Fall back to a generic phrase.
// ---------------------------------------------------------------------------
async function deriveTema(contactNumber) {
  const n = String(contactNumber || '').replace(/\D/g, '');
  if (!n) return TEMA_FALLBACK;
  try {
    const { rows } = await pool.query(
      `SELECT custom_fields->>'tema' AS tema, custom_fields->>'pipeline' AS pipeline
         FROM coexistence.contacts
        WHERE contact_number = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [n]
    );
    const cand = (rows[0]?.tema || rows[0]?.pipeline || '').trim();
    if (cand && cand.length > 2) return cand;
  } catch (err) {
    console.error('[ia360-reminders] deriveTema error:', err.message);
  }
  return TEMA_FALLBACK;
}

function bodyComp(texts) {
  return { type: 'body', parameters: texts.map(t => ({ type: 'text', text: String(t) })) };
}
// URL button with a dynamic {{1}} = token suffix. Index 0 in both templates.
function urlBtnComp(token) {
  return { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(token) }] };
}

async function lookupApprovedTemplate(name) {
  const { rows } = await pool.query(
    `SELECT id, name, language, body, status
       FROM coexistence.message_templates
      WHERE name = $1
      ORDER BY (status = 'APPROVED') DESC, updated_at DESC
      LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}

async function maybeKickTemplateSync() {
  // ia360_os_meeting_starting may still be PENDING in Meta on a fresh env.
  // Nudge the poller, throttled to once / 10 min. Best-effort.
  if (Date.now() - lastTemplateSync < 10 * 60 * 1000) return;
  lastTemplateSync = Date.now();
  try {
    const { syncAllAccountTemplates } = require('../routes/templates');
    await syncAllAccountTemplates();
  } catch (err) {
    console.error('[ia360-reminders] template sync nudge failed:', err.message);
  }
}

// Claim + send a single reminder. Returns a small status object.
async function fireReminder(account, m, off) {
  const tpl = await lookupApprovedTemplate(off.template);
  if (!tpl || tpl.status !== 'APPROVED') {
    console.warn(`[ia360-reminders] template ${off.template} not APPROVED (status=${tpl?.status || 'missing'}) — degrade, skip offset=${off.key} token=${m.token}`);
    if (off.key === 'starting') maybeKickTemplateSync();
    return { offset: off.key, skipped: 'template_not_approved' };
  }

  // Atomic at-most-once claim BEFORE enqueue.
  const claim = await pool.query(
    `UPDATE coexistence.ia360_meeting_links
        SET ${off.col} = NOW()
      WHERE token = $1 AND ${off.col} IS NULL
      RETURNING token`,
    [m.token]
  );
  if (claim.rowCount === 0) return { offset: off.key, skipped: 'lost_claim' };

  try {
    const start = new Date(m.start_utc);
    let components, body;
    if (off.key === '1d') {
      const d = fmtLongMx(start);
      components = [bodyComp([d]), urlBtnComp(m.token)];
      body = `Recordatorio (mañana): ${d}`;
    } else if (off.key === 'starting') {
      const t = fmtTimeMx(start);
      components = [bodyComp([t]), urlBtnComp(m.token)];
      body = `Tu reunión empieza ahora (${t}).`;
    } else {
      const t = fmtTimeMx(start);
      const tema = await deriveTema(m.contact_number);
      components = [bodyComp([t, tema])];
      body = `Recordatorio: reunión hoy a las ${t}. Objetivo: revisar ${tema}.`;
    }

    const handlerFor = `reminder:${m.token}:${off.key}`;
    const localId = await insertPendingRow({
      account,
      toNumber: m.contact_number,
      messageType: 'template',
      messageBody: tpl.body || body,
      templateMeta: {
        ux: 'ia360_reminder',
        offset: off.key,
        token: m.token,
        ia360_handler_for: handlerFor,
        source: 'ia360Reminders',
        template_name: tpl.name,
        template_id: tpl.id,
      },
    });

    await enqueueSend({
      kind: 'template',
      accountId: account.id,
      to: m.contact_number,
      localMessageId: localId,
      payload: { name: tpl.name, languageCode: tpl.language || 'es_MX', components },
    });

    console.log(`[ia360-reminders] enqueued offset=${off.key} token=${m.token} to=${m.contact_number} tpl=${tpl.name} local=${localId}`);
    return { offset: off.key, sent: true, localId, handlerFor };
  } catch (err) {
    // Claim already taken -> at-most-once preserved (no retry). Log loudly.
    console.error(`[ia360-reminders] enqueue failed offset=${off.key} token=${m.token}: ${err.message}`);
    return { offset: off.key, error: err.message };
  }
}

// One sweep over future meetings with at least one un-sent offset.
async function runReminderSweep() {
  const { account, error } = await resolveAccount({ fromPhoneNumber: IA360_WA_NUMBER });
  if (error || !account) {
    console.error('[ia360-reminders] account resolve failed:', error || 'no account');
    return { ok: false, error: error || 'no account' };
  }

  const { rows } = await pool.query(
    `SELECT token, contact_number, start_utc, summary, zoom_join_url, kind,
            reminder_1d_sent_at, reminder_sameday_am_sent_at,
            reminder_1h_sent_at, reminder_starting_sent_at
       FROM coexistence.ia360_meeting_links
      WHERE start_utc IS NOT NULL
        AND start_utc > NOW() - INTERVAL '15 minutes'
        AND (reminder_1d_sent_at IS NULL
             OR reminder_sameday_am_sent_at IS NULL
             OR reminder_1h_sent_at IS NULL
             OR reminder_starting_sent_at IS NULL)`
  );

  const now = new Date();
  const results = [];
  for (const m of rows) {
    const start = new Date(m.start_utc);
    for (const off of OFFSETS) {
      if (m[off.col]) continue;              // already sent
      if (!isDue(off.key, start, now)) continue;
      results.push(await fireReminder(account, m, off));
    }
  }
  const sent = results.filter(r => r.sent).length;
  if (sent > 0) console.log(`[ia360-reminders] sweep: ${rows.length} candidate meeting(s), ${sent} reminder(s) enqueued`);
  return { ok: true, candidates: rows.length, results };
}

async function ensureReminderColumns() {
  await pool.query(
    `ALTER TABLE coexistence.ia360_meeting_links
       ADD COLUMN IF NOT EXISTS reminder_1d_sent_at         timestamptz,
       ADD COLUMN IF NOT EXISTS reminder_sameday_am_sent_at timestamptz,
       ADD COLUMN IF NOT EXISTS reminder_1h_sent_at         timestamptz,
       ADD COLUMN IF NOT EXISTS reminder_starting_sent_at   timestamptz`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_ia360_meeting_links_reminders
        ON coexistence.ia360_meeting_links (start_utc)
      WHERE reminder_1d_sent_at IS NULL
         OR reminder_sameday_am_sent_at IS NULL
         OR reminder_1h_sent_at IS NULL
         OR reminder_starting_sent_at IS NULL`
  );
}

function startReminderScheduler() {
  const MS = parseInt(process.env.IA360_REMINDER_INTERVAL_MS || '', 10) || 5 * 60 * 1000;
  ensureReminderColumns().catch(e => console.error('[ia360-reminders] ensure columns failed:', e.message));

  let running = false;
  const tick = async () => {
    if (running) return; // in-process overlap guard (claim handles cross-process)
    running = true;
    try { await runReminderSweep(); }
    catch (e) { console.error('[ia360-reminders] sweep error:', e.message); }
    finally { running = false; }
  };

  setTimeout(tick, 45 * 1000).unref();        // catch-up shortly after startup
  setInterval(tick, MS).unref();              // steady-state every ~5 min
  console.log(`[ia360-reminders] scheduler started, interval=${MS}ms, wa=${IA360_WA_NUMBER}`);
}

module.exports = {
  startReminderScheduler,
  runReminderSweep,
  ensureReminderColumns,
  // exported for tests / introspection
  isDue, fmtTimeMx, fmtLongMx, mxDateStr, mxDayBeforeStr, deriveTema,
};
