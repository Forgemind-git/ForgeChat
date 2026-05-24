// Centralised role → page-access map.
//
// Two roles ship today:
//   - admin     : full access (every page + Settings tabs, user management).
//   - bda_sales : "Sales" user — sees only their assigned chats/contacts.
// 'viewer' is kept as a legacy fallback.
//
// Page keys are stable strings used in three places:
//   - this map
//   - the frontend Sidebar / page guard
//   - server-side requirePermission(page) middleware
//
// "admin-settings:<tab>" entries gate individual tabs within Admin Settings.

const PAGES = [
  'home', 'chats', 'contacts', 'pipelines', 'bulk-message', 'template-builder',
  'chatbot-builder', 'media-library', 'about',
  'admin-settings:general', 'admin-settings:tags', 'admin-settings:category',
  'admin-settings:fields', 'admin-settings:whatsapp-accounts',
  'admin-settings:users',
];

const ROLE_PAGE_DEFAULTS = {
  admin: PAGES.slice(),           // everything
  bda_sales: [
    'home', 'chats', 'contacts', 'pipelines', 'about',
    'admin-settings:general',     // only the General tab in user settings
  ],
  viewer: ['home', 'about'],      // legacy fallback
};

// Returns the set of pages a user can access given their role plus any
// per-user grant/revoke overrides stored in users.permissions JSONB.
//   permissions = { grant: ["template-builder"], revoke: ["admin-settings:general"] }
function effectivePages(user) {
  const base = ROLE_PAGE_DEFAULTS[user?.role] || [];
  const overrides = user?.permissions || {};
  const grant = Array.isArray(overrides.grant) ? overrides.grant : [];
  const revoke = new Set(Array.isArray(overrides.revoke) ? overrides.revoke : []);
  const out = new Set(base);
  grant.forEach(p => out.add(p));
  revoke.forEach(p => out.delete(p));
  return out;
}

function hasPermission(user, page) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return effectivePages(user).has(page);
}

function isAdmin(user) {
  return user?.role === 'admin';
}

module.exports = {
  PAGES,
  ROLE_PAGE_DEFAULTS,
  effectivePages,
  hasPermission,
  isAdmin,
};
