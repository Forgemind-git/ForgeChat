'use strict';

// ============================================================================
// IA360 — Endpoints públicos de calendario (add-to-calendar + redirect).
// Sin authMiddleware (el contacto los abre desde su teléfono). Token
// impredecible por cita (nunca eventId crudo). Solo lectura de
// coexistence.ia360_meeting_links. NUNCA envía mensajes.
// Montado en index.js zona PÚBLICA con app.use('/api', router):
//   https://wa.geekstudio.dev/api/r/:token  (redirect estable, base de botones)
//   https://wa.geekstudio.dev/api/cal/:token(.ics)
// ============================================================================

const { Router } = require('express');
const pool = require('../db');

const router = Router();

function icsStamp(d) {
  // -> YYYYMMDDTHHMMSSZ (UTC)
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n');
}

async function loadLink(token) {
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const { rows } = await pool.query(
    'SELECT * FROM coexistence.ia360_meeting_links WHERE token = $1', [token]);
  const link = rows[0];
  if (!link) return null;
  if (link.expires_at && new Date(link.expires_at) < new Date()) return { expired: true };
  return link;
}

// /api/r/:token -> 302 estable (base de los botones URL de los templates).
router.get('/r/:token', async (req, res) => {
  try {
    const link = await loadLink(req.params.token);
    if (!link) return res.status(404).type('text/plain').send('Enlace no encontrado.');
    if (link.expired) return res.status(410).type('text/plain').send('Este enlace ya expiro.');
    if (link.kind === 'zoom' && link.zoom_join_url) return res.redirect(302, link.zoom_join_url);
    return res.redirect(302, '/api/cal/' + encodeURIComponent(req.params.token));
  } catch (e) { console.error('[ia360-cal] /r error:', e.message); res.status(500).type('text/plain').send('Error.'); }
});

// /api/cal/:token.ics -> archivo ICS (definir ANTES de /cal/:token).
router.get('/cal/:token.ics', async (req, res) => {
  try {
    const link = await loadLink(req.params.token);
    if (!link || link.expired) return res.status(404).type('text/plain').send('No disponible.');
    const uid = (link.event_id || link.token) + '@geekstudio.dev';
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TransformIA//IA360//ES',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + icsStamp(new Date()),
      'DTSTART:' + icsStamp(link.start_utc),
      'DTEND:' + icsStamp(link.end_utc),
      'SUMMARY:' + esc(link.summary || 'Reunion con Alek (TransformIA)'),
      'DESCRIPTION:' + esc(link.zoom_join_url ? ('Acceso Zoom: ' + link.zoom_join_url) : ''),
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="reunion-ia360.ics"');
    res.send(ics);
  } catch (e) { console.error('[ia360-cal] ics error:', e.message); res.status(500).type('text/plain').send('Error.'); }
});

// /api/cal/:token -> pagina con Google Calendar + descargar .ics.
router.get('/cal/:token', async (req, res) => {
  try {
    const link = await loadLink(req.params.token);
    if (!link) return res.status(404).type('text/plain').send('Enlace no encontrado.');
    if (link.expired) return res.status(410).type('text/plain').send('Este enlace ya expiro.');
    const title = link.summary || 'Reunion con Alek (TransformIA)';
    const details = link.zoom_join_url ? ('Acceso Zoom: ' + link.zoom_join_url) : '';
    const gcal = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
      + '&text=' + encodeURIComponent(title)
      + '&dates=' + icsStamp(link.start_utc) + '/' + icsStamp(link.end_utc)
      + '&details=' + encodeURIComponent(details);
    const icsUrl = '/api/cal/' + encodeURIComponent(req.params.token) + '.ics';
    res.type('text/html').send('<!doctype html><html lang="es"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Agregar a mi calendario</title><style>'
      + 'body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;text-align:center}'
      + 'a.btn{display:block;margin:12px 0;padding:14px;border-radius:10px;text-decoration:none;font-weight:600}'
      + '.g{background:#1a73e8;color:#fff}.i{background:#f1f3f4;color:#202124;border:1px solid #dadce0}'
      + 'h1{font-size:18px}</style></head><body><h1>Agregar reunion a tu calendario</h1>'
      + '<a class="btn g" href="' + gcal + '">Agregar a Google Calendar</a>'
      + '<a class="btn i" href="' + icsUrl + '">Descargar (Apple / Outlook / .ics)</a>'
      + '</body></html>');
  } catch (e) { console.error('[ia360-cal] /cal error:', e.message); res.status(500).type('text/plain').send('Error.'); }
});

module.exports = { router };
