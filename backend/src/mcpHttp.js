// Remote (Streamable HTTP) MCP transport, mounted at /api/mcp/http/:key.
//
// This is "Model B": anyone can connect with just a URL (key in the path) —
// no local files. Stateless + JSON responses (proxy-friendly through Traefik),
// a fresh McpServer per request. Tools call services/mcpService + agentService
// DIRECTLY (in-process), gated by the per-request key's capabilities.

const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const agentService = require('./services/agentService');
const mcpService = require('./services/mcpService');

function ok(data) { return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }; }
function fail(msg) { return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }; }

// Wrap a tool: enforce capability, run, format result/error.
function gated(capabilities, name, fn) {
  return async (args) => {
    if (capabilities[name] !== true) return fail(`The '${name}' capability is disabled for MCP access.`);
    try { return ok(await fn(args || {})); }
    catch (err) { return fail(err.message || 'Tool failed'); }
  };
}

const mediaGroupSchema = z.object({
  description: z.string().describe('REQUIRED. Tells the agent exactly WHEN to send this group — specific and action-oriented, e.g. "Send when the user confirms they want to enroll" or "Send after the user asks for pricing". Ask the user for this before finalising the group.'),
  mediaIds: z.array(z.number()).optional().describe('Media library item ids to send.'),
  links: z.array(z.string()).optional().describe('URLs to send as link messages.'),
  templateId: z.number().nullable().optional().describe('Approved template id to fire. Always confirm the template content with the user via get_template before using this.'),
}).passthrough();

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
     a. Call list_google_accounts and let the user pick which connected Google account to use.
     b. Call search_spreadsheets (with that googleAccountId) and let the user pick a spreadsheet.
     c. Call list_sheet_tabs (same googleAccountId) for that spreadsheet and let the user pick the tab.
     c2. If the agent will LOG rows to the sheet (or you need the column layout), call read_sheet_values (range "A1:Z1") to read the real header row, then map the logged fields to those exact columns — don't assume column names.
     d. Ask which operations to allow: read, append, update, upsert (one or more). For LOGGING a contact's data, prefer 'upsert' (updates the contact's existing row by a key column like phone, or adds one if new — no duplicates). Pass googleAccountId to add_google_sheets_tool.
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

// Build a fresh server scoped to one request's capabilities.
function buildServer(capabilities) {
  const server = new McpServer({ name: 'forgechat-agents', version: '1.0.0' });

  /* discovery */
  server.registerTool('list_wa_accounts', {
    title: 'List WhatsApp accounts',
    description: 'List the WhatsApp business numbers an agent can run on. Use to ask the user which number to use. Returns id, displayName, phoneNumber, isActive, isDefault.',
    inputSchema: {},
  }, gated(capabilities, 'discovery', () => mcpService.listWaAccounts()));

  server.registerTool('list_models', {
    title: 'List AI models',
    description: 'List connected AI model credentials and selectable model ids. Each entry has aiModelId, provider, providerLabel, label, and models[] of {value,label}. Pass aiModelId + a models[].value (as llmModel) to create_agent.',
    inputSchema: {},
  }, gated(capabilities, 'discovery', () => mcpService.listModels()));

  server.registerTool('list_google_accounts', {
    title: 'List Google accounts',
    description: 'List the connected Google accounts. Use FIRST when configuring a Google Sheets tool so the user picks which account to read/write. Returns [{ id, label, status }]. Pass the chosen id as googleAccountId to search_spreadsheets / list_sheet_tabs / add_google_sheets_tool.',
    inputSchema: {},
  }, gated(capabilities, 'discovery', () => mcpService.listGoogleAccounts()));

  server.registerTool('search_spreadsheets', {
    title: 'Search Google spreadsheets',
    description: 'Search a connected Google account for spreadsheets by name. Call list_google_accounts first to get googleAccountId. Returns { spreadsheets: [{ id, name }] }.',
    inputSchema: {
      googleAccountId: z.union([z.string(), z.number()]).describe('Google account id from list_google_accounts.'),
      query: z.string().optional().describe('Optional search term.'),
    },
  }, gated(capabilities, 'discovery', ({ googleAccountId, query }) => mcpService.searchSpreadsheets({ googleAccountId, q: query || '' })));

  server.registerTool('list_sheet_tabs', {
    title: 'List spreadsheet tabs',
    description: 'List the tabs in a spreadsheet so the user can choose one. Returns { id, tabs: [...] }.',
    inputSchema: {
      googleAccountId: z.union([z.string(), z.number()]).describe('Google account id from list_google_accounts.'),
      spreadsheetId: z.string().describe('Spreadsheet id from search_spreadsheets.'),
    },
  }, gated(capabilities, 'discovery', ({ googleAccountId, spreadsheetId }) => mcpService.listSheetTabs(googleAccountId, spreadsheetId)));

  server.registerTool('read_sheet_values', {
    title: 'Read spreadsheet cell values',
    description: 'Read actual cell values from a tab — use this to see the real HEADER ROW and a few sample rows so you can map an agent\'s Sheets logging to the right columns. list_sheet_tabs only returns metadata (names/dimensions), NOT contents; this returns them. Returns { range, headers:[...], rows:[[...]], rowCount, truncated }. By default reads the whole tab from A1 (capped at maxRows). Pass an A1 range like "A1:Z1" to fetch only the header row.',
    inputSchema: {
      googleAccountId: z.union([z.string(), z.number()]).describe('Google account id from list_google_accounts.'),
      spreadsheetId: z.string().describe('Spreadsheet id from search_spreadsheets.'),
      tab: z.string().describe('Tab name from list_sheet_tabs.'),
      range: z.string().optional().describe('Optional A1 range (e.g. "A1:Z1" for just headers, or "A1:Z20"). Omit to read the whole tab from A1.'),
      maxRows: z.number().int().min(1).max(500).optional().describe('Soft cap on returned rows (default 50).'),
    },
  }, gated(capabilities, 'discovery', ({ googleAccountId, spreadsheetId, tab, range, maxRows }) => mcpService.readSheetValues({ googleAccountId, spreadsheetId, tab, range, maxRows })));

  server.registerTool('list_media', {
    title: 'List media library items',
    description: 'List media library items for media groups. Filter by type and/or name (partial, case-insensitive). Returns [{ id, name, mediaType, mimeType }]. When the user mentions a media name, call this with that name to resolve it to an id — then use that id in mediaGroups.',
    inputSchema: {
      type: z.enum(['image', 'video', 'audio', 'document']).optional(),
      name: z.string().optional().describe('Partial name search (case-insensitive). Use when the user mentions a media file by name.'),
    },
  }, gated(capabilities, 'discovery', ({ type, name }) => mcpService.listMedia(type, name)));

  server.registerTool('list_templates', {
    title: 'List message templates',
    description: 'List WhatsApp message templates (optionally by WhatsApp account). Returns [{ id, name, language, status, category, waAccountId }]. When the user mentions a template by name, call this to find it, then call get_template to read its full content before confirming with the user.',
    inputSchema: { waAccountId: z.union([z.string(), z.number()]).optional() },
  }, gated(capabilities, 'discovery', ({ waAccountId }) => mcpService.listTemplates(waAccountId)));

  server.registerTool('get_template', {
    title: 'Get template content',
    description: 'Fetch the full content of a template — body text, header, footer, buttons, and variable samples. Call this after finding a template by name via list_templates, then show the content to the user (name + body + buttons) so they can confirm it is the right one before using its id in a media group or agent config.',
    inputSchema: { id: z.union([z.string(), z.number()]).describe('Template id from list_templates.') },
  }, gated(capabilities, 'discovery', ({ id }) => mcpService.getTemplate(id)));

  server.registerTool('list_agents', {
    title: 'List agents',
    description: 'List all existing AI agents with tool counts and last-run time.',
    inputSchema: {},
  }, gated(capabilities, 'discovery', () => agentService.listAgents()));

  server.registerTool('get_agent', {
    title: 'Get agent',
    description: 'Get one agent in full, including its tools[].',
    inputSchema: { id: z.union([z.string(), z.number()]) },
  }, gated(capabilities, 'discovery', ({ id }) => agentService.getAgent(id)));

  /* mutations */
  server.registerTool('create_agent', {
    title: 'Create agent',
    description:
      'Create a new ForgeChat AI agent. Gather + CONFIRM all settings with the user first. For an ACTIVE agent pass aiModelId + llmModel; otherwise status:"draft". Only one active agent per WhatsApp number. After creating, use add_google_sheets_tool to attach a Sheets tool if wanted.',
    inputSchema: {
      name: z.string(),
      systemPrompt: z.string(),
      aiModelId: z.union([z.string(), z.number()]).optional(),
      llmModel: z.string().optional(),
      waAccountId: z.union([z.string(), z.number()]).optional(),
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
  }, gated(capabilities, 'create_agent', (a) => agentService.createAgent(a)));

  server.registerTool('update_agent', {
    title: 'Update agent',
    description: 'Update an agent. Only fields you pass change. Same validation as create_agent.',
    inputSchema: {
      id: z.union([z.string(), z.number()]),
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
  }, gated(capabilities, 'update_agent', ({ id, ...patch }) => agentService.updateAgent(id, patch)));

  server.registerTool('add_google_sheets_tool', {
    title: 'Add Google Sheets tool',
    description: 'Attach a Google Sheets tool to an agent. Use list_google_accounts → search_spreadsheets → list_sheet_tabs first so the user picks a real account, spreadsheet + tab, and ask which ops to allow.',
    inputSchema: {
      agentId: z.union([z.string(), z.number()]),
      googleAccountId: z.union([z.string(), z.number()]).describe('Google account id from list_google_accounts.'),
      spreadsheetId: z.string(),
      spreadsheetName: z.string().optional(),
      sheetName: z.string(),
      ops: z.array(z.enum(['read', 'append', 'update', 'upsert'])).min(1),
    },
  }, gated(capabilities, 'manage_tools', ({ agentId, googleAccountId, spreadsheetId, spreadsheetName, sheetName, ops }) =>
    agentService.addTool(agentId, {
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
      agentId: z.union([z.string(), z.number()]),
      label: z.string().describe('Short action name, e.g. "Turn on smart light".'),
      description: z.string().describe('When the AI should call this tool — the model reads this to decide. Be specific.'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).describe('HTTP method.'),
      url: z.string().describe('Endpoint URL. Use {name} to insert a path parameter, e.g. https://api.io/devices/{device_id}/state'),
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
  }, gated(capabilities, 'manage_tools', ({ agentId, label, description, method, url, headers, params, timeoutMs }) =>
    agentService.addTool(agentId, {
      toolType: 'http_request',
      config: { label, description, method, url, headers: headers || [], params: params || [], timeout_ms: timeoutMs || 10000 },
    })));

  server.registerTool('add_tool', {
    title: 'Add tool (generic)',
    description: 'Attach a tool by raw toolType + config. Prefer add_google_sheets_tool for Sheets and add_http_tool for HTTP. Supported toolTypes: "google_sheets", "http_request".',
    inputSchema: {
      agentId: z.union([z.string(), z.number()]),
      toolType: z.string(),
      config: z.record(z.any()),
      isEnabled: z.boolean().optional(),
    },
  }, gated(capabilities, 'manage_tools', ({ agentId, toolType, config, isEnabled }) =>
    agentService.addTool(agentId, { toolType, config, isEnabled })));

  server.registerTool('update_tool', {
    title: 'Update tool',
    description: "Update an agent tool's config or enabled flag.",
    inputSchema: {
      agentId: z.union([z.string(), z.number()]),
      toolId: z.union([z.string(), z.number()]),
      config: z.record(z.any()).optional(),
      isEnabled: z.boolean().optional(),
    },
  }, gated(capabilities, 'manage_tools', ({ agentId, toolId, config, isEnabled }) =>
    agentService.updateTool(agentId, toolId, { config, isEnabled })));

  server.registerTool('delete_tool', {
    title: 'Delete tool',
    description: 'Remove a tool from an agent. Confirm with the user first.',
    inputSchema: { agentId: z.union([z.string(), z.number()]), toolId: z.union([z.string(), z.number()]) },
  }, gated(capabilities, 'delete', ({ agentId, toolId }) => agentService.deleteTool(agentId, toolId)));

  server.registerTool('delete_agent', {
    title: 'Delete agent',
    description: 'Delete an agent entirely. Destructive — confirm with the user first.',
    inputSchema: { id: z.union([z.string(), z.number()]) },
  }, gated(capabilities, 'delete', ({ id }) => agentService.deleteAgent(id)));

  /* prompt */
  server.registerPrompt('create-forgechat-agent', {
    title: 'Create a ForgeChat agent',
    description: 'Guided flow to create and configure a ForgeChat WhatsApp AI agent.',
    argsSchema: {},
  }, () => ({ messages: [{ role: 'user', content: { type: 'text', text: GUIDE } }] }));

  return server;
}

// Express handler. Stateless: new server+transport per POST.
async function mcpHttpHandler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. This is a stateless MCP server — use POST.' },
      id: null,
    });
  }
  let capabilities;
  try {
    ({ capabilities } = await mcpService.validateKey(req.params.key));
  } catch (err) {
    return res.status(err.status || 401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: err.message || 'Unauthorized' },
      id: null,
    });
  }

  const server = buildServer(capabilities);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcpHttp] error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
}

module.exports = { mcpHttpHandler };
