// template-probe.js — Sondeo real de envío de templates al número del owner.
//
// Para qué: enviar CADA template aprobada al WhatsApp del owner a través del
// path HTTP real de ForgeChat (corre el validador + sendQueue + Meta), y
// documentar la respuesta REAL de Meta por template (éxito o código de error,
// p.ej. 131042). Sirve para verificar si el bloqueo de billing afecta o no
// las operaciones actuales.
//
// DÓNDE se corre: en el VPS (donde el backend escucha en localhost:3011 y el
// token de Meta vive en el .env). NO funciona desde una máquina sin el backend.
//
// Uso (en el VPS, con las credenciales admin del backend en el entorno):
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... node template-probe.js
// Opcionales:
//   PROBE_TO=5213322638033        # número destino (default: owner)
//   PROBE_IDS=44,45,46            # solo estos IDs (default: todas las del API)
//   PROBE_ONLY_APPROVED=1         # solo status APPROVED (default: 1)
//   PROBE_DELAY_MS=1500           # pausa entre envíos (default: 1500)
//   PROBE_OUT=/ruta/salida.md     # archivo markdown de resultados
//
// El script NUNCA inventa: imprime y guarda tal cual lo que devuelve el backend/Meta.

const BASE = process.env.PROBE_BASE || 'http://localhost:3011/api';
const TO = process.env.PROBE_TO || '5213322638033'; // owner real (Alek)
const ONLY_APPROVED = process.env.PROBE_ONLY_APPROVED !== '0';
const DELAY_MS = Number(process.env.PROBE_DELAY_MS || 1500);
const ONLY_IDS = (process.env.PROBE_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean).map(Number);
const OUT = process.env.PROBE_OUT ||
  `template-probe-results-${new Date().toISOString().slice(0, 10)}.md`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function pickSampleValues(tpl) {
  // Cuenta los placeholders {{n}} en el cuerpo para mandar muestras válidas.
  const body = (tpl.components || tpl.body || []).map ?
    JSON.stringify(tpl.components || tpl.body) : JSON.stringify(tpl);
  const text = typeof tpl.bodyText === 'string' ? tpl.bodyText : body;
  const nums = new Set();
  const re = /\{\{\s*(\d+)\s*\}\}/g; let m;
  while ((m = re.exec(text)) !== null) nums.add(Number(m[1]));
  const sample = {};
  for (const n of nums) sample[String(n)] = n === 1 ? 'Alek' : `muestra${n}`;
  if (Object.keys(sample).length === 0) sample['1'] = 'Alek';
  return sample;
}

(async () => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('Falta ADMIN_EMAIL / ADMIN_PASSWORD en el entorno.');
    process.exit(1);
  }

  // 1) Login
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  console.log('LOGIN status=' + login.status);
  if (login.status !== 200) { console.log(await login.text()); process.exit(1); }

  // 2) Listar templates
  let templates = [];
  try {
    const tr = await fetch(`${BASE}/templates`, { headers: { cookie } });
    const data = await tr.json();
    templates = Array.isArray(data) ? data : (data.templates || data.items || data.data || []);
  } catch (e) {
    console.error('No pude listar /templates:', e.message);
  }
  if (!templates.length) {
    console.error('Sin templates desde el API. Usa PROBE_IDS=44,45,... para forzar IDs.');
    if (!ONLY_IDS.length) process.exit(1);
    templates = ONLY_IDS.map(id => ({ id, name: `(id ${id})`, status: 'UNKNOWN' }));
  }

  let pool = templates;
  if (ONLY_IDS.length) pool = pool.filter(t => ONLY_IDS.includes(Number(t.id)));
  if (ONLY_APPROVED) pool = pool.filter(t => !t.status || String(t.status).toUpperCase() === 'APPROVED');

  console.log(`Probando ${pool.length} templates hacia ${TO}\n`);

  const results = [];
  for (const tpl of pool) {
    const sampleValues = pickSampleValues(tpl);
    let status = 0, body = '';
    try {
      const ts = await fetch(`${BASE}/templates/${tpl.id}/test-send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ to: TO, sampleValues }),
      });
      status = ts.status;
      body = await ts.text();
    } catch (e) { body = 'FETCH_ERR ' + e.message; }

    // Intenta extraer código de error de Meta del body
    let metaCode = '';
    const cm = body.match(/"code"\s*:\s*(\d+)/) || body.match(/\b(13\d{4})\b/);
    if (cm) metaCode = cm[1];
    const ok = status === 200 && !/error|fail|131\d{3}|132\d{3}/i.test(body);

    const row = {
      id: tpl.id, name: tpl.name || '', cat: tpl.category || '',
      meta: tpl.metaTemplateName || '', http: status,
      verdict: ok ? 'OK' : 'ERROR', metaCode,
      bodySnippet: body.slice(0, 240).replace(/\n/g, ' '),
    };
    results.push(row);
    console.log(`#${row.id} ${row.name} -> HTTP ${row.http} ${row.verdict}${metaCode ? ' meta=' + metaCode : ''}`);
    await sleep(DELAY_MS);
  }

  // 3) Escribir markdown
  const okN = results.filter(r => r.verdict === 'OK').length;
  const errN = results.length - okN;
  const lines = [];
  lines.push(`# Sondeo de templates -> ${TO} (${new Date().toISOString()})`);
  lines.push('');
  lines.push(`Total: ${results.length} · OK: ${okN} · ERROR: ${errN}`);
  lines.push('');
  lines.push('| ID | Nombre | Cat | metaTemplateName | HTTP | Veredicto | Meta code | Respuesta (recorte) |');
  lines.push('|----|--------|-----|------------------|------|-----------|-----------|---------------------|');
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.name} | ${r.cat} | ${r.meta} | ${r.http} | ${r.verdict} | ${r.metaCode} | ${r.bodySnippet.replace(/\|/g, '/')} |`);
  }
  require('fs').writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`\nResultados: OK=${okN} ERROR=${errN}`);
  console.log('Markdown:', OUT);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
