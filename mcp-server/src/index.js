#!/usr/bin/env node
// ForgeChat Agent Builder — MCP server.
//
// A thin, well-described client over the ForgeChat MCP API
// (/api/mcp/v1, bearer-authed). It exposes DISCOVERY tools (so the assistant
// can offer the user their real WhatsApp numbers, models, spreadsheets, tabs,
// media and templates) and MUTATION tools (create/update/delete agents + tools).
//
// The assistant is expected to gather + confirm the full config with the user
// BEFORE calling create_agent — see the `create-forgechat-agent` prompt and the
// tool descriptions.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_URL = (process.env.FORGECHAT_API_URL || '').replace(/\/$/, '');
const API_KEY = process.env.FORGECHAT_API_KEY || '';

if (!API_URL || !API_KEY) {
  console.error('[forgechat-mcp] FORGECHAT_API_URL and FORGECHAT_API_KEY env vars are required.');
  process.exit(1);
}

// One HTTP helper. Surfaces the backend's {error} message verbatim so the
// assistant can relay it and help the user fix the input.
async function call(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// Wrap a handler so thrown errors become a proper MCP tool error result.
function tool(fn) {
  return async (args) => {
    try {
      const result = await fn(args || {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  };
}

const server = new McpServer({ name: 'forgechat-agents', version: '1.0.0' });

/* ============================== discovery ============================== */

server.registerTool('list_wa_accounts', {
  title: 'List WhatsApp accounts',
  description: 'List the WhatsApp business numbers (WABA accounts) an agent can run on. Use this to ask the user which number the agent should use. Returns id, displayName, phoneNumber, isActive, isDefault.',
  inputSchema: {},
}, tool(() => call('GET', '/wa-accounts')));

server.registerTool('list_models', {
  title: 'List AI models',
  description: 'List connected AI model credentials and the selectable model ids for each. Use to ask the user which model the agent should use. Each entry has aiModelId (pass to create_agent), provider, providerLabel, label, and models[] of {value,label} (the value is the llmModel to pass).',
  inputSchema: {},
}, tool(() => call('GET', '/models')));

server.registerTool('list_google_accounts', {
  title: 'List Google accounts',
  description: 'List the connected Google accounts. Call FIRST when configuring a Google Sheets tool so the user picks which account. Returns [{ id, label, status }]. Pass the chosen id as googleAccountId to the next calls.',
  inputSchema: {},
}, tool(() => call('GET', '/google-accounts')));

server.registerTool('search_spreadsheets', {
  title: 'Search Google spreadsheets',
  description: 'Search a connected Google account for spreadsheets (by name). Call list_google_accounts first to get googleAccountId. Returns { spreadsheets: [{ id, name }] }.',
  inputSchema: {
    googleAccountId: z.union([z.string(), z.number()]).describe('Google account id from list_google_accounts.'),
    query: z.string().optional().describe('Optional search term to filter spreadsheets by name.'),
  },
}, tool(({ googleAccountId, query }) => call('GET', `/spreadsheets?googleAccountId=${encodeURIComponent(googleAccountId)}${query ? `&q=${encodeURIComponent(query)}` : ''}`)));

server.registerTool('list_sheet_tabs', {
  title: 'List spreadsheet tabs',
  description: 'List the tabs (sheets) inside a spreadsheet. Returns { id, tabs: [...] }.',
  inputSchema: {
    googleAccountId: z.union([z.string(), z.number()]).describe('Google account id from list_google_accounts.'),
    spreadsheetId: z.string().describe('The spreadsheet id from search_spreadsheets.'),
  },
}, tool(({ googleAccountId, spreadsheetId }) => call('GET', `/spreadsheets/${encodeURIComponent(spreadsheetId)}/tabs?googleAccountId=${encodeURIComponent(googleAccountId)}`)));

server.registerTool('read_sheet_values', {
  title: 'Read spreadsheet cell values',
  description: 'Read actual cell values from a tab — use this to see the real HEADER ROW and a few sample rows so you can map an agent\'s Sheets logging to the right columns. list_sheet_tabs only returns metadata, NOT contents. Returns { range, headers:[...], rows:[[...]], rowCount, truncated }. Pass range "A1:Z1" for just the headers; omit range to read the whole tab from A1 (capped at maxRows).',
  inputSchema: {
    googleAccountId: z.union([z.string(), z.number()]).describe('Google account id from list_google_accounts.'),
    spreadsheetId: z.string().describe('The spreadsheet id from search_spreadsheets.'),
    tab: z.string().describe('Tab name from list_sheet_tabs.'),
    range: z.string().optional().describe('Optional A1 range (e.g. "A1:Z1" for headers only). Omit to read the whole tab from A1.'),
    maxRows: z.number().int().min(1).max(500).optional().describe('Soft cap on returned rows (default 50).'),
  },
}, tool(({ googleAccountId, spreadsheetId, tab, range, maxRows }) => {
  const qs = new URLSearchParams({ googleAccountId: String(googleAccountId), tab: String(tab) });
  if (range) qs.set('range', range);
  if (maxRows != null) qs.set('maxRows', String(maxRows));
  return call('GET', `/spreadsheets/${encodeURIComponent(spreadsheetId)}/values?${qs.toString()}`);
}));

server.registerTool('list_media', {
  title: 'List media library items',
  description: 'List items from the ForgeChat media library, optionally filtered by type and/or name. Returns [{ id, name, mediaType, mimeType }]. When the user mentions a media file by name (e.g. "use the logo image"), call this with that name to resolve it to an id automatically — then use that id in mediaGroups. Never ask the user for an id.',
  inputSchema: {
    type: z.enum(['image', 'video', 'audio', 'document']).optional().describe('Optional media type filter.'),
    name: z.string().optional().describe('Partial name search (case-insensitive). Use when the user mentions a media file by name.'),
  },
}, tool(({ type, name }) => {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (name) params.set('name', name);
  const qs = params.toString();
  return call('GET', `/media${qs ? `?${qs}` : ''}`);
}));

server.registerTool('list_templates', {
  title: 'List message templates',
  description: 'List WhatsApp message templates, optionally scoped to a WhatsApp account. Returns [{ id, name, language, status, category, waAccountId }]. When the user mentions a template by name, call this to find it, then call get_template to read its full content before confirming with the user.',
  inputSchema: { waAccountId: z.union([z.string(), z.number()]).optional().describe('Optional WhatsApp account id to scope templates to.') },
}, tool(({ waAccountId }) => call('GET', `/templates${waAccountId != null ? `?waAccountId=${encodeURIComponent(waAccountId)}` : ''}`)));

server.registerTool('get_template', {
  title: 'Get template content',
  description: 'Fetch the full content of a template — body text, header, footer, buttons, and variable samples. Call this after finding a template by name via list_templates. Show the user the template name + body + buttons so they can confirm it is the right one before you use its id in a media group or agent config. Never use a template id without confirming the content first.',
  inputSchema: { id: z.union([z.string(), z.number()]).describe('Template id from list_templates.') },
}, tool(({ id }) => call('GET', `/templates/${encodeURIComponent(id)}`)));

server.registerTool('list_agents', {
  title: 'List agents',
  description: 'List all existing AI agents (with tool counts and last-run time). Use to review or before updating/deleting.',
  inputSchema: {},
}, tool(() => call('GET', '/agents')));

server.registerTool('get_agent', {
  title: 'Get agent',
  description: 'Get one agent in full, including its configured tools[].',
  inputSchema: { id: z.union([z.string(), z.number()]).describe('Agent id.') },
}, tool(({ id }) => call('GET', `/agents/${encodeURIComponent(id)}`)));

/* ============================== mutations ============================= */

// Shared media-group shape (optional, advanced).
const mediaGroupSchema = z.object({
  description: z.string().describe('REQUIRED. Tells the agent exactly WHEN to send this group — specific and action-oriented, e.g. "Send when the user confirms they want to enroll" or "Send after the user asks for pricing". Ask the user for this before finalising the group.'),
  mediaIds: z.array(z.number()).optional().describe('Media library item ids to send.'),
  links: z.array(z.string()).optional().describe('URLs to send as link messages.'),
  templateId: z.number().nullable().optional().describe('Approved template id to fire. Always confirm the template content with the user via get_template before using this.'),
}).passthrough();

server.registerTool('create_agent', {
  title: 'Create agent',
  description:
    'Create a new ForgeChat AI agent. IMPORTANT: gather and CONFIRM all settings with the user first ' +
    '(purpose, name, system prompt, WhatsApp number, model, trigger, tools). For an ACTIVE agent you must ' +
    'pass aiModelId + llmModel; otherwise pass status:"draft". Only one active agent is allowed per WhatsApp number. ' +
    'After creating, use add_google_sheets_tool to attach a Sheets tool if the user wanted one.',
  inputSchema: {
    name: z.string().describe('Agent name.'),
    systemPrompt: z.string().describe('The system prompt that defines the agent behaviour.'),
    aiModelId: z.union([z.string(), z.number()]).optional().describe('Connected credential id (from list_models). Required for an active agent.'),
    llmModel: z.string().optional().describe('Model id (the models[].value from list_models). Required for an active agent.'),
    waAccountId: z.union([z.string(), z.number()]).optional().describe('WhatsApp account id (from list_wa_accounts).'),
    status: z.enum(['draft', 'active']).optional().describe('draft = save incomplete (no live traffic). active = runnable (needs model). Defaults to active.'),
    isActive: z.boolean().optional().describe('Whether the agent takes live traffic (only when status=active; one active per number).'),
    contextWindowMessages: z.number().int().min(1).max(100).optional().describe('How many past messages to include (1-100, default 20).'),
    maxToolIterations: z.number().int().min(1).max(20).optional().describe('Max tool-call loops per turn (1-20, default 6).'),
    transcribeAudio: z.boolean().optional().describe('Transcribe inbound voice notes (OpenAI Whisper).'),
    acceptImages: z.boolean().optional().describe('Let the agent see inbound images (sends them to a vision-capable model).'),
    triggerMode: z.enum(['any', 'keyword']).optional().describe('any = every message; keyword = only on keyword/within session.'),
    triggerKeyword: z.string().optional().describe('Required when triggerMode=keyword on an active agent.'),
    triggerMatchType: z.enum(['exact', 'contains', 'starts']).optional().describe('How the keyword matches (default contains).'),
    triggerCaseSensitive: z.boolean().optional(),
    triggerSessionMinutes: z.number().int().min(1).max(1440).optional().describe('How long a keyword session stays open (1-1440, default 30).'),
    mediaGroups: z.array(mediaGroupSchema).optional().describe('Optional media/link/template bundles the agent can send.'),
  },
}, tool((args) => call('POST', '/agents', args)));

server.registerTool('update_agent', {
  title: 'Update agent',
  description: 'Update an existing agent. Only the fields you pass are changed. Same validation as create_agent.',
  inputSchema: {
    id: z.union([z.string(), z.number()]).describe('Agent id.'),
    name: z.string().optional(),
    systemPrompt: z.string().optional(),
    aiModelId: z.union([z.string(), z.number()]).nullable().optional(),
    llmModel: z.string().nullable().optional(),
    waAccountId: z.union([z.string(), z.number()]).nullable().optional(),
    status: z.enum(['draft', 'active']).optional(),
    isActive: z.boolean().optional(),
    contextWindowMessages: z.number().int().min(1).max(100).optional(),
    maxToolIterations: z.number().int().min(1).max(20).optional(),
    transcribeAudio: z.boolean().optional(),
    acceptImages: z.boolean().optional(),
    triggerMode: z.enum(['any', 'keyword']).optional(),
    triggerKeyword: z.string().optional(),
    triggerMatchType: z.enum(['exact', 'contains', 'starts']).optional(),
    triggerCaseSensitive: z.boolean().optional(),
    triggerSessionMinutes: z.number().int().min(1).max(1440).optional(),
    mediaGroups: z.array(mediaGroupSchema).optional(),
  },
}, tool(({ id, ...patch }) => call('PUT', `/agents/${encodeURIComponent(id)}`, patch)));

server.registerTool('add_google_sheets_tool', {
  title: 'Add Google Sheets tool',
  description:
    'Attach a Google Sheets tool to an agent. First use list_google_accounts → search_spreadsheets → list_sheet_tabs so the user picks a real ' +
    'account, spreadsheet and tab, and ask which operations to allow.',
  inputSchema: {
    agentId: z.union([z.string(), z.number()]).describe('Agent id.'),
    googleAccountId: z.union([z.string(), z.number()]).describe('Google account id (from list_google_accounts).'),
    spreadsheetId: z.string().describe('Spreadsheet id (from search_spreadsheets).'),
    spreadsheetName: z.string().optional().describe('Display name of the spreadsheet (for reference).'),
    sheetName: z.string().describe('Tab name (from list_sheet_tabs).'),
    ops: z.array(z.enum(['read', 'append', 'update', 'upsert'])).min(1).describe('Allowed operations — at least one of read/append/update/upsert.'),
  },
}, tool(({ agentId, googleAccountId, spreadsheetId, spreadsheetName, sheetName, ops }) =>
  call('POST', `/agents/${encodeURIComponent(agentId)}/tools`, {
    toolType: 'google_sheets',
    config: { google_account_id: googleAccountId, spreadsheet_id: spreadsheetId, spreadsheet_name: spreadsheetName || null, sheet_name: sheetName, ops },
  })));

server.registerTool('add_http_tool', {
  title: 'Add HTTP request tool',
  description:
    'Attach an HTTP-request tool so the agent can call an external system (device/hardware API, webhook, internal service) during a chat. ' +
    'You set a fixed method + URL + static headers (for auth); the agent\'s AI fills the declared params at call time. ' +
    'Path params replace {name} in the URL, query params append to the URL, body params build the JSON body, header params become request headers. ' +
    'Confirm the endpoint + params with the user before adding.',
  inputSchema: {
    agentId: z.union([z.string(), z.number()]).describe('Agent id.'),
    label: z.string().describe('Short action name, e.g. "Turn on smart light".'),
    description: z.string().describe('When the AI should call this tool — the model reads this to decide. Be specific.'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).describe('HTTP method.'),
    url: z.string().describe('Endpoint URL. Use {name} for a path parameter, e.g. https://api.io/devices/{device_id}/state'),
    headers: z.array(z.object({ k: z.string(), v: z.string() })).optional().describe('Static headers sent on every call (auth tokens etc.).'),
    params: z.array(z.object({
      name: z.string().describe('Identifier (letters/numbers/underscore).'),
      in: z.enum(['path', 'query', 'body', 'header']).describe('Where the value goes.'),
      type: z.enum(['string', 'number', 'boolean']).optional(),
      description: z.string().optional().describe('What the value means — the AI reads this.'),
      required: z.boolean().optional(),
    })).optional().describe('Values the AI fills when calling the tool.'),
    timeoutMs: z.number().int().min(1000).max(30000).optional(),
  },
}, tool(({ agentId, label, description, method, url, headers, params, timeoutMs }) =>
  call('POST', `/agents/${encodeURIComponent(agentId)}/tools`, {
    toolType: 'http_request',
    config: { label, description, method, url, headers: headers || [], params: params || [], timeout_ms: timeoutMs || 10000 },
  })));

server.registerTool('add_tool', {
  title: 'Add tool (generic)',
  description: 'Attach a tool to an agent by raw toolType + config. Prefer add_google_sheets_tool for Sheets and add_http_tool for HTTP. Supported toolTypes: "google_sheets", "http_request".',
  inputSchema: {
    agentId: z.union([z.string(), z.number()]).describe('Agent id.'),
    toolType: z.string().describe('Tool type, e.g. "google_sheets".'),
    config: z.record(z.any()).describe('Tool config object (shape depends on toolType).'),
    isEnabled: z.boolean().optional(),
  },
}, tool(({ agentId, toolType, config, isEnabled }) =>
  call('POST', `/agents/${encodeURIComponent(agentId)}/tools`, { toolType, config, isEnabled })));

server.registerTool('update_tool', {
  title: 'Update tool',
  description: "Update an agent tool's config or enabled flag.",
  inputSchema: {
    agentId: z.union([z.string(), z.number()]).describe('Agent id.'),
    toolId: z.union([z.string(), z.number()]).describe('Tool id.'),
    config: z.record(z.any()).optional(),
    isEnabled: z.boolean().optional(),
  },
}, tool(({ agentId, toolId, config, isEnabled }) =>
  call('PUT', `/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolId)}`, { config, isEnabled })));

server.registerTool('delete_tool', {
  title: 'Delete tool',
  description: 'Remove a tool from an agent. Confirm with the user first.',
  inputSchema: {
    agentId: z.union([z.string(), z.number()]).describe('Agent id.'),
    toolId: z.union([z.string(), z.number()]).describe('Tool id.'),
  },
}, tool(({ agentId, toolId }) =>
  call('DELETE', `/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolId)}`)));

server.registerTool('delete_agent', {
  title: 'Delete agent',
  description: 'Delete an agent entirely. This is destructive — confirm with the user first.',
  inputSchema: { id: z.union([z.string(), z.number()]).describe('Agent id.') },
}, tool(({ id }) => call('DELETE', `/agents/${encodeURIComponent(id)}`)));

/* =============================== prompt =============================== */

const GUIDE = `You are creating a ForgeChat WhatsApp AI agent. Gather and CONFIRM the full configuration with the user before calling create_agent. Offer real options fetched from their account — never guess ids, spreadsheets, tabs, models, or numbers.

Walk this flow:
1. Ask what the agent should do (its purpose / goal).
2. Propose a clear name and a first draft of the system prompt; refine with the user.
3. Call list_wa_accounts and ask which WhatsApp number it should run on.
4. Call list_models and ask which AI model to use (show provider + model options). Pass the chosen aiModelId + llmModel.
5. Ask how it should trigger: "any" (every message) or "keyword". If keyword, ask for the keyword, match type (exact/contains/starts), case sensitivity, and session window minutes (default 30).
   Also ask whether the agent should understand voice notes (set transcribeAudio:true) and/or images (set acceptImages:true).
6. Ask whether it needs tools.
   - Google Sheets:
     a. Call list_google_accounts and let the user pick which Google account to use.
     b. Call search_spreadsheets (with that googleAccountId) and let the user pick a spreadsheet.
     c. Call list_sheet_tabs (same googleAccountId) for that spreadsheet and let the user pick the tab.
     c. Ask which operations to allow: read, append, update, upsert (one or more). For LOGGING a contact's data, prefer 'upsert' (updates the contact's existing row by a key column like phone, or adds one if new — no duplicates).
   - HTTP request (to call an external API / device / hardware / webhook): ask for the endpoint URL, method, any auth headers, and what inputs the AI should fill (each input's name, where it goes — path/query/body/header — type, and meaning). Then use add_http_tool. Use {name} in the URL for path inputs.
7. Ask whether it should send media bundles or templates (media groups) — optional. A media group is a bundle the agent sends at a specific moment. For EACH group:
   a. Ask "when should this be sent?" — the answer becomes the group's description (e.g. "Send when the user confirms interest", "Send after the user asks for pricing"). This description is how the agent decides when to trigger the group, so make it specific and action-oriented.
   b. Media: if the user mentions a file by name, call list_media with that name to resolve it to an id — never ask the user for an id.
   c. Template: if the user mentions a template by name, call list_templates to find it, then call get_template to read its full content (body, header, buttons). Show the user the template name + body + buttons and ask them to confirm it is the right one BEFORE using its id.
   d. Ask if there are more groups to add. Repeat until done.
8. Summarize the complete configuration and ask for explicit confirmation.
9. On confirmation, call create_agent. Then attach any chosen tools: add_google_sheets_tool for Sheets, add_http_tool for HTTP.
10. Report the created agent (id + recap) and offer to activate it or make edits.

Notes: an ACTIVE agent needs both aiModelId and llmModel (otherwise save status:"draft"). Only one active agent per WhatsApp number. Always confirm destructive actions (delete) first.`;

server.registerPrompt('create-forgechat-agent', {
  title: 'Create a ForgeChat agent',
  description: 'Guided flow to create and configure a ForgeChat WhatsApp AI agent (asks the right questions, then creates it).',
  argsSchema: {},
}, () => ({
  messages: [{ role: 'user', content: { type: 'text', text: GUIDE } }],
}));

/* =============================== start =============================== */

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[forgechat-mcp] ready');
