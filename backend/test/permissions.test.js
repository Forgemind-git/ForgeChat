'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAdmin, hasPermission, effectivePages } = require('../src/permissions');

test('isAdmin is true only for role "admin"', () => {
  assert.equal(isAdmin({ role: 'admin' }), true);
  assert.equal(isAdmin({ role: 'bda_sales' }), false);
  assert.equal(isAdmin({ role: 'viewer' }), false);
  assert.equal(isAdmin(null), false);
  assert.equal(isAdmin({}), false);
});

test('admin has permission for every page', () => {
  assert.equal(hasPermission({ role: 'admin' }, 'admin-settings:users'), true);
  assert.equal(hasPermission({ role: 'admin' }, 'media-library'), true);
});

test('bda_sales is limited to its default pages', () => {
  const u = { role: 'bda_sales' };
  assert.equal(hasPermission(u, 'chats'), true);
  assert.equal(hasPermission(u, 'contacts'), true);
  // Not granted to sales by default:
  assert.equal(hasPermission(u, 'admin-settings:users'), false);
  assert.equal(hasPermission(u, 'media-library'), false);
});

test('null user has no permissions', () => {
  assert.equal(hasPermission(null, 'home'), false);
});

test('per-user grant/revoke overrides are applied', () => {
  const granted = effectivePages({ role: 'bda_sales', permissions: { grant: ['media-library'] } });
  assert.equal(granted.has('media-library'), true);

  const revoked = effectivePages({ role: 'bda_sales', permissions: { revoke: ['chats'] } });
  assert.equal(revoked.has('chats'), false);
});
