#!/usr/bin/env node
'use strict';
// ============================================================================
// G-RAG vault-bridge — puente HOST entre AlekContenido (Obsidian) y la DB de
// ForgeChat (2026-06-11). El contenedor backend NO monta el vault: este script
// corre en el host y habla con Postgres vía `docker exec forgecrm-db psql`.
// Node 20, CERO dependencias npm.
//
// Modos:
//   --scan   indexa notas de stakeholders/CRM a ia360_vault_notes + auto-match
//            por teléfono (jamás por nombre) a ia360_vault_links.
//   --drain  drena coexistence.ia360_docs_sync hacia el vault (round-trip):
//            append a la nota VINCULADA del contacto o nota nueva en
//            Areas/CRM/contactos/.
//   (sin flag = ambos)
// ============================================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const VAULT = '/home/alek/vault-git-backup';
const BOT_NUMBER = '5213321594582';
const OWNER_NUMBER = '5213322638033';
const DOCKER = ['exec', '-i', 'forgecrm-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
const CRM_CONTACTOS_DIR = 'Areas/CRM/contactos';
const CRM_TEMPLATE = 'Areas/CRM/_templates/template-contacto.md';

// ─── Acceso a Postgres (docker exec, sin driver) ────────────────────────────

function psqlRun(sql) {
  const res = spawnSync('docker', DOCKER, { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`psql falló (status ${res.status}): ${String(res.stderr || '').trim().slice(0, 600)}`);
  }
  return String(res.stdout || '');
}

function psqlValue(sql) {
  const res = spawnSync('docker', [...DOCKER, '-tAc', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`psql falló (status ${res.status}): ${String(res.stderr || '').trim().slice(0, 600)}`);
  }
  return String(res.stdout || '').trim();
}

function queryJson(selectSql) {
  const out = psqlValue(`SELECT COALESCE(json_agg(row_to_json(t)),'[]') FROM (${selectSql}) t`);
  return JSON.parse(out || '[]');
}

// Dollar-quoting con tag único: el contenido de las notas es arbitrario; si el
// contenido contiene el tag, se regenera hasta que no colisione.
function dq(value) {
  if (value == null) return 'NULL';
  const s = String(value);
  let tag = 'VB7f3a';
  // El guard usa el tag SIN cierre: cubre contenido que TERMINA en el tag
  // parcial (concatenado con el cierre rompería el literal y abortaría el lote).
  while (s.includes(`$${tag}`)) tag = `VB${Math.random().toString(36).slice(2, 8)}`;
  return `$${tag}$${s}$${tag}$`;
}

// ─── Normalizaciones (espejo EXACTO de las del backend, webhook.js G-RAG) ───

function normalizeVaultPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `521${d}`;
  if (d.length === 12 && d.startsWith('52')) return `521${d.slice(2)}`;
  if (d.length === 13 && d.startsWith('521')) return d;
  return null;
}

function blocklisted(num) {
  const n = String(num || '');
  return n === BOT_NUMBER || n === OWNER_NUMBER || /^521999/.test(n);
}

// Misma normalización que ia360NormalizeNameForMatch del backend: minúsculas,
// sin acentos (NFD), letras repetidas colapsadas, espacios colapsados.
function normalizeNameForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(.)\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanWikilinks(s) {
  return String(s || '').replace(/\[\[([^\]]+)\]\]/g, '$1').trim();
}

// ─── DDL (idéntico a la migración; idempotente) ─────────────────────────────

function ensureTables() {
  psqlRun(`
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
);
CREATE INDEX IF NOT EXISTS ia360_vault_notes_tel_idx
  ON coexistence.ia360_vault_notes (telefono_wa) WHERE telefono_wa IS NOT NULL;
CREATE INDEX IF NOT EXISTS ia360_vault_notes_nombre_idx
  ON coexistence.ia360_vault_notes (nombre_normalizado);
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
);
CREATE UNIQUE INDEX IF NOT EXISTS ia360_vault_links_note_vinculado_uidx
  ON coexistence.ia360_vault_links (note_path) WHERE estado = 'vinculado';
CREATE INDEX IF NOT EXISTS ia360_vault_links_contact_idx
  ON coexistence.ia360_vault_links (contact_number, estado);
`);
}

// ─── SCAN: filesystem → ia360_vault_notes ───────────────────────────────────

const EXCLUDE_RE = /(_bmad-output|_snapshots|_templates|_views|node_modules|\.obsidian|\.git)/;

function walkMarkdown(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (EXCLUDE_RE.test(full)) continue;
    if (e.isDirectory()) walkMarkdown(full, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function relVaultPath(abs) {
  return path.relative(VAULT, abs).split(path.sep).join('/');
}

// Solo stakeholders de proyectos y todo Areas/CRM (las exclusiones ya
// filtraron _templates, _views, etc.).
function isScanTarget(rel) {
  return /^Areas\/Proyectos\/.+\/stakeholders\/[^/]+\.md$/.test(rel)
    || /^Areas\/CRM\/.+\.md$/.test(rel);
}

// Frontmatter YAML plano entre los dos primeros '---': solo pares clave:valor
// de una línea; quita comillas envolventes y [[wikilinks]]; las listas y
// colecciones quedan como string crudo.
function parseFrontmatter(raw) {
  const m = String(raw || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: String(raw || '') };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-zÀ-ÿ][\wÀ-ÿ -]*?)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2)
      || (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
      val = val.slice(1, -1);
    }
    fm[key] = cleanWikilinks(val);
  }
  return { frontmatter: fm, body: m[2] || '' };
}

// project_name desde el path: 0Prospectos/<X> y Detenidos/<X> son carpetas
// agrupadoras (el proyecto es <X>); Areas/CRM → NULL (fact general de persona).
function deriveProjectName(rel) {
  let m = rel.match(/^Areas\/Proyectos\/0Prospectos\/([^/]+)\//);
  if (m) return m[1];
  m = rel.match(/^Areas\/Proyectos\/Detenidos\/([^/]+)\//);
  if (m) return m[1];
  m = rel.match(/^Areas\/Proyectos\/([^/]+)\//);
  if (m) return m[1];
  return null;
}

function pickKey(fm, ...keys) {
  for (const k of keys) {
    if (fm[k] != null && String(fm[k]).trim() !== '') return String(fm[k]).trim();
  }
  return null;
}

function buildNoteRow(abs) {
  const rel = relVaultPath(abs);
  const raw = fs.readFileSync(abs, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const stat = fs.statSync(abs);
  let telefono = normalizeVaultPhone(frontmatter.telefono_wa);
  // Jamás auto-match con bot/owner/QA: un teléfono en blocklist se guarda NULL.
  if (telefono && blocklisted(telefono)) telefono = null;
  const nombre = pickKey(frontmatter, 'nombre', 'nombre_completo')
    || path.basename(abs, '.md').replace(/-/g, ' ');
  return {
    note_path: rel,
    nombre,
    nombre_normalizado: normalizeNameForMatch(nombre),
    telefono_wa: telefono,
    project_name: deriveProjectName(rel),
    rol: pickKey(frontmatter, 'rol', 'cargo', 'rol_principal', 'rol_en_meta'),
    empresa: cleanWikilinks(pickKey(frontmatter, 'empresa', 'organizacion', 'organización') || '') || null,
    frontmatter,
    contenido: body,
    file_mtime: stat.mtime.toISOString(),
  };
}

function upsertNotes(rows) {
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const values = rows.slice(i, i + BATCH).map(n => `(${[
      dq(n.note_path),
      dq(n.nombre),
      dq(n.nombre_normalizado),
      dq(n.telefono_wa),
      dq(n.project_name),
      dq(n.rol),
      dq(n.empresa),
      `${dq(JSON.stringify(n.frontmatter))}::jsonb`,
      dq(n.contenido),
      `${dq(n.file_mtime)}::timestamptz`,
    ].join(', ')})`).join(',\n');
    psqlRun(`
INSERT INTO coexistence.ia360_vault_notes
  (note_path, nombre, nombre_normalizado, telefono_wa, project_name, rol, empresa, frontmatter, contenido, file_mtime)
VALUES
${values}
ON CONFLICT (note_path) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  nombre_normalizado = EXCLUDED.nombre_normalizado,
  telefono_wa = EXCLUDED.telefono_wa,
  project_name = EXCLUDED.project_name,
  rol = EXCLUDED.rol,
  empresa = EXCLUDED.empresa,
  frontmatter = EXCLUDED.frontmatter,
  contenido = EXCLUDED.contenido,
  file_mtime = EXCLUDED.file_mtime,
  indexed_at = NOW(),
  missing_since = NULL;
`);
  }
}

function markMissing(seenPaths) {
  if (!seenPaths.length) return;
  const inList = seenPaths.map(p => dq(p)).join(', ');
  psqlRun(`
UPDATE coexistence.ia360_vault_notes
   SET missing_since = NOW()
 WHERE missing_since IS NULL
   AND note_path NOT IN (${inList});
`);
}

// AUTO-MATCH global por teléfono: mismo statement que el del backend
// (ensureIa360VaultAutoLinks) pero sin filtro de contacto. El guard
// COUNT(DISTINCT)=1 evita que un teléfono apunte a 2 contactos; el NOT EXISTS
// respeta vínculos vivos y rechazos sellados; la blocklist queda en SQL.
function autoMatchAll() {
  const out = psqlValue(`
INSERT INTO coexistence.ia360_vault_links
  (forgechat_contact_id, contact_number, note_path, project_name, estado, matched_by, confirmado_at)
SELECT c.id, c.contact_number, n.note_path, n.project_name, 'vinculado', 'telefono', NOW()
  FROM coexistence.ia360_vault_notes n
  JOIN coexistence.contacts c ON c.contact_number = n.telefono_wa
 WHERE n.missing_since IS NULL
   AND n.telefono_wa IS NOT NULL
   AND c.contact_number NOT LIKE '521999%'
   AND c.contact_number NOT IN ('${BOT_NUMBER}', '${OWNER_NUMBER}')
   AND (SELECT COUNT(DISTINCT c2.id) FROM coexistence.contacts c2 WHERE c2.contact_number = n.telefono_wa) = 1
   AND NOT EXISTS (SELECT 1 FROM coexistence.ia360_vault_links l
                    WHERE l.note_path = n.note_path
                      AND (l.estado = 'vinculado' OR l.forgechat_contact_id = c.id))
ON CONFLICT (forgechat_contact_id, note_path) DO NOTHING
RETURNING note_path`);
  // psql -tAc imprime las filas del RETURNING Y la etiqueta "INSERT 0 N":
  // se descarta la etiqueta para no inflar el conteo.
  return out ? out.split('\n').filter(l => l && !/^INSERT \d+ \d+$/.test(l)).length : 0;
}

function runScan() {
  const candidates = [
    ...walkMarkdown(path.join(VAULT, 'Areas', 'Proyectos'), []),
    ...walkMarkdown(path.join(VAULT, 'Areas', 'CRM'), []),
  ];
  const rows = [];
  for (const abs of candidates) {
    const rel = relVaultPath(abs);
    if (!isScanTarget(rel)) continue;
    try {
      rows.push(buildNoteRow(abs));
    } catch (err) {
      console.error(`[vault-bridge] nota ilegible ${rel}: ${err.message}`);
    }
  }
  upsertNotes(rows);
  markMissing(rows.map(n => n.note_path));
  const newLinks = autoMatchAll();
  console.log(`[vault-bridge] scan: ${rows.length} notas indexadas, ${newLinks} auto-links nuevos`);
}

// ─── DRAIN: ia360_docs_sync → vault (round-trip) ────────────────────────────

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

function syncSection(row) {
  const fecha = new Date().toISOString().slice(0, 10);
  return `\n\n## Sync IA360 — ${row.titulo || 'sin título'} (${fecha})\n\n${row.contenido || ''}\n\n<!-- ia360_docs_sync id=${row.id} -->\n`;
}

// Nota nueva en Areas/CRM/contactos/ desde el template de contacto; los
// placeholders que no podemos llenar quedan vacíos (no inventar datos).
function createNoteFromTemplate(absPath, displayName, contactNumber) {
  let content = '';
  const templatePath = path.join(VAULT, CRM_TEMPLATE);
  if (fs.existsSync(templatePath)) {
    content = fs.readFileSync(templatePath, 'utf8')
      .replace(/\{\{nombre_completo\}\}/g, displayName)
      .replace(/\{\{nombre completo\}\}/g, displayName)
      .replace(/\{\{\+52 33 XXXX XXXX\}\}/g, contactNumber || '')
      .replace(/\{\{[^}]*\}\}/g, '');
  } else {
    // Sin template (vault parcial): encabezado mínimo, el append agrega lo demás.
    content = `# ${displayName}\n`;
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
}

function drainRow(row) {
  const num = row.contact_number
    ? (normalizeVaultPhone(row.contact_number) || String(row.contact_number).replace(/\D/g, ''))
    : null;
  let relPath = null;
  let modo = 'nueva';
  if (num) {
    // POR VÍNCULO, JAMÁS por nombre: solo la nota vinculada más reciente.
    const links = queryJson(
      `SELECT note_path FROM coexistence.ia360_vault_links
        WHERE contact_number = ${dq(num)} AND estado = 'vinculado'
        ORDER BY confirmado_at DESC NULLS LAST LIMIT 1`
    );
    if (links.length) {
      relPath = links[0].note_path;
      modo = 'vinculada';
    }
  }
  if (!relPath) {
    const base = slugify(row.titulo) || (num ? `contacto-${num}` : `doc-${row.id}`);
    relPath = `${CRM_CONTACTOS_DIR}/${base}.md`;
  }
  // note_path viene de la DB: contención dura, jamás escribir fuera del vault.
  const absPath = path.resolve(VAULT, relPath);
  if (absPath !== VAULT && !absPath.startsWith(VAULT + path.sep)) {
    throw new Error(`note_path fuera del vault: ${relPath}`);
  }
  const marker = `<!-- ia360_docs_sync id=${row.id} -->`;
  const exists = fs.existsSync(absPath);
  if (exists && fs.readFileSync(absPath, 'utf8').includes(marker)) {
    // Idempotencia: la sección ya está escrita; solo se marca synced.
  } else {
    if (!exists && modo === 'nueva') {
      createNoteFromTemplate(absPath, row.titulo || (num ? `Contacto ${num}` : `Documento ${row.id}`), num);
    } else if (!exists) {
      // Nota vinculada sin archivo en disco: el append la recrea en su path.
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
    }
    fs.appendFileSync(absPath, syncSection(row), 'utf8');
  }
  psqlRun(`UPDATE coexistence.ia360_docs_sync SET status='synced', synced_at=NOW() WHERE id=${Number(row.id)};`);
  console.log(`[vault-bridge] drain: fila ${row.id} → ${relPath} (${modo})`);
}

function runDrain() {
  const rows = queryJson(
    `SELECT s.id, s.titulo, s.contenido, i.contact_number
       FROM coexistence.ia360_docs_sync s
       LEFT JOIN coexistence.ia360_ideas i ON i.id = s.idea_id
      WHERE s.status = 'queued'
      ORDER BY s.id`
  );
  for (const row of rows) {
    try {
      drainRow(row);
    } catch (err) {
      console.error(`[vault-bridge] drain: fila ${row.id} ERROR: ${err.message}`);
      try {
        psqlRun(`UPDATE coexistence.ia360_docs_sync SET status='error' WHERE id=${Number(row.id)};`);
      } catch (updErr) {
        console.error(`[vault-bridge] drain: no pude marcar error la fila ${row.id}: ${updErr.message}`);
      }
    }
  }
  if (!rows.length) console.log('[vault-bridge] drain: sin filas queued');
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const doScan = args.includes('--scan') || args.length === 0;
  const doDrain = args.includes('--drain') || args.length === 0;
  if (!doScan && !doDrain) {
    console.error('[vault-bridge] uso: vault-bridge.js [--scan] [--drain]');
    process.exit(2);
  }
  ensureTables();
  if (doScan) runScan();
  if (doDrain) runDrain();
}

main();
