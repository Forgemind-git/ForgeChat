// Google Sheets service wrapper.
//
// Every call resolves a fresh access token via googleAuth.getAccessToken(),
// which silently refreshes the cached token if it's about to expire. Tools
// hand us a credentialId; we never see plain tokens.
//
// Three operations are exposed as agent tools: `read`, `append`, `update`.
// Plus picker helpers (`listSpreadsheets`, `listSheetTabs`) used by the UI
// when the operator is configuring which sheet an agent should touch.

const { google } = require('googleapis');
const { getAccessToken } = require('./googleAuth');

// ── helpers for the `upsert` op ────────────────────────────────────────────
function colLetter(idx) {
  let s = ''; let n = Number(idx);
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
function normCell(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
function digitsOnly(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
// Match a cell against a key — exact (case-insensitive) OR digits-only (so
// "+91 94877 22330" matches "919487722330" for phone-number keys).
function keyMatch(cell, key) {
  if (normCell(cell) !== '' && normCell(cell) === normCell(key)) return true;
  const dc = digitsOnly(cell); const dk = digitsOnly(key);
  return dc !== '' && dc === dk;
}
// Parse the start row/col index from a returned A1 range like
// "'Enquiry tracker'!A1:G23" → { row: 1, col: 0 } (1-based row, 0-based col).
function parseStart(rangeA1) {
  const m = String(rangeA1 || '').match(/!\$?([A-Z]+)\$?(\d+)/);
  if (!m) return { row: 1, col: 0 };
  let col = 0; for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: parseInt(m[2], 10), col: col - 1 };
}

async function authedSheets(credentialId) {
  const token = await getAccessToken(credentialId);
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: token });
  return google.sheets({ version: 'v4', auth: oauth2 });
}

async function authedDrive(credentialId) {
  const token = await getAccessToken(credentialId);
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: token });
  return google.drive({ version: 'v3', auth: oauth2 });
}

/**
 * Pick-list for the UI. Lists the user's Google Sheets (mimeType-filtered,
 * not their whole Drive), newest first. Requires the `drive.readonly` scope —
 * `drive.file` only surfaces app-created/opened files, so pre-existing sheets
 * would never show up in the picker.
 */
async function listSpreadsheets(credentialId, { pageSize = 50, query = '' } = {}) {
  const drive = await authedDrive(credentialId);
  const safeQuery = query.replace(/'/g, "\\'").slice(0, 100);
  const q = [
    "mimeType='application/vnd.google-apps.spreadsheet'",
    'trashed=false',
    safeQuery ? `name contains '${safeQuery}'` : null,
  ].filter(Boolean).join(' and ');
  const { data } = await drive.files.list({
    q,
    pageSize,
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
  });
  return data.files || [];
}

/**
 * List the tab (sheet) names inside one spreadsheet, so the operator can pick
 * which tab the agent reads/writes.
 */
async function listSheetTabs(credentialId, spreadsheetId) {
  const sheets = await authedSheets(credentialId);
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
  });
  return (data.sheets || []).map(s => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
    rowCount: s.properties.gridProperties?.rowCount,
    columnCount: s.properties.gridProperties?.columnCount,
  }));
}

/**
 * Tool op: read a range from the configured sheet.
 *  args.range — optional A1 (defaults to the whole tab if omitted)
 *  args.max_rows — soft cap so the LLM doesn't get a wall of data
 */
async function read({ credentialId, spreadsheetId, sheetName, args = {} }) {
  const sheets = await authedSheets(credentialId);
  const range = args.range
    ? (args.range.includes('!') ? args.range : `'${sheetName}'!${args.range}`)
    : `'${sheetName}'`;
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = data.values || [];
  const maxRows = Math.max(1, Math.min(500, parseInt(args.max_rows || 100, 10)));
  return {
    range: data.range,
    rowCount: rows.length,
    truncated: rows.length > maxRows,
    rows: rows.slice(0, maxRows),
  };
}

/**
 * Tool op: append a row. `args.values` is an array of cell values (left-to-right).
 * USER_ENTERED so dates/numbers/formulas behave like a human typed them.
 */
async function append({ credentialId, spreadsheetId, sheetName, args = {} }) {
  if (!Array.isArray(args.values)) {
    throw new Error('append requires args.values (array)');
  }
  const sheets = await authedSheets(credentialId);
  // Deterministic placement: read the tab, find the LAST non-empty row, and
  // write the new row right after it via values.update at an explicit range.
  // We do NOT use values.append — its "table detection" lands on the styled
  // header row when the tab is a Sheets "Table" (title banner in row 1 +
  // dark-blue header in row 2), which made rows overwrite the header band.
  // This way the agent never chooses a row number; the code computes it.
  const { data: read } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A1:Z2000`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = read.values || [];
  const start = parseStart(read.range); // 1-based first row of the read window
  let lastNonEmpty = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i] || []).some(c => String(c == null ? '' : c).trim() !== '')) lastNonEmpty = i;
  }
  const targetRow = start.row + lastNonEmpty + 1; // first empty row after content
  const endCol = colLetter(Math.max(0, args.values.length - 1));
  const { data } = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A${targetRow}:${endCol}${targetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [args.values] },
  });
  return {
    action: 'appended',
    row: targetRow,
    updatedRange: data.updatedRange,
    updatedRows: data.updatedRows,
    updatedCells: data.updatedCells,
  };
}

/**
 * Tool op: write `args.values` into a specific range (`args.range`).
 * Used to update an existing row the LLM identified via `read`.
 */
async function update({ credentialId, spreadsheetId, sheetName, args = {} }) {
  if (!args.range) throw new Error('update requires args.range');
  if (!Array.isArray(args.values)) throw new Error('update requires args.values (array)');
  const sheets = await authedSheets(credentialId);
  // Single row: wrap in an outer array; matrix: pass through.
  const values = Array.isArray(args.values[0]) ? args.values : [args.values];
  const range = args.range.includes('!') ? args.range : `'${sheetName}'!${args.range}`;
  const { data } = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
  return {
    updatedRange: data.updatedRange,
    updatedRows: data.updatedRows,
    updatedCells: data.updatedCells,
  };
}

/**
 * Tool op: find-or-create a row by a key column, writing only named columns.
 * The engine handles header discovery, row numbers and the column offset so the
 * LLM never deals with A1 ranges — it just gives
 * { key_column, key_value, fields:{ "Header Name": value } }. The reliable way
 * to keep a single evolving row per contact (vs. raw append/update).
 */
async function upsert({ credentialId, spreadsheetId, sheetName, args = {} }) {
  const keyColumn = args.key_column;
  const keyValue = args.key_value;
  const fields = args.fields;
  if (!keyColumn) throw new Error('upsert requires args.key_column (a header name, e.g. "Phone Number")');
  if (keyValue == null || keyValue === '') throw new Error('upsert requires args.key_value');
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('upsert requires args.fields as an object of { "Column Header": value, ... }');
  }
  const sheets = await authedSheets(credentialId);
  const { data: readData } = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `'${sheetName}'!A1:Z2000`, valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = readData.values || [];
  const start = parseStart(readData.range);

  // 1. Locate the header row (first row that contains the key column name).
  let hIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i] || []).some(c => normCell(c) === normCell(keyColumn))) { hIdx = i; break; }
  }
  if (hIdx === -1) throw new Error(`Could not find a header row containing "${keyColumn}" in tab "${sheetName}". Check the column name.`);
  const header = rows[hIdx];
  const colOf = (name) => header.findIndex(c => normCell(c) === normCell(name));
  const keyCol = colOf(keyColumn);

  // 2. Resolve each field name → its column index (skip unknown columns).
  const writes = []; const skippedUnknownColumns = [];
  for (const [name, value] of Object.entries(fields)) {
    const c = colOf(name);
    if (c === -1) skippedUnknownColumns.push(name); else writes.push({ col: c, value });
  }
  if (writes.length === 0) throw new Error(`None of the given field names matched a column header in "${sheetName}". Headers are: ${header.filter(Boolean).join(', ')}`);

  // 3. Find the existing data row whose key column matches key_value.
  let dIdx = -1;
  for (let i = hIdx + 1; i < rows.length; i++) {
    if (keyMatch((rows[i] || [])[keyCol], keyValue)) { dIdx = i; break; }
  }

  const writeSpan = async (absRow, minC, maxC, span) => {
    const { data } = await sheets.spreadsheets.values.update({
      spreadsheetId, range: `'${sheetName}'!${colLetter(minC)}${absRow}:${colLetter(maxC)}${absRow}`,
      valueInputOption: 'USER_ENTERED', requestBody: { values: [span] },
    });
    return data;
  };

  if (dIdx !== -1) {
    const absRow = start.row + dIdx;
    const cols = writes.map(w => w.col);
    const minC = Math.min(...cols); const maxC = Math.max(...cols);
    const existing = rows[dIdx] || [];
    const span = [];
    for (let c = minC; c <= maxC; c++) {
      const w = writes.find(x => x.col === c);
      span.push(w ? w.value : (existing[c] != null ? existing[c] : ''));
    }
    await writeSpan(absRow, minC, maxC, span);
    return { action: 'updated', row: absRow, key: { column: keyColumn, value: keyValue }, wrote: writes.map(w => header[w.col]), skippedUnknownColumns };
  }

  // 4. No match → write a new positioned row after the last non-empty line
  // (deterministic; avoids Google append landing on a Tables header banner).
  let lastNonEmpty = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i] || []).some(c => String(c == null ? '' : c).trim() !== '')) lastNonEmpty = i;
  }
  const targetRow = start.row + lastNonEmpty + 1;
  const maxC = Math.max(keyCol, ...writes.map(w => w.col));
  const rowArr = new Array(maxC + 1).fill('');
  rowArr[keyCol] = keyValue;
  for (const w of writes) rowArr[w.col] = w.value;
  await writeSpan(targetRow, 0, maxC, rowArr);
  return { action: 'appended', row: targetRow, key: { column: keyColumn, value: keyValue }, wrote: writes.map(w => header[w.col]), skippedUnknownColumns };
}

/**
 * Dispatcher used by the agent engine. Looks at the tool's `config.ops` to
 * gate which operations the LLM is allowed to call — defense in depth, since
 * the LLM only ever sees the ops we expose to it in the tool schema anyway.
 */
async function executeOp({ op, toolConfig, args }) {
  const allowed = Array.isArray(toolConfig.ops) ? toolConfig.ops : [];
  if (!allowed.includes(op)) {
    throw new Error(`Operation '${op}' is not enabled for this Sheets tool. Enabled: ${allowed.join(', ') || 'none'}`);
  }
  const ctx = {
    credentialId: toolConfig.google_account_id,
    spreadsheetId: toolConfig.spreadsheet_id,
    sheetName: toolConfig.sheet_name,
    args,
  };
  if (op === 'read')   return read(ctx);
  if (op === 'append') return append(ctx);
  if (op === 'update') return update(ctx);
  if (op === 'upsert') return upsert(ctx);
  throw new Error(`Unknown Sheets op: ${op}`);
}

module.exports = {
  listSpreadsheets,
  listSheetTabs,
  read,
  append,
  update,
  upsert,
  executeOp,
};
