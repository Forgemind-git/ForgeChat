'use strict';

// access.js requires ../db, which builds a pg Pool — but pg connects lazily, so
// no DB is touched as long as we only exercise adminOnly (a pure role check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { adminOnly } = require('../src/middleware/access');

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('adminOnly calls next() for an admin user', () => {
  const req = { user: { id: 1, role: 'admin' } };
  const res = mockRes();
  let nexted = false;
  adminOnly(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(res.statusCode, null, 'must not write a response for admins');
});

test('adminOnly rejects a non-admin with 403', () => {
  for (const role of ['bda_sales', 'viewer', undefined]) {
    const req = { user: { id: 2, role } };
    const res = mockRes();
    let nexted = false;
    adminOnly(req, res, () => { nexted = true; });
    assert.equal(nexted, false, `role=${role} must not pass`);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /[Aa]dmin/);
  }
});
