require('dotenv').config();
// Resolve/auto-generate JWT_SECRET + FORGECRM_ENCRYPTION_KEY into process.env
// BEFORE any module that reads them at require-time (./auth, crypto consumers).
require('./util/instanceSecrets').bootstrapSecrets();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const pool = require('./db');
const { router: authRouter, authMiddleware, ensureTables } = require('./auth');
const { router: messagesRouter } = require('./routes/messages');
const { router: webhookRouter } = require('./routes/webhook');
const { router: categoriesRouter } = require('./routes/categories');
const { router: contactFieldsRouter } = require('./routes/contactFields');
const { router: usersRouter } = require('./routes/users');
const { router: uploadsRouter, UPLOAD_DIR } = require('./routes/uploads');
const { router: templatesRouter, syncAllAccountTemplates } = require('./routes/templates');
const { router: broadcastsRouter } = require('./routes/broadcasts');
const { router: chatbotsRouter } = require('./routes/chatbots');
const { router: mediaRouter } = require('./routes/media');
const { router: mediaLibraryRouter } = require('./routes/mediaLibrary');
const mediaStorage = require('./util/pgStorage');
const { router: whatsappAccountsRouter } = require('./routes/whatsappAccounts');
const {
  router: googleIntegrationsRouter,
  publicRouter: googleIntegrationsPublicRouter,
} = require('./routes/googleIntegrations');
const { router: agentsRouter } = require('./routes/agents');
const { router: agentConversationRouter } = require('./routes/agentConversation');
const { router: aiModelsRouter } = require('./routes/aiModels');
const { router: eventsRouter } = require('./routes/events');
const { router: dashboardRouter } = require('./routes/dashboard');
const { router: pipelinesRouter } = require('./routes/pipelines');
const { adminRouter: mcpAdminRouter, apiRouter: mcpApiRouter, ensureMcpTables } = require('./routes/mcp');
const { mcpHttpHandler } = require('./mcpHttp');
const { startWorker: startMediaWorker, shutdown: shutdownMediaQueue } = require('./queue/mediaQueue');
const { startSendWorker, shutdownSendQueue } = require('./queue/sendQueue');
const { startAgentWorker, shutdownAgentQueue } = require('./queue/agentQueue');
const { reconcileMessageStatuses } = require('./services/statusReconciler');

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

const ALLOWED_ORIGINS = [
  process.env.CORS_ORIGIN,
  'http://localhost:5173',
].filter(Boolean);

// A local `docker compose up -d` serves the app at http://localhost:8080 (or a
// custom HTTP_PORT) behind a same-origin nginx proxy, so requests carry an
// Origin like http://localhost:8080 that won't match CORS_ORIGIN. Allow any
// localhost / 127.0.0.1 origin (any port) so the documented local install works
// out of the box without needing CORS_ORIGIN; production still restricts to the
// explicit CORS_ORIGIN domain. Safe because auth cookies are sameSite=strict.
const isLocalOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

const CORS_DOMAIN = (process.env.CORS_ORIGIN || '').replace(/^https?:\/\//, '');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", ...(CORS_DOMAIN ? [`wss://${CORS_DOMAIN}`] : [])],
      mediaSrc: ["'self'", "blob:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || isLocalOrigin(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
}));

app.use(cookieParser());
// Capture the raw request body so the webhook route can verify Meta's
// X-Hub-Signature-256 HMAC over the exact bytes Meta signed.
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Serve uploaded files statically
app.use('/uploads', express.static(UPLOAD_DIR));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  keyGenerator: (req) => {
    try {
      const token = req.cookies?.forgecrm_token;
      if (token) {
        const decoded = require('jsonwebtoken').decode(token);
        if (decoded?.username) return `user:${decoded.username}`;
      }
    } catch {}
    return req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests, please try again later' });
  },
});
app.use(apiLimiter);

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Public routes (Meta webhook — no auth)
app.use('/api', webhookRouter);
// Google OAuth callback is public: Google redirects the user's browser back
// here, and we re-derive the user from the signed `state` param (see
// routes/googleIntegrations.js). Everything else under /google-integrations is
// auth-required and mounted further down.
app.use('/api', googleIntegrationsPublicRouter);
// MCP API — authenticates via its OWN bearer middleware (not the JWT cookie)
app.use('/api/mcp/v1', mcpApiRouter);
// Remote (Streamable HTTP) MCP connector — key in the URL path, public.
app.all('/api/mcp/http/:key', mcpHttpHandler);

// Auth routes (public)
app.use('/api', authRouter);

// Protected routes
app.use('/api', authMiddleware, messagesRouter);
app.use('/api', authMiddleware, categoriesRouter);
app.use('/api', authMiddleware, contactFieldsRouter);
app.use('/api', authMiddleware, usersRouter);
app.use('/api', authMiddleware, uploadsRouter);
app.use('/api', authMiddleware, templatesRouter);
app.use('/api', authMiddleware, broadcastsRouter);
app.use('/api', authMiddleware, chatbotsRouter);
app.use('/api', authMiddleware, mediaRouter);
app.use('/api', authMiddleware, mediaLibraryRouter);
app.use('/api', authMiddleware, whatsappAccountsRouter);
app.use('/api', authMiddleware, googleIntegrationsRouter);
app.use('/api', authMiddleware, agentsRouter);
app.use('/api', authMiddleware, agentConversationRouter);
app.use('/api', authMiddleware, mcpAdminRouter);
app.use('/api', authMiddleware, aiModelsRouter);
app.use('/api', authMiddleware, eventsRouter);
app.use('/api', authMiddleware, dashboardRouter);
app.use('/api', authMiddleware, pipelinesRouter);

// Error handler
app.use((err, req, res, next) => {
  // Full error (with stack) in dev for debugging; message-only in production.
  if (process.env.NODE_ENV !== 'production') console.error('[Error]', err);
  else console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
  // Apply any pending SQL migrations before touching the schema or serving.
  await require('./db/migrate').runMigrations(pool);
  await ensureTables();
  await ensureMcpTables().catch(err =>
    console.error('[mcp] table ensure failed (apply migration 057):', err.message)
  );
  mediaStorage.ensureBucket().catch(err =>
    console.error('[media-storage] table ensure failed (will retry on first upload):', err.message)
  );
  startMediaWorker();
  startSendWorker();
  startAgentWorker();

  // Self-healing delivery/read ticks: re-derive each outbound message's true
  // status from the stored webhook receipts and upgrade any chat_history row
  // that's behind (monotonic). On boot we sweep a wider 7-day window to backfill
  // anything missed while the process was down; then every 60s a cheap 2-day pass.
  reconcileMessageStatuses({ windowDays: 7 })
    .then(n => { if (n > 0) console.log(`[status-reconcile] boot: fixed ${n} tick(s)`); })
    .catch(err => console.error('[status-reconcile] boot error:', err.message));
  setInterval(async () => {
    try {
      const n = await reconcileMessageStatuses({ windowDays: 2 });
      if (n > 0) console.log(`[status-reconcile] fixed ${n} tick(s)`);
    } catch (err) {
      console.error('[status-reconcile] error:', err.message);
    }
  }, 60 * 1000).unref();

  // Stale-pause sweeper: mark paused automation executions that have outlived
  // their expires_at as error. Resume already inline-checks expires_at, so
  // this is purely hygiene against forever-paused rows accumulating.
  setInterval(async () => {
    try {
      const { rowCount } = await pool.query(
        `UPDATE coexistence.automation_executions
            SET status='error',
                error_message='Paused execution expired (no reply within timeout)',
                completed_at=NOW()
          WHERE status='paused' AND expires_at < NOW()`
      );
      if (rowCount > 0) console.log(`[sweeper] expired ${rowCount} paused execution(s)`);

      // Reap orphaned 'running' executions: the engine runs synchronously and
      // finishes in ms, so anything 'running' for >15m means the process died
      // mid-walk (e.g. a restart) and the status was never updated to error.
      const { rowCount: orphans } = await pool.query(
        `UPDATE coexistence.automation_executions
            SET status='error',
                error_message='Execution interrupted (no completion within 15 minutes)',
                completed_at=NOW()
          WHERE status='running' AND started_at < NOW() - INTERVAL '15 minutes'`
      );
      if (orphans > 0) console.log(`[sweeper] reaped ${orphans} orphaned running execution(s)`);
    } catch (err) {
      console.error('[sweeper] error:', err.message);
    }
  }, 30 * 60 * 1000).unref();

  // Agent close-summary sweeper: when an idle-summary agent's conversation goes
  // quiet (no new message for its idle window) and no human has taken over, ask
  // the agent to write its final summary to the sheet/CRM. Every 2 min.
  const { sweepClosedConversations } = require('./services/agentCloseSummary');
  setInterval(() => {
    sweepClosedConversations()
      .then(n => { if (n > 0) console.log(`[closeSummary] summarised ${n} closed conversation(s)`); })
      .catch(err => console.error('[closeSummary] sweep error:', err.message));
  }, 2 * 60 * 1000).unref();

  // Template status auto-sync: Meta does NOT push template approval/rejection
  // status — we must poll. The tick fires every 10 min but only calls Meta while
  // at least one template is still awaiting review (status='SUBMITTED'). Once all
  // are resolved (approved/rejected/etc.) it idles with zero Meta calls, and
  // auto-resumes when a new template is submitted. Override interval with
  // TEMPLATE_SYNC_INTERVAL_MS.
  const TEMPLATE_SYNC_MS = parseInt(process.env.TEMPLATE_SYNC_INTERVAL_MS || '', 10) || 10 * 60 * 1000;
  const runTemplateSync = async () => {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS pending FROM coexistence.message_templates WHERE status = 'SUBMITTED'`
      );
      const pending = rows[0]?.pending || 0;
      if (pending === 0) return; // all resolved → skip Meta entirely (idle)
      const r = await syncAllAccountTemplates();
      if (r.totalUpdated > 0) {
        console.log(`[template-sync] ${pending} pending → updated ${r.totalUpdated} template(s)`);
      }
    } catch (err) {
      console.error('[template-sync] error:', err.message);
    }
  };
  setTimeout(runTemplateSync, 60 * 1000).unref();        // initial catch-up ~1 min after startup
  setInterval(runTemplateSync, TEMPLATE_SYNC_MS).unref(); // every 10 min (gated by pending count)

  const server = app.listen(PORT, () => {
    console.log(`[ForgeChat] Backend running on port ${PORT}`);
  });

  // Graceful shutdown so BullMQ marks in-flight jobs as stalled (not lost)
  const shutdown = async (sig) => {
    console.log(`[ForgeChat] ${sig} received, draining…`);
    server.close(() => {});
    await shutdownMediaQueue();
    await shutdownSendQueue();
    await shutdownAgentQueue();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch(err => {
  console.error('[Fatal] Failed to start:', err.message);
  process.exit(1);
});
