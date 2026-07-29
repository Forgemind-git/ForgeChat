async function req(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text}`);
  }
  return res.json();
}

export const api = {
  auth: {
    me: () => req('/auth/me'),
    status: () => req('/auth/status'),
    setup: (email, password, displayName) =>
      req('/auth/setup', { method: 'POST', body: JSON.stringify({ email, password, displayName }) }),
    login: (email, password) =>
      req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => req('/auth/logout', { method: 'POST' }),
  },
  dashboard: (range = '7d') => req(`/dashboard?range=${encodeURIComponent(range)}`),
  dashboardDetails: (metric, range = '7d') =>
    req(`/dashboard/details?metric=${encodeURIComponent(metric)}&range=${encodeURIComponent(range)}`),
  numbers: () => req('/numbers'),
  contacts: (waNumber, timeRange) =>
    req(`/contacts?waNumber=${encodeURIComponent(waNumber)}&timeRange=${timeRange}`),
  messages: (params) => {
    const qs = new URLSearchParams(params);
    return req(`/messages?${qs}`);
  },
  contactNames: (waNumber) =>
    req(`/contact-names?waNumber=${encodeURIComponent(waNumber)}`),
  contact: (waNumber, contactNumber) =>
    req(`/contact?waNumber=${encodeURIComponent(waNumber)}&contactNumber=${encodeURIComponent(contactNumber)}`),
  saveContact: (waNumber, contactNumber, name, tags = [], customFields, assignedUserId) =>
    req('/contacts/save', {
      method: 'POST',
      body: JSON.stringify({
        waNumber, contactNumber, name, tags,
        ...(customFields !== undefined ? { customFields } : {}),
        ...(assignedUserId !== undefined ? { assignedUserId } : {}),
      }),
    }),
  savedContacts: (waNumber) =>
    req(`/saved-contacts?waNumber=${encodeURIComponent(waNumber)}`),
  deleteContact: (waNumber, contactNumber) =>
    req(`/contact?waNumber=${encodeURIComponent(waNumber)}&contactNumber=${encodeURIComponent(contactNumber)}`, { method: 'DELETE' }),
  // Change a contact's phone number — migrates the conversation + history across
  // every table keyed on (wa_number, contact_number), transactionally.
  changeContactNumber: (waNumber, oldNumber, newNumber) =>
    req('/contacts/change-number', { method: 'POST', body: JSON.stringify({ waNumber, oldNumber, newNumber }) }),
  // Same-origin download URL for the sample import sheet — the auth cookie rides
  // along on a plain anchor navigation.
  importContactsTemplateUrl: () => '/api/contacts/import/template',
  // Bulk-import contacts from a .csv/.xlsx file. Uses raw fetch + FormData so the
  // browser sets the multipart boundary (the shared req() helper forces JSON).
  importContacts: (waNumber, file) => {
    const form = new FormData();
    form.append('waNumber', waNumber);
    form.append('file', file);
    return fetch('/api/contacts/import', { method: 'POST', credentials: 'include', body: form })
      .then(async res => {
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          let msg = text;
          try { msg = JSON.parse(text).error || text; } catch { /* keep raw */ }
          throw new Error(msg || `${res.status}`);
        }
        return res.json();
      });
  },
  categories: {
    list: () => req('/categories'),
    create: (data) => req('/categories', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/categories/${id}`, { method: 'DELETE' }),
  },
  tags: {
    list: () => req('/tags'),
    create: (data) => req('/tags', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/tags/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/tags/${id}`, { method: 'DELETE' }),
  },
  // Custom contact field definitions (Settings → Fields). Values per contact
  // are saved via saveContact(..., customFields) and read back on api.contact.
  contactFields: {
    list: () => req('/contact-fields'),
    create: (data) => req('/contact-fields', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/contact-fields/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/contact-fields/${id}`, { method: 'DELETE' }),
  },
  // Admin-only user management (multi-user RBAC: admin + sales).
  users: {
    list: () => req('/users'),
    get: (id) => req(`/users/${id}`),
    create: (data) => req('/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id) => req(`/users/${id}`, { method: 'DELETE' }),
    resetPassword: (id, password) => req(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(password ? { password } : {}),
    }),
  },
  templates: {
    list: ({ accountId, status, q } = {}) => {
      const qs = new URLSearchParams();
      if (accountId) qs.set('accountId', accountId);
      if (status) qs.set('status', status);
      if (q) qs.set('q', q);
      const s = qs.toString();
      return req(`/templates${s ? `?${s}` : ''}`);
    },
    get: (id) => req(`/templates/${id}`),
    create: (data) => req('/templates', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/templates/${id}`, { method: 'DELETE' }),
    submit: (id) => req(`/templates/${id}/submit`, { method: 'POST' }),
    sync: (id) => req(`/templates/${id}/sync`, { method: 'POST' }),
    duplicate: (id) => req(`/templates/${id}/duplicate`, { method: 'POST' }),
    payload: (id) => req(`/templates/${id}/payload`),
  },
  broadcasts: {
    list: (status) => req(`/broadcasts${status && status !== 'all' ? `?status=${status}` : ''}`),
    get: (id) => req(`/broadcasts/${id}`),
    create: (data) => req('/broadcasts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/broadcasts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/broadcasts/${id}`, { method: 'DELETE' }),
    send: (id) => req(`/broadcasts/${id}/send`, { method: 'POST' }),
    test: (id, testNumber) => req(`/broadcasts/${id}/test`, { method: 'POST', body: JSON.stringify({ test_number: testNumber }) }),
  },
  chatbots: {
    list: () => req('/chatbots'),
    get: (id) => req(`/chatbots/${id}`),
    create: (data) => req('/chatbots', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/chatbots/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    duplicate: (id) => req(`/chatbots/${id}/duplicate`, { method: 'POST' }),
    delete: (id) => req(`/chatbots/${id}`, { method: 'DELETE' }),
    exportOne: (id) => req(`/chatbots/${id}/export`),
    import: (payload) => req('/chatbots/import', { method: 'POST', body: JSON.stringify(payload) }),
    executions: (id, { page = 1, limit = 20, status = 'all', startDate = '', endDate = '', messageStatus = 'all' } = {}) => {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status && status !== 'all') qs.set('status', status);
      if (startDate) qs.set('startDate', startDate);
      if (endDate) qs.set('endDate', endDate);
      if (messageStatus && messageStatus !== 'all') qs.set('messageStatus', messageStatus);
      return req(`/chatbots/${id}/executions?${qs}`);
    },
  },
  executions: {
    get: (id) => req(`/executions/${id}`),
    cancel: (id) => req(`/executions/${id}/cancel`, { method: 'POST' }),
  },
  whatsappAccounts: {
    list: (activeOnly = false) => req(`/whatsapp-accounts${activeOnly ? '?activeOnly=true' : ''}`),
    get: (id) => req(`/whatsapp-accounts/${id}`),
    create: (data) => req('/whatsapp-accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/whatsapp-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/whatsapp-accounts/${id}`, { method: 'DELETE' }),
  },
  // Google integrations (v1: Google Sheets only; Gmail + Calendar in a later
  // release reuse the same /google-integrations table and OAuth flow).
  googleIntegrations: {
    status: () => req('/google-integrations/status'),
    // Admin-only: the workspace Google OAuth app credentials (Client ID /
    // Secret / Redirect URI). getCredentials never returns the secret.
    getCredentials: (reveal = false) => req(`/google-integrations/credentials${reveal ? '?reveal=1' : ''}`),
    saveCredentials: (data) =>
      req('/google-integrations/credentials', { method: 'PUT', body: JSON.stringify(data) }),
    deleteCredentials: () =>
      req('/google-integrations/credentials', { method: 'DELETE' }),
    list: () => req('/google-integrations'),
    authorize: () => req('/google-integrations/authorize', { method: 'POST' }),
    disconnect: (id) => req(`/google-integrations/${id}`, { method: 'DELETE' }),
    listSpreadsheets: (id, q = '') =>
      req(`/google-integrations/${id}/spreadsheets${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    listTabs: (id, spreadsheetId) =>
      req(`/google-integrations/${id}/spreadsheets/${encodeURIComponent(spreadsheetId)}/tabs`),
  },
  // AI Models registry — workspace-wide LLM provider credentials (Admin
  // Settings → Integrations → AI Models). Agents reference a row by id; the key
  // is encrypted server-side and only revealed to admins via ?reveal=1.
  aiModels: {
    list: () => req('/ai-models'),
    get: (id, reveal = false) => req(`/ai-models/${id}${reveal ? '?reveal=1' : ''}`),
    create: (data) => req('/ai-models', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/ai-models/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/ai-models/${id}`, { method: 'DELETE' }),
  },
  // AI Agents — standalone LLM-driven chat handlers bound to a WhatsApp account.
  agents: {
    list: () => req('/agents'),
    get: (id, reveal = false) => req(`/agents/${id}${reveal ? '?reveal=1' : ''}`),
    create: (data) => req('/agents', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/agents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/agents/${id}`, { method: 'DELETE' }),
    exportOne: (id) => req(`/agents/${id}/export`),
    import: (payload) => req('/agents/import', { method: 'POST', body: JSON.stringify(payload) }),
    runs: (id, limit = 50) => req(`/agents/${id}/runs?limit=${limit}`),
    run: (id, runId) => req(`/agents/${id}/runs/${runId}`),
    addTool: (id, data) => req(`/agents/${id}/tools`, { method: 'POST', body: JSON.stringify(data) }),
    updateTool: (id, toolId, data) =>
      req(`/agents/${id}/tools/${toolId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeTool: (id, toolId) => req(`/agents/${id}/tools/${toolId}`, { method: 'DELETE' }),
    // Dry-run an agent without sending the reply to WhatsApp — used by the
    // "Test chat" panel inside the agent editor.
    test: (id, messages) => req(`/agents/${id}/test`, {
      method: 'POST', body: JSON.stringify({ messages }),
    }),
    // Transcribe a voice note recorded in the test chat (mic button).
    testTranscribe: (id, audioBlob, filename = 'voice.webm') => {
      const form = new FormData();
      form.append('audio', audioBlob, filename);
      return fetch(`/api/agents/${id}/test/transcribe`, {
        method: 'POST', credentials: 'include', body: form,
      }).then(async res => {
        if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`${res.status} ${t}`); }
        return res.json();
      });
    },
  },
  // Per-conversation bot control (Chats header 🤖 toggle).
  agentConversation: {
    status: (waNumber, contactNumber) =>
      req(`/agent-conversation?waNumber=${encodeURIComponent(waNumber)}&contactNumber=${encodeURIComponent(contactNumber)}`),
    pause: (waNumber, contactNumber) =>
      req('/agent-conversation/pause', { method: 'POST', body: JSON.stringify({ waNumber, contactNumber }) }),
    resume: (waNumber, contactNumber) =>
      req('/agent-conversation/resume', { method: 'POST', body: JSON.stringify({ waNumber, contactNumber }) }),
  },
  // External MCP access — admin management of keys + capability toggles.
  mcp: {
    getSettings: () => req('/mcp/settings'),
    updateSettings: (data) => req('/mcp/settings', { method: 'PUT', body: JSON.stringify(data) }),
    listKeys: () => req('/mcp/keys'),
    createKey: (label) => req('/mcp/keys', { method: 'POST', body: JSON.stringify({ label }) }),
    updateKey: (id, data) => req(`/mcp/keys/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteKey: (id) => req(`/mcp/keys/${id}`, { method: 'DELETE' }),
    install: () => req('/mcp/install'),
  },
  pipelines: {
    list: () => req('/pipelines'),
    create: (name) => req('/pipelines', { method: 'POST', body: JSON.stringify({ name }) }),
    update: (id, name) => req(`/pipelines/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
    delete: (id) => req(`/pipelines/${id}`, { method: 'DELETE' }),
    addStage: (pipelineId, data) => req(`/pipelines/${pipelineId}/stages`, { method: 'POST', body: JSON.stringify(data) }),
    updateStage: (stageId, data) => req(`/stages/${stageId}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteStage: (stageId) => req(`/stages/${stageId}`, { method: 'DELETE' }),
  },
  deals: {
    list: (pipelineId) => req(`/deals?pipelineId=${encodeURIComponent(pipelineId)}`),
    metrics: (pipelineId) => req(`/deals/metrics?pipelineId=${encodeURIComponent(pipelineId)}`),
    create: (data) => req('/deals', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/deals/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    move: (id, stageId) => req(`/deals/${id}/move`, { method: 'POST', body: JSON.stringify({ stageId }) }),
    delete: (id) => req(`/deals/${id}`, { method: 'DELETE' }),
    contactSearch: (q) => req(`/deals/contact-search?q=${encodeURIComponent(q)}`),
  },
  retryMedia: (messageId) => req(`/media/${encodeURIComponent(messageId)}/retry`, { method: 'POST' }),
  mediaUrl: (messageId) => `/api/media/${encodeURIComponent(messageId)}`,
  windowStatus: (waNumber, contactNumber) =>
    req(`/messages/window-status?waNumber=${encodeURIComponent(waNumber)}&contactNumber=${encodeURIComponent(contactNumber)}`),
  markRead: (waNumber, contactNumber) =>
    req('/messages/mark-read', { method: 'POST', body: JSON.stringify({ waNumber, contactNumber }) }),
  // Emoji reaction to a message (empty emoji removes it).
  react: (fromNumber, toNumber, messageId, emoji) =>
    req('/messages/react', { method: 'POST', body: JSON.stringify({ fromNumber, toNumber, messageId, emoji }) }),
  // Local-only "star" bookmark on a message.
  star: (waNumber, contactNumber, messageId, starred) =>
    req('/messages/star', { method: 'POST', body: JSON.stringify({ waNumber, contactNumber, messageId, starred }) }),
  sendMessage: ({ fromNumber, toNumber, text, contextMessageId }) =>
    req('/messages/send', { method: 'POST', body: JSON.stringify({ fromNumber, toNumber, text, contextMessageId }) }),
  testTemplate: (id, to, sampleValues = {}) =>
    req(`/templates/${id}/test-send`, { method: 'POST', body: JSON.stringify({ to, sampleValues }) }),
  sendMedia: async ({ fromNumber, toNumber, caption, file, contextMessageId }) => {
    const form = new FormData();
    form.append('fromNumber', fromNumber);
    form.append('toNumber', toNumber);
    if (caption) form.append('caption', caption);
    if (contextMessageId) form.append('contextMessageId', contextMessageId);
    form.append('file', file);
    const res = await fetch('/api/messages/send-media', { method: 'POST', credentials: 'include', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `${res.status}`);
    return json;
  },
  sendLibraryMedia: ({ fromNumber, toNumber, mediaLibraryId, caption, contextMessageId }) =>
    req('/messages/send-library-media', {
      method: 'POST',
      body: JSON.stringify({ fromNumber, toNumber, mediaLibraryId, caption, contextMessageId }),
    }),
  resolveAccountByPhone: (phone) =>
    req(`/whatsapp-accounts/by-phone/${encodeURIComponent(phone)}`),
  sendAudio: async ({ fromNumber, toNumber, file, contextMessageId }) => {
    const form = new FormData();
    form.append('fromNumber', fromNumber);
    form.append('toNumber', toNumber);
    if (contextMessageId) form.append('contextMessageId', contextMessageId);
    form.append('file', file);
    const res = await fetch('/api/messages/send-audio', { method: 'POST', credentials: 'include', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `${res.status}`);
    return json;
  },
  uploadTemplateMediaHandleFromLibrary: ({ accountId, mediaLibraryId }) =>
    req('/templates/upload-media-handle-from-library', {
      method: 'POST',
      body: JSON.stringify({ accountId, mediaLibraryId }),
    }),
  uploadTemplateMediaHandle: async ({ accountId, file }) => {
    const form = new FormData();
    form.append('accountId', accountId);
    form.append('file', file);
    const res = await fetch('/api/templates/upload-media-handle', { method: 'POST', credentials: 'include', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `${res.status}`);
    return json;
  },
  syncTemplate: (id) => req(`/templates/${id}/sync`, { method: 'POST' }),
  syncAllTemplates: () => req('/templates/sync-all', { method: 'POST' }),
  duplicateTemplate: (id) => req(`/templates/${id}/duplicate`, { method: 'POST' }),
  bulkSubmitTemplates: (ids) => req('/templates/bulk-submit', { method: 'POST', body: JSON.stringify({ ids }) }),
  mediaLibrary: {
    // accountId scopes media to its owning (connected) WhatsApp account.
    list: (accountId) => req(`/media-library${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`),
    upload: (file, name, notes, accountId) => {
      const form = new FormData();
      form.append('file', file);
      if (name) form.append('name', name);
      if (notes) form.append('notes', notes);
      if (accountId) form.append('accountId', accountId);
      return fetch('/api/media-library', {
        method: 'POST',
        credentials: 'include',
        body: form,
      }).then(async res => {
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`${res.status} ${text}`);
        }
        return res.json();
      });
    },
    update: (id, data) =>
      req(`/media-library/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/media-library/${id}`, { method: 'DELETE' }),
    sync: (id, accountId) =>
      req(`/media-library/${id}/sync/${accountId}`, { method: 'POST' }),
    downloadUrl: (id) => `/api/media-library/${id}/download`,
  },
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return fetch('/api/upload', {
      method: 'POST',
      credentials: 'include',
      body: form,
    }).then(async res => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status} ${text}`);
      }
      return res.json();
    });
  },
};
