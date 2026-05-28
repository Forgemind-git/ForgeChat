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
 * Pick-list for the UI. Returns spreadsheets the user has either created with
 * us or explicitly opened — we never list their full Drive (the requested
 * scope is `drive.file`, not the full `drive` scope).
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
  const { data } = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [args.values] },
  });
  return {
    updatedRange: data.updates?.updatedRange,
    updatedRows: data.updates?.updatedRows,
    updatedCells: data.updates?.updatedCells,
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
  throw new Error(`Unknown Sheets op: ${op}`);
}

module.exports = {
  listSpreadsheets,
  listSheetTabs,
  read,
  append,
  update,
  executeOp,
};
